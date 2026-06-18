"use client";

import { useState } from "react";
import type { ScanResult } from "@/lib/types";
import { getErrorMessage } from "@/lib/error-message";
import { copyToClipboard } from "@/lib/sheets-tsv";

type ScanPhase = "idle" | "fetching" | "analyzing" | "done" | "error";

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

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
    setResult(null);
    setPhase("fetching");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      setPhase("analyzing");
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      const rawText = await res.text();
      let data: ScanResult & { error?: string };
      try {
        data = JSON.parse(rawText) as ScanResult & { error?: string };
      } catch {
        throw new Error("Scan returned an invalid response. Try again.");
      }

      if (!res.ok) throw new Error(data.error ?? "Scan failed");
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

  const tags = result?.classification.recommended_tags ?? [];
  const suggested = result?.classification.suggested_new_tag;

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
            type="url"
            required
            placeholder="https://example-event.com"
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
            {error}
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
                  {result.pages.length} page{result.pages.length !== 1 ? "s" : ""} read
                </p>
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
              </div>
            )}
          </div>

          <details className="rounded-lg border border-stone-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-stone-600">
              Pages read ({result.pages.length})
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
