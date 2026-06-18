import type { ParsedClassification, RecommendedTagItem } from "./classification-schema";
import type { Tag } from "./types";
import { CONFIDENCE_THRESHOLD } from "./types";

/** Tags that are often secondary tracks at large multi-summit conferences */
const TRACK_LEVEL_SLUGS = new Set([
  "energy-sustainability",
  "startups-venture",
  "blockchain-web3",
  "tokenization",
  "regtech-compliance",
]);

const PRIVATE_CAPITAL_TRACK_SLUGS = new Set([
  "artificial-intelligence",
  "energy-sustainability",
  "startups-venture",
  "fintech",
  "blockchain-web3",
  "tokenization",
]);

/** Downgrade cap must stay at or above CONFIDENCE_THRESHOLD so borderline pillars are not dropped */
const TRACK_DOWNGRADE_CAP = CONFIDENCE_THRESHOLD;

/** Tags at or above this confidence are kept as primary pillars at multi-summit events */
const TRACK_KEEP_THRESHOLD = 0.62;

const SUGGESTED_TAG_INCOMPATIBLE: Record<string, string[]> = {
  "private capital": ["fintech"],
};

function isMultiSummitConference(corpus: string): boolean {
  const summitMatches = corpus.match(/\b[\w\s&/]{3,50}\s+summit\b/gi) ?? [];
  return summitMatches.length >= 3;
}

function hasPrivateCapitalSignals(corpus: string): boolean {
  return /private\s+(capital|equity|markets|credit)|LP\/GP|private\s+markets\s+conference|private\s+capital/i.test(
    corpus
  );
}

function filterTags(
  tags: RecommendedTagItem[],
  blocklist: Set<string>
): RecommendedTagItem[] {
  return tags.filter((tag) => !blocklist.has(tag.slug));
}

function downgradeWeakTrackTags(
  tags: RecommendedTagItem[],
  downgradable: Set<string>,
  preserveSlugs: Set<string>
): RecommendedTagItem[] {
  return tags.map((tag) => {
    if (preserveSlugs.has(tag.slug)) return tag;
    return downgradable.has(tag.slug) && tag.confidence < TRACK_KEEP_THRESHOLD
      ? { ...tag, confidence: Math.min(tag.confidence, TRACK_DOWNGRADE_CAP) }
      : tag;
  });
}

const KEY_THEME_SUMMARY_PATTERN =
  /key themes?|major themes?|primary topics?|dedicated tracks?|program pillars?|also .{0,50}themes?/i;

function summaryReferencesTag(summary: string, tag: Tag): boolean {
  const lower = summary.toLowerCase();
  if (lower.includes(tag.name.toLowerCase())) return true;
  return tag.synonyms.some((synonym) => synonym.length > 4 && lower.includes(synonym.toLowerCase()));
}

/** If the model's summary names dictionary themes as key pillars, keep those tags */
function slugsReferencedAsKeyThemes(summary: string, tags: Tag[]): Set<string> {
  if (!KEY_THEME_SUMMARY_PATTERN.test(summary)) return new Set();

  const slugs = new Set<string>();
  for (const tag of tags) {
    if (summaryReferencesTag(summary, tag)) {
      slugs.add(tag.slug);
    }
  }
  return slugs;
}

function applySuggestedTagCompatibility(result: ParsedClassification): ParsedClassification {
  if (!result.suggested_new_tag || result.suggested_new_tag.confidence < 0.85) {
    return result;
  }

  const incompatible =
    SUGGESTED_TAG_INCOMPATIBLE[result.suggested_new_tag.name.toLowerCase()] ?? [];
  if (incompatible.length === 0) return result;

  return {
    ...result,
    recommended_tags: filterTags(result.recommended_tags, new Set(incompatible)),
  };
}

function applyMultiSummitDowngrade(
  corpus: string,
  result: ParsedClassification,
  tags: Tag[]
): ParsedClassification {
  if (!isMultiSummitConference(corpus)) return result;

  const downgradable = hasPrivateCapitalSignals(corpus)
    ? PRIVATE_CAPITAL_TRACK_SLUGS
    : TRACK_LEVEL_SLUGS;

  const preserveSlugs = slugsReferencedAsKeyThemes(result.summary, tags);

  return {
    ...result,
    recommended_tags: downgradeWeakTrackTags(
      result.recommended_tags,
      downgradable,
      preserveSlugs
    ),
  };
}

export function applyCoreIdentityRules(
  corpus: string,
  result: ParsedClassification,
  tags: Tag[]
): ParsedClassification {
  let updated = applyMultiSummitDowngrade(corpus, result, tags);
  updated = applySuggestedTagCompatibility(updated);
  return updated;
}
