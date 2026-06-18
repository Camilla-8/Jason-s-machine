import type { ParsedClassification, RecommendedTagItem } from "./classification-schema";

/** Tags that are often secondary tracks at large multi-summit conferences */
const TRACK_LEVEL_SLUGS = new Set([
  "artificial-intelligence",
  "energy-sustainability",
  "startups-venture",
  "blockchain-web3",
  "tokenization",
  "regtech-compliance",
  "cybersecurity",
  "cloud-infrastructure",
]);

const PRIVATE_CAPITAL_TRACK_SLUGS = new Set([
  "artificial-intelligence",
  "energy-sustainability",
  "startups-venture",
  "fintech",
  "blockchain-web3",
  "tokenization",
]);

/** Below this confidence, likely track-level noise at multi-summit events */
const TRACK_DOWNGRADE_CAP = 0.54;

/** At or above this confidence, treat as a primary program pillar even at multi-summit events */
const TRACK_KEEP_THRESHOLD = 0.75;

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
  downgradable: Set<string>
): RecommendedTagItem[] {
  return tags.map((tag) =>
    downgradable.has(tag.slug) && tag.confidence < TRACK_KEEP_THRESHOLD
      ? { ...tag, confidence: Math.min(tag.confidence, TRACK_DOWNGRADE_CAP) }
      : tag
  );
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
  result: ParsedClassification
): ParsedClassification {
  if (!isMultiSummitConference(corpus)) return result;

  const downgradable = hasPrivateCapitalSignals(corpus)
    ? PRIVATE_CAPITAL_TRACK_SLUGS
    : TRACK_LEVEL_SLUGS;

  return {
    ...result,
    recommended_tags: downgradeWeakTrackTags(result.recommended_tags, downgradable),
  };
}

export function applyCoreIdentityRules(
  corpus: string,
  result: ParsedClassification
): ParsedClassification {
  let updated = applyMultiSummitDowngrade(corpus, result);
  updated = applySuggestedTagCompatibility(updated);
  return updated;
}
