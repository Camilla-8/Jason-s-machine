import { NextResponse } from "next/server";
import { ingestEventContent } from "@/lib/event-ingest";
import { classifyEvent } from "@/lib/classifier";
import { toFriendlyApiError } from "@/lib/api-errors";
import { normalizeEventUrlInput } from "@/lib/normalize-url";
import { queueSuggestedTagFromScan } from "@/lib/proposals";
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
    const url = normalizeEventUrlInput(body.url ?? "");

    const { pages, source, sourceNote, sourceWarning } = await ingestEventContent(url);
    const classification = await classifyEvent(pages, url, { source });
    const queuedProposal = await queueSuggestedTagFromScan(url, classification);

    const result: ScanResult = {
      eventUrl: url,
      topics: formatTopics(classification),
      classification,
      pages: pages.map(({ html: _html, ...page }) => page),
      scannedAt: new Date().toISOString(),
      source,
      sourceNote,
      sourceWarning,
      proposalQueued: queuedProposal !== null,
      proposalId: queuedProposal?.id,
    };

    return NextResponse.json(result);
  } catch (error) {
    const friendly = toFriendlyApiError(error);
    return NextResponse.json(
      { error: friendly.message, errorCode: friendly.code },
      { status: friendly.status }
    );
  }
}
