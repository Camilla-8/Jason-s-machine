"use client";

import { useState } from "react";
import type { ScanResult } from "@/lib/types";
import {
  copyToClipboard,
  toTab1Tsv,
  toTab2Tsv,
  toTab3Tsv,
} from "@/lib/sheets-tsv";
import { EVENT_DETAIL_FIELDS, EVENT_DETAIL_LABELS } from "@/lib/types";
import { getErrorMessage } from "@/lib/error-message";

type ScanPhase = "idle" | "fetching" | "analyzing" | "done" | "error";

function OrgTablePreview({
  rows,
}: {
  rows: Array<{ tierRank: number; tierLabel: string; name: string; website: string | null }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm font-sans text-stone-500">No rows extracted.</p>;
  }

  return (
    <table className="w-full text-left text-sm font-sans">
      <thead>
        <tr className="border-b border-stone-300 text-stone-600">
          <th className="py-1 pr-3">tier_rank</th>
          <th className="py-1 pr-3">tier_label</th>
          <th className="py-1 pr-3">Name</th>
          <th className="py-1">Website</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 50).map((row, index) => (
          <tr
            key={`${row.tierRank}-${row.name}-${index}`}
            className="border-b border-stone-200 last:border-0"
          >
            <td className="py-1 pr-3">{row.tierRank}</td>
            <td className="py-1 pr-3">{row.tierLabel}</td>
            <td className="py-1 pr-3">{row.name}</td>
            <td className="py-1 truncate max-w-xs">{row.website ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [activeSheetTab, setActiveSheetTab] = useState<1 | 2 | 3>(1);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  async function handleCopyTab(tab: 1 | 2 | 3) {
    if (!result) return;
    try {
      const text =
        tab === 1
          ? toTab1Tsv(result.sheets.eventDetails)
          : tab === 2
            ? toTab2Tsv(result.sheets.sponsors)
            : toTab3Tsv(result.sheets.exhibitors);
      await copyToClipboard(text);
      setCopyMessage(`Tab ${tab} copied — paste into your master sheet.`);
      setTimeout(() => setCopyMessage(null), 3000);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDownloadXlsx() {
    if (!result) return;
    try {
      const slug =
        result.sheets.eventDetails.eventSeries?.replace(/[^\w]+/g, "-").slice(0, 40) ?? "event";
      const filename = `${slug}-export.xlsx`;

      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: result.sheets, filename }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to download XLSX");
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
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
    const timeout = setTimeout(() => controller.abort(), 120000);

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
      if (!data.sheets?.eventDetails || !Array.isArray(data.sheets.sponsors)) {
        throw new Error("Scan response was missing export data.");
      }

      setResult(data);
      setPhase("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Scan timed out after 2 minutes. Please try again.");
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
    analyzing: "Extracting event details, sponsors, and exhibitors…",
    done: "",
    error: "",
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Scan an event</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          Paste an event website URL. The app will scrape key pages and prepare a Google Sheets
          export for manual review. A full scan may take up to a minute.
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Google Sheets export</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Scanned {result.pages.length} page{result.pages.length !== 1 ? "s" : ""}. Copy each
                  tab as TSV or download a 3-sheet workbook.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyTab(1)}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Copy Tab 1
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyTab(2)}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Copy Tab 2
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyTab(3)}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Copy Tab 3
                </button>
                <button
                  type="button"
                  onClick={handleDownloadXlsx}
                  className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
                >
                  Download XLSX
                </button>
              </div>
            </div>

            {copyMessage && (
              <p className="mt-3 text-sm text-emerald-700">{copyMessage}</p>
            )}

            <div className="mt-4 flex gap-2 border-b border-stone-200">
              {([1, 2, 3] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveSheetTab(tab)}
                  className={`px-3 py-2 text-sm font-medium ${
                    activeSheetTab === tab
                      ? "border-b-2 border-stone-900 text-stone-900"
                      : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {tab === 1 ? "Event details" : tab === 2 ? "Sponsors" : "Exhibitors"}
                  {tab === 2 && ` (${result.sheets.sponsors.length})`}
                  {tab === 3 && ` (${result.sheets.exhibitors.length})`}
                </button>
              ))}
            </div>

            <div className="mt-4 max-h-80 overflow-auto rounded border border-stone-100 bg-stone-50 p-3 text-xs font-mono text-stone-700">
              {activeSheetTab === 1 && (
                <table className="w-full text-left text-sm font-sans">
                  <tbody>
                    {EVENT_DETAIL_FIELDS.map((field) => (
                      <tr key={field} className="border-b border-stone-200 last:border-0">
                        <td className="py-1.5 pr-4 font-medium text-stone-600">
                          {EVENT_DETAIL_LABELS[field]}
                        </td>
                        <td className="py-1.5 text-stone-800">
                          {result.sheets.eventDetails[field] ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {activeSheetTab === 2 && (
                <OrgTablePreview rows={result.sheets.sponsors} />
              )}
              {activeSheetTab === 3 && (
                <OrgTablePreview rows={result.sheets.exhibitors} />
              )}
            </div>
          </div>

          <details className="rounded-lg border border-stone-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-stone-600">
              Pages scanned ({result.pages.length})
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
