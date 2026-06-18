"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScanResult, Tag, ApiErrorCode } from "@/lib/types";
import { normalizeEventUrlInput } from "@/lib/normalize-url";
import { getErrorMessage } from "@/lib/error-message";
import { copyToClipboard } from "@/lib/sheets-tsv";

type ScanPhase = "idle" | "fetching" | "analyzing" | "done" | "error";

type ScanErrorResponse = {
  error?: string;
  errorCode?: ApiErrorCode;
};

const ERROR_ACTIONS: Partial<Record<ApiErrorCode, { label: string; href: string }>> = {
  openai_quota: {
    label: "OpenAI billing",
    href: "https://platform.openai.com/account/billing",
  },
  openai_auth: {
    label: "OpenAI API keys",
    href: "https://platform.openai.com/api-keys",
  },
  openai_missing_key: {
    label: "OpenAI API keys",
    href: "https://platform.openai.com/api-keys",
  },
  tavily_quota: {
    label: "Tavily dashboard",
    href: "https://app.tavily.com",
  },
  tavily_auth: {
    label: "Tavily dashboard",
    href: "https://app.tavily.com",
  },
  tavily_missing_key: {
    label: "Tavily sign up",
    href: "https://tavily.com",
  },
};

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ApiErrorCode | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [dictionaryTags, setDictionaryTags] = useState<Tag[]>([]);

  useEffect(() => {
    void fetch("/api/tags")
      .then((res) => res.json())
      .then((data: { tags?: Tag[] }) => {
        if (Array.isArray(data.tags)) setDictionaryTags(data.tags);
      })
      .catch(() => {
        // Dictionary remainder is optional UI; scan still works without it.
      });
  }, []);

  async function handleCopyTopics() {
    if (!result) return;
    try {
      await copyToClipboard(result.topics);
      setCopyMessage("Topics copied to clipboard.");
      setTimeout(() => setCopyMessage(null), 3000);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setResult(null);
    setPhase("fetching");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const normalizedUrl = normalizeEventUrlInput(url);
      setUrl(normalizedUrl);
      setPhase("analyzing");
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
        signal: controller.signal,
      });

      const rawText = await res.text();
      let data: ScanResult & ScanErrorResponse;
      try {
        data = JSON.parse(rawText) as ScanResult & ScanErrorResponse;
      } catch {
        throw new Error("Scan returned an invalid response. Try again.");
      }

      if (!res.ok) {
        setErrorCode(data.errorCode ?? null);
        throw new Error(data.error ?? "Scan failed");
      }
      if (!data.classification || typeof data.topics !== "string") {
        throw new Error("Scan response was missing classification data.");
      }

      setResult(data);
      setPhase("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Scan timed out. Please try again.");
      } else {
        setError(getErrorMessage(err));
      }
      setPhase("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  const phaseMessage: Record<ScanPhase, string> = {
    idle: "",
    fetching: "Fetching event website pages…",
    analyzing: "Classifying event topics…",
    done: "",
    error: "",
  };

  const sourcesLabel =
    result?.source === "web_search_tavily" || result?.source === "web_search_openai"
      ? "public sources"
      : "pages";

  const errorAction = errorCode ? ERROR_ACTIONS[errorCode] : undefined;

  const tags = result?.classification.recommended_tags ?? [];
  const suggested = result?.classification.suggested_new_tag;

  const dictionaryRemainder = useMemo(() => {
    if (!result) return [];
    const slugs = new Set(result.classification.recommended_tags.map((t) => t.slug));
    return dictionaryTags.filter((t) => !slugs.has(t.slug));
  }, [dictionaryTags, result]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Classify an event</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          Paste an event website URL. The app reads key pages and returns topics from your
          approved tag dictionary.
        </p>

        <form
          onSubmit={(e) => {
            void handleScan(e);
          }}
          className="mt-6 flex gap-3"
        >
          <input
            type="text"
            required
            placeholder="gitex.com or https://example-event.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
          />
          <button
            type="submit"
            disabled={phase === "fetching" || phase === "analyzing"}
            className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {phase === "fetching" || phase === "analyzing" ? "Scanning…" : "Scan"}
          </button>
        </form>

        {(phase === "fetching" || phase === "analyzing") && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
            <p className="text-sm text-stone-600">{phaseMessage[phase]}</p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p>{error}</p>
            {errorAction && (
              <p className="mt-2">
                <a
                  href={errorAction.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  {errorAction.label} →
                </a>
              </p>
            )}
          </div>
        )}
      </section>

      {result && (
        <section className="space-y-6">
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Event topics</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Overall confidence:{" "}
                  <span className="font-medium text-stone-700">
                    {result.classification.overall_confidence}
                  </span>
                  {" · "}
                  {result.pages.length} {sourcesLabel} read
                </p>
                {result.source === "web_search_tavily" && (
                  <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    Classified from Tavily public web search — the event site blocked automated
                    access.
                  </p>
                )}
                {result.source === "web_search_openai" && (
                  <p className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                    Classified from OpenAI public web search — the event site blocked automated
                    access.
                  </p>
                )}
                {result.sourceWarning && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {result.sourceWarning}
                  </p>
                )}
                {result.sourceNote && result.source === "direct" && (
                  <p className="mt-2 text-xs text-stone-500">{result.sourceNote}</p>
                )}
              </div>
              {result.topics && (
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyTopics();
                  }}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Copy topics
                </button>
              )}
            </div>

            {copyMessage && <p className="mt-3 text-sm text-emerald-700">{copyMessage}</p>}

            {result.classification.summary && (
              <p className="mt-4 text-sm leading-relaxed text-stone-700">
                {result.classification.summary}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {tags.length === 0 && !suggested && (
                <p className="text-sm text-stone-500">No topics matched the dictionary.</p>
              )}
              {tags.map((tag) => (
                <span
                  key={tag.slug}
                  className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-3 py-1.5 text-sm font-medium text-white"
                  title={tag.reason}
                >
                  {tag.name}
                  <span className="text-stone-400">{confidenceLabel(tag.confidence)}</span>
                </span>
              ))}
            </div>

            {dictionaryRemainder.length > 0 && (
              <div className="mt-4 border-t border-stone-100 pt-4">
                <p className="mb-2 text-xs font-medium text-stone-500">
                  Other dictionary tags ({dictionaryRemainder.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {dictionaryRemainder.map((tag) => (
                    <span
                      key={tag.slug}
                      className="inline-flex rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700"
                      title={tag.description}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <ul className="mt-5 space-y-3 border-t border-stone-100 pt-5">
                {tags.map((tag) => (
                  <li key={tag.slug} className="text-sm">
                    <p className="font-medium text-stone-800">{tag.name}</p>
                    <p className="mt-0.5 text-stone-600">{tag.reason}</p>
                    {tag.evidence.length > 0 && (
                      <p className="mt-1 text-xs text-stone-500">
                        Evidence: {tag.evidence.join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {suggested && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">Suggested new tag</p>
                <p className="mt-1 text-sm text-amber-800">
                  {suggested.name} ({confidenceLabel(suggested.confidence)})
                </p>
                <p className="mt-2 text-sm text-amber-800">{suggested.reason}</p>
                {result.proposalQueued && (
                  <p className="mt-3 text-xs text-amber-900">
                    Queued for admin review — no action needed on your side.
                  </p>
                )}
              </div>
            )}
          </div>

          <details className="rounded-lg border border-stone-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-stone-600">
              {result.source === "web_search_tavily"
                ? "Public sources used (Tavily)"
                : result.source === "web_search_openai"
                  ? "Public sources used (OpenAI)"
                  : "Pages read"}{" "}
              ({result.pages.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm text-stone-500">
              {result.pages.map((p) => (
                <li key={p.url}>
                  <span className="font-medium text-stone-700">{p.pageType}</span> — {p.title} (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {p.url}
                  </a>
                  )
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
