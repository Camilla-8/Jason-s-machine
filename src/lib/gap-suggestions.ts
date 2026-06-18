import type { ParsedClassification, RecommendedTagItem } from "./classification-schema";

interface GapSuggestion {
  name: string;
  description: string;
  synonyms: string[];
  reason: string;
  confidence: number;
  incompatibleSlugs: string[];
  weakSlugs: string[];
}

const PRIVATE_CAPITAL_GAP: {
  patterns: RegExp[];
  suggestion: GapSuggestion;
} = {
  patterns: [
    /private\s+(capital|equity|markets|credit)/i,
    /LP\/GP/i,
    /\bLPs?\b.{0,40}\bGPs?\b/i,
    /limited partners?/i,
    /general partners?/i,
    /private\s+credit\s+summit/i,
    /fundraising\s+summit/i,
    /institutional investors?/i,
    /alternative financing/i,
    /secondaries?\s+and\s+liquidity/i,
  ],
  suggestion: {
    name: "Private Capital",
    description:
      "Events focused on private equity, private markets, private credit, buyouts, LP/GP relations, fund managers, and institutional investing in private assets.",
    synonyms: [
      "private equity",
      "PE",
      "private markets",
      "private credit",
      "LP",
      "GP",
      "fund managers",
      "limited partners",
      "institutional investors",
      "alternative assets",
    ],
    reason:
      "This event is centered on private capital (private equity, private credit, private markets, LP/GP). Fintech covers payments/banking technology — not institutional PE or private credit.",
    confidence: 0.9,
    incompatibleSlugs: ["fintech"],
    weakSlugs: ["startups-venture"],
  },
};

function countPatternMatches(corpus: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => (pattern.test(corpus) ? count + 1 : count), 0);
}

function isPrivateCapitalEvent(corpus: string): boolean {
  return countPatternMatches(corpus, PRIVATE_CAPITAL_GAP.patterns) >= 2;
}

function removeIncompatibleTags(
  tags: RecommendedTagItem[],
  incompatibleSlugs: string[]
): RecommendedTagItem[] {
  const blocked = new Set(incompatibleSlugs);
  return tags.filter((tag) => !blocked.has(tag.slug));
}

function downgradeWeakTags(
  tags: RecommendedTagItem[],
  weakSlugs: string[]
): RecommendedTagItem[] {
  const weakSet = new Set(weakSlugs);
  return tags
    .map((tag) =>
      weakSet.has(tag.slug) ? { ...tag, confidence: Math.min(tag.confidence, 0.52) } : tag
    )
    .sort((a, b) => b.confidence - a.confidence);
}

function applyPrivateCapitalGap(
  corpus: string,
  result: ParsedClassification
): ParsedClassification {
  if (!isPrivateCapitalEvent(corpus)) return result;

  const { suggestion } = PRIVATE_CAPITAL_GAP;
  let recommended_tags = downgradeWeakTags(result.recommended_tags, suggestion.weakSlugs);
  recommended_tags = removeIncompatibleTags(recommended_tags, suggestion.incompatibleSlugs);

  let suggested_new_tag = result.suggested_new_tag;
  if (
    !suggested_new_tag ||
    suggested_new_tag.name.toLowerCase() !== suggestion.name.toLowerCase()
  ) {
    suggested_new_tag = {
      name: suggestion.name,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      description: suggestion.description,
      synonyms: suggestion.synonyms,
    };
  }

  return { ...result, recommended_tags, suggested_new_tag };
}

export function applyDictionaryGapDetection(
  corpus: string,
  result: ParsedClassification
): ParsedClassification {
  return applyPrivateCapitalGap(corpus, result);
}
