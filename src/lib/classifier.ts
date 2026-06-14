import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ClassificationSchema, type RecommendedTagItem } from "./classification-schema";
import { applyCoreIdentityRules } from "./core-identity";
import { applyDictionaryGapDetection } from "./gap-suggestions";
import { formatTagsForPrompt, getApprovedTags } from "./tags";
import type { ClassificationResult, ScrapedPage, Tag, TagRecommendation } from "./types";
import { CONFIDENCE_THRESHOLD } from "./types";
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
    .sort((a, b) => b.confidence - a.confidence);
}

function filterSuggestedNewTag(
  suggested: ClassificationResult["suggested_new_tag"]
): ClassificationResult["suggested_new_tag"] {
  if (!suggested || suggested.confidence < CONFIDENCE_THRESHOLD) return null;
  return suggested;
}

export async function classifyEvent(
  pages: ScrapedPage[],
  eventUrl: string
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to your .env.local file.");
  }

  const tags = await getApprovedTags();
  const corpus = buildCorpus(pages);
  const tagList = formatTagsForPrompt(tags);
  const validSlugs = tags.map((t) => t.slug).join(", ");

  const openai = new OpenAI({ apiKey });

  const completion = await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You classify events for an internal event database. Tags must describe the event's CORE IDENTITY — what the event IS — not individual agenda items or specialist summits inside it.

CORE IDENTITY RULES (most important):
1. Ask: "If someone filtered the event database by this tag, would they expect THIS event?" If no, do not tag it.
2. Event title, main branding, and homepage positioning define core identity. These outweigh specialist summits, stages, and sessions.
3. A specialist "X Summit" inside a broader conference is NOT enough to tag X — unless X is co-headlined in the event name.
4. "AI investments" at a PE/VC conference is NOT an Artificial Intelligence event. "Private credit summit" at a multi-topic conference is NOT a Fintech event.
5. Return tags in recommended_tags with confidence scores (0-1). Only include tags you are at least 0.6 confident about.
6. If core identity is not in the approved list, populate suggested_new_tag.

Approved list slugs only: ${validSlugs}

Dictionary gap detection:
- Private equity, private markets, private credit, LP/GP, fund managers → suggested_new_tag "Private Capital"
- NEVER tag Fintech for private credit, private equity, or LP/GP events
- When suggested_new_tag applies, do not assign dictionary tags for specialist summits

Signal priority for CORE IDENTITY:
1. Event title and tagline (highest)
2. What the event calls itself
3. Overall sponsor/exhibitor industry mix (event-level focus only)
4. Specialist summits and sessions (lowest — usually do NOT become tags)

Overlap rules:
- Fintech vs Private Capital: never conflate
- Artificial Intelligence: only when the event IS about AI technology — not "investing in AI"
- Bitcoin vs Blockchain & Web3: Bitcoin only when BTC is the primary focus`,
      },
      {
        role: "user",
        content: `Classify this event website.

Event URL: ${eventUrl}

APPROVED TAGS:
${tagList}

SCRAPED CONTENT:
${corpus}`,
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
