import { NextResponse } from "next/server";
import { scrapeEventSite } from "@/lib/scraper";
import { classifyEvent } from "@/lib/classifier";
import type { ClassificationResult, ScanResult } from "@/lib/types";

export const maxDuration = 60;

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
    const classification = await classifyEvent(pages, url);

    const result: ScanResult = {
      eventUrl: url,
      topics: formatTopics(classification),
      classification,
      pages: pages.map(({ html: _html, ...page }) => page),
      scannedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
