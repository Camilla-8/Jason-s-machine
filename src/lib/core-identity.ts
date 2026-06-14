import type { ParsedClassification, RecommendedTagItem } from "./classification-schema";

/** Topics that often appear as specialist summits inside broader conferences */
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

function applySuggestedTagDominance(result: ParsedClassification): ParsedClassification {
  if (!result.suggested_new_tag || result.suggested_new_tag.confidence < 0.85) {
    return result;
  }

  return {
    ...result,
    recommended_tags: [],
  };
}

function applyMultiSummitFiltering(
  corpus: string,
  result: ParsedClassification
): ParsedClassification {
  if (!isMultiSummitConference(corpus)) return result;

  const blocklist = hasPrivateCapitalSignals(corpus)
    ? PRIVATE_CAPITAL_TRACK_SLUGS
    : TRACK_LEVEL_SLUGS;

  return {
    ...result,
    recommended_tags: filterTags(result.recommended_tags, blocklist),
  };
}

export function applyCoreIdentityRules(
  corpus: string,
  result: ParsedClassification
): ParsedClassification {
  let updated = applyMultiSummitFiltering(corpus, result);
  updated = applySuggestedTagDominance(updated);
  return updated;
}
