import { NextResponse } from "next/server";
import { scrapeEventSite, buildCorpus } from "@/lib/scraper";
import { classifyEvent } from "@/lib/classifier";
import { extractEventData, buildSheetsExport, attachExhibitorProfileUrls } from "@/lib/event-extractor";
import { normalizeEventData } from "@/lib/event-normalizer";
import { enrichOrgWebsites } from "@/lib/org-website-resolver";
import type { ClassificationResult, ScanResult } from "@/lib/types";

export const maxDuration = 90;

function formatTopics(classification: ClassificationResult): string {
  const names = classification.recommended_tags.map((t) => t.name);
  if (classification.suggested_new_tag && names.length === 0) {
    names.push(classification.suggested_new_tag.name);
  }
  return names.join(", ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: "URL is required." }, { status: 400 });
    }

    const pages = await scrapeEventSite(url);
    const corpus = buildCorpus(pages);

    const raw = extractEventData(pages, url);
    const exhibitorsWithProfiles = await attachExhibitorProfileUrls(raw.exhibitors, url);
    const [normalized, classification] = await Promise.all([
      normalizeEventData(raw, corpus),
      classifyEvent(pages, url),
    ]);
    const [sponsors, exhibitors] = await Promise.all([
      enrichOrgWebsites(normalized.sponsors, url, { maxFetches: 80 }),
      enrichOrgWebsites(exhibitorsWithProfiles, url, { maxFetches: 80 }),
    ]);

    const sheets = buildSheetsExport(
      {
        eventDetails: normalized.eventDetails,
        sponsors,
        exhibitors,
      },
      formatTopics(classification)
    );

    const result: ScanResult = {
      eventUrl: url,
      sheets,
      pages: pages.map(({ html: _html, ...page }) => page),
      classification,
      scannedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
