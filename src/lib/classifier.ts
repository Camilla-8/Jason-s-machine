import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ClassificationSchema, type RecommendedTagItem } from "./classification-schema";
import { applyCoreIdentityRules } from "./core-identity";
import { applyDictionaryGapDetection } from "./gap-suggestions";
import { formatTagsForPrompt, getApprovedTags } from "./tags";
import type { ClassificationResult, ScrapedPage, Tag, TagRecommendation } from "./types";
import { CONFIDENCE_THRESHOLD, MAX_PRIMARY_TOPICS } from "./types";
import { buildCorpus } from "./scraper";

function enrichRecommendations(
  items: RecommendedTagItem[],
  tags: Tag[]
): TagRecommendation[] {
  const tagMap = new Map(tags.map((t) => [t.slug, t]));

  return items
    .map((item) => {
      const tag = tagMap.get(item.slug);
      if (!tag) return null;
      return {
        slug: tag.slug,
        name: tag.name,
        confidence: item.confidence,
        reason: item.reason,
        evidence: item.evidence,
      };
    })
    .filter((item): item is TagRecommendation => item !== null)
    .filter((item) => item.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_PRIMARY_TOPICS);
}

function filterSuggestedNewTag(
  suggested: ClassificationResult["suggested_new_tag"]
): ClassificationResult["suggested_new_tag"] {
  if (!suggested || suggested.confidence < CONFIDENCE_THRESHOLD) return null;
  return suggested;
}

export async function classifyEvent(
  pages: ScrapedPage[],
  eventUrl: string,
  options?: { source?: "direct" | "web_search_tavily" | "web_search_openai" }
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to your .env.local file.");
  }

  const tags = await getApprovedTags();
  const corpus = buildCorpus(pages);
  const tagList = formatTagsForPrompt(tags);
  const validSlugs = tags.map((t) => t.slug).join(", ");
  const webSearchNote =
    options?.source === "web_search_tavily" || options?.source === "web_search_openai"
      ? `\n\nIMPORTANT: The event website blocked direct scraping. Content below is from public web search results, not the live site. Classify from this secondary evidence. Prefer conservative confidence when sources are thin or conflicting.`
      : "";

  const openai = new OpenAI({ apiKey });

  const completion = await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You classify events for an internal event database. Assign tags that represent the event's PRIMARY TOPICS — the main themes the event is built around.

PRIMARY TOPICS RULES:
1. Return 1–3 tags in recommended_tags that represent what the event is mainly about. Order by importance (highest confidence first).
2. A primary topic appears in the event title/tagline, is a named summit/stage/track, or is clearly sustained across agenda and positioning — not a single panel or one sponsor.
3. Multi-summit conferences CAN have multiple primary topics when each is a major program pillar (e.g. Fintech + Blockchain & Web3 at a large fintech festival with dedicated summits for each).
4. Do NOT tag from passing mentions, one keynote, or a small side stage. Do NOT tag every session theme.
5. Return confidence scores (0-1). Only include tags you are at least 0.55 confident about.
6. If a major primary topic is missing from the approved list, populate suggested_new_tag (you may still return dictionary tags for other primary topics).

Approved list slugs only: ${validSlugs}

Dictionary gap detection:
- Private equity, private markets, private credit, LP/GP, fund managers → tag slug private-capital
- Do NOT tag Fintech for events primarily about private equity, private credit, or LP/GP relations
- Private Capital can coexist with other primary topics only when both are genuinely co-headlined program pillars

Signal priority:
1. Event title, tagline, and how the event describes itself
2. Named summits, stages, tracks, and program pillars
3. Agenda themes and session clusters
4. Sponsor/partner industry mix (supporting signal only)

Overlap rules (still apply):
- Fintech vs Private Capital: do not use Fintech for PE/private credit/LP-GP-focused events
- Artificial Intelligence: only when AI technology is a primary topic — not "investing in AI" at a finance conference
- Bitcoin vs Blockchain & Web3: use Bitcoin when the event is Bitcoin-only or BTC-primary; use Blockchain & Web3 for broader crypto/web3 events`,
      },
      {
        role: "user",
        content: `Classify this event website.

Event URL: ${eventUrl}

APPROVED TAGS:
${tagList}

SCRAPED CONTENT:
${corpus}${webSearchNote}`,
      },
    ],
    response_format: zodResponseFormat(ClassificationSchema, "event_classification"),
    temperature: 0.2,
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error("AI classification failed. Please try again.");
  }

  const withGapDetection = applyDictionaryGapDetection(corpus, parsed);
  const tuned = applyCoreIdentityRules(corpus, withGapDetection);

  return {
    recommended_tags: enrichRecommendations(tuned.recommended_tags, tags),
    suggested_new_tag: filterSuggestedNewTag(tuned.suggested_new_tag),
    overall_confidence: tuned.overall_confidence,
    summary: tuned.summary,
  };
}
