import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { OrganizationRow, ScrapedPageType } from "./types";

export type SponsorLayout =
  | "profile_listing"
  | "informa_tier_blocks"
  | "section_logo_grid"
  | "text_list"
  | "embedded_json"
  | "none_detected";

export type ExhibitorLayout =
  | "profile_listing"
  | "text_list"
  | "publicity_forms"
  | "none_detected";

export interface PageExtractionProfile {
  sponsorLayout: SponsorLayout;
  sponsorConfidence: number;
  exhibitorLayout: ExhibitorLayout;
  exhibitorConfidence: number;
  sponsorProfileLinkCount: number;
  exhibitorProfileLinkCount: number;
  sponsorTierHeadingCount: number;
  sponsorTextListCount: number;
  sponsorSectionImageCount: number;
  informaTierBlockCount: number;
  embeddedSponsorCount: number;
  hasSponsorSection: boolean;
  hasExhibitorSection: boolean;
  speakerNames: string[];
  eventBrandingNames: string[];
}

const TIER_HEADING_PATTERN =
  /grand|platinum|platinium|gold|silver|bronze|principal|associate|pavilion|exhibitor|co-?sponsors?|sponsors?|partners?|exhibitors?|media|supporter/i;

const NON_TIER_HEADING_PATTERN =
  /be a sponsor|become a sponsor|want to sponsor|why sponsor|join the sponsors|be an? sff|why singapore|real results|apply to|community partners?$|interested in raising|download sponsorship/i;

const SPONSOR_SECTION_HEADING_PATTERN =
  /^(#?\s*)?(our\s+\d{4}\s+)?sponsors?(\s+(&|and)\s+partners?)?$/i;

const TIER_ONLY_HEADING_PATTERN =
  /^(main|gold|silver|bronze|platinum|grand|principal|associate|supporter|media|co-?)\s*(sponsor|partner)s?$/i;

const STOP_SECTION_HEADING_PATTERN =
  /^(#?\s*)?(tickets?|speakers?|testimonials?|attendee reviews|event schedule|our venue|faq|contact|blog|shop)$/i;

const TIER_LABEL_PATTERN =
  /^(grand|platinum|platinium|gold|silver|bronze|principal|associate|main|supporter|media|co-?)\s*(sponsor|partner)s?$/i;

const FILENAME_NOISE_PATTERN =
  /^(logo|banner|icon|image|placeholder|avatar|white|black|blanco|scaled|landscape|variable|light|colour|color|securities|attribution|en)$/i;

function resolveUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeHeading(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isTierHeading(text: string): boolean {
  const normalized = normalizeHeading(text);
  return (
    normalized.length >= 3 &&
    normalized.length < 80 &&
    TIER_HEADING_PATTERN.test(normalized) &&
    !NON_TIER_HEADING_PATTERN.test(normalized)
  );
}

function isSponsorSectionHeading(text: string): boolean {
  const normalized = normalizeHeading(text);
  return SPONSOR_SECTION_HEADING_PATTERN.test(normalized) || /our\s+\d{4}\s+sponsors/i.test(normalized);
}

export function isSponsorSectionHeadingText(text: string): boolean {
  return isSponsorSectionHeading(text);
}

function countProfileLinks(html: string, kind: "sponsors" | "exhibitors"): number {
  const $ = cheerio.load(html);
  let count = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (new RegExp(`/${kind}/[^/?#]+`, "i").test(href)) count += 1;
  });
  return count;
}

function countInformaTierBlocks($: cheerio.CheerioAPI): number {
  return $('[class*="sponsor-category"], [class*="SponsorCategory"], [class*="sponsor_category"]').length;
}

export function findSponsorSection($: cheerio.CheerioAPI): cheerio.Cheerio<Element> {
  const sectionHeading = $("h1, h2, h3, h4, h5, h6")
    .filter((_, el) => isSponsorSectionHeading($(el).text()))
    .first();

  if (sectionHeading.length > 0) {
    const section = sectionHeading.closest("section, article, main");
    if (section.length > 0) {
      return collectSponsorSectionsFromAnchor($, section.first() as cheerio.Cheerio<Element>);
    }

    let node = sectionHeading.parent() as cheerio.Cheerio<Element>;
    while (node.length > 0) {
      const profileLinks = node.find('a[href*="/sponsors/"]').length;
      if (profileLinks >= 5) return node;
      const parent = node.parent();
      if (!parent.length || parent.prop("tagName")?.toLowerCase() === "body") break;
      node = parent as cheerio.Cheerio<Element>;
    }

    return $("body") as cheerio.Cheerio<Element>;
  }

  const srOnlyList = $("ul.sr-only")
    .filter((_, el) => $(el).find("li").length >= 3)
    .first();

  if (srOnlyList.length > 0) {
    const wrapper = $("<div class='sponsor-sr-only-root'></div>");
    wrapper.append(srOnlyList.clone());
    return wrapper as cheerio.Cheerio<Element>;
  }

  const sponsorLink = $("a")
    .filter((_, el) => /our\s+\d{4}\s+sponsors/i.test($(el).text().replace(/\s+/g, " ")))
    .first();

  if (sponsorLink.length > 0) {
    const wrapper = $("<div class='sponsor-link-root'></div>");
    wrapper.append(sponsorLink.closest("div").clone());
    const nearbyList = sponsorLink.parent().parent().nextAll("ul.sr-only").first();
    if (nearbyList.length > 0) wrapper.append(nearbyList.clone());
    return wrapper as cheerio.Cheerio<Element>;
  }

  const tierHeading = $("h1, h2, h3, h4, h5, h6")
    .filter((_, el) => TIER_ONLY_HEADING_PATTERN.test(normalizeHeading($(el).text())))
    .first();

  if (tierHeading.length > 0) {
    const tierSection = tierHeading.closest("section");
    if (tierSection.length > 0) {
      let startSection = tierSection as cheerio.Cheerio<Element>;
      tierSection.prevAll("section").each((_, el) => {
        const heading = normalizeHeading($(el).find("h1, h2, h3, h4").first().text());
        if (isSponsorSectionHeading(heading)) {
          startSection = $(el) as cheerio.Cheerio<Element>;
        }
      });
      return collectSponsorSectionsFromAnchor($, startSection);
    }
  }

  const main = $("main").first();
  if (main.length > 0) return main as cheerio.Cheerio<Element>;

  return $("body") as cheerio.Cheerio<Element>;
}

function collectSponsorSectionsFromAnchor(
  $: cheerio.CheerioAPI,
  anchor: cheerio.Cheerio<Element>
): cheerio.Cheerio<Element> {
  const anchorSection = anchor.prop("tagName")?.toLowerCase() === "section" ? anchor : anchor.closest("section");
  if (anchorSection.length === 0) return anchor;

  const collected = $("<div class='sponsor-range-root'></div>");
  collected.append(anchorSection.clone());
  let current = anchorSection;
  while (current.length > 0) {
    const next = current.next("section");
    if (next.length === 0) break;
    const heading = normalizeHeading(next.find("h1, h2, h3, h4").first().text());
    if (STOP_SECTION_HEADING_PATTERN.test(heading)) break;
    collected.append(next.clone());
    current = next;
  }

  return collected as cheerio.Cheerio<Element>;
}

export function findExhibitorSection($: cheerio.CheerioAPI): cheerio.Cheerio<Element> | null {
  const heading = $("h1, h2, h3, h4, h5, h6")
    .filter((_, el) => /^(#?\s*)?exhibitors?(\s+list)?$/i.test(normalizeHeading($(el).text())))
    .first();

  if (heading.length === 0) return null;

  const section = heading.closest("section, article, main, [class*='exhibitor']");
  if (section.length > 0) return section.first() as cheerio.Cheerio<Element>;
  return heading.parent() as cheerio.Cheerio<Element>;
}

function countSponsorTextListItems($: cheerio.CheerioAPI, section: cheerio.Cheerio<Element>): number {
  let count = 0;
  section.find("ul li, ol li").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text.length >= 2 && text.length <= 80 && !isTierHeading(text) && !TIER_LABEL_PATTERN.test(text)) {
      count += 1;
    }
  });
  return count;
}

function countSponsorSectionImages($: cheerio.CheerioAPI, section: cheerio.Cheerio<Element>): number {
  let count = 0;
  section.find("img[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!src || /^data:image\/svg/i.test(src)) return;
    count += 1;
  });
  return count;
}

function countTierHeadingsInSection($: cheerio.CheerioAPI, section: cheerio.Cheerio<Element>): number {
  let count = 0;
  section.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = normalizeHeading($(el).text());
    if (TIER_ONLY_HEADING_PATTERN.test(text) || (isTierHeading(text) && !isSponsorSectionHeading(text))) {
      count += 1;
    }
  });
  return count;
}

function collectSpeakerNames($: cheerio.CheerioAPI): string[] {
  const names = new Set<string>();
  const speakerRoot =
    $("h1, h2, h3, h4")
      .filter((_, el) => /^#?\s*speakers?$/i.test(normalizeHeading($(el).text())))
      .first()
      .closest("section, article, main") ?? $("body");

  speakerRoot.find("h3, h4, h5, strong, [class*='speaker']").each((_, el) => {
    const text = normalizeHeading($(el).text());
    if (text.length >= 3 && text.length <= 80) names.add(text.toLowerCase());
  });

  return Array.from(names);
}

function collectEventBrandingNames($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const names = new Set<string>();
  const title =
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();

  if (title) {
    const cleaned = title.replace(/\s*\|\s*.*$/, "").replace(/\b20\d{2}\b/g, "").trim();
    if (cleaned.length >= 3) names.add(cleaned.toLowerCase());
  }

  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0];
    if (host && host.length >= 3) names.add(host.toLowerCase());
  } catch {
    // ignore
  }

  return Array.from(names);
}

function countEmbeddedSponsors(html: string): number {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return 0;

  try {
    const data = JSON.parse(nextDataMatch[1]) as unknown;
    const names = new Set<string>();
    collectNamesFromJson(data, names, 0);
    return names.size;
  } catch {
    return 0;
  }
}

function collectNamesFromJson(value: unknown, names: Set<string>, depth: number): void {
  if (depth > 12 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) collectNamesFromJson(item, names, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  const maybeName = obj.name ?? obj.title ?? obj.label;
  const maybeSponsorFlag =
    obj.sponsor === true ||
    obj.isSponsor === true ||
    (typeof obj.type === "string" && /sponsor/i.test(obj.type));

  if (maybeSponsorFlag && typeof maybeName === "string" && maybeName.length >= 2 && maybeName.length <= 80) {
    names.add(maybeName);
  }

  for (const key of Object.keys(obj)) {
    if (/sponsor/i.test(key)) {
      collectNamesFromJson(obj[key], names, depth + 1);
    } else {
      collectNamesFromJson(obj[key], names, depth + 1);
    }
  }
}

function chooseSponsorLayout(signals: {
  profileLinks: number;
  informaBlocks: number;
  textListItems: number;
  embeddedCount: number;
  tierHeadings: number;
  sectionImages: number;
  hasSponsorSection: boolean;
  pageType: ScrapedPageType;
}): { layout: SponsorLayout; confidence: number } {
  const { profileLinks, informaBlocks, textListItems, embeddedCount, tierHeadings, sectionImages, hasSponsorSection, pageType } =
    signals;

  if (profileLinks >= 8 || (profileLinks >= 3 && pageType === "sponsors")) {
    return { layout: "profile_listing", confidence: 0.95 };
  }
  if (informaBlocks >= 2) {
    return { layout: "informa_tier_blocks", confidence: 0.9 };
  }
  if (embeddedCount >= 3) {
    return { layout: "embedded_json", confidence: 0.85 };
  }
  if (textListItems >= 3) {
    return { layout: "text_list", confidence: 0.85 };
  }
  if (hasSponsorSection && tierHeadings >= 1 && sectionImages >= 2) {
    return { layout: "section_logo_grid", confidence: 0.8 };
  }
  if (profileLinks >= 3) {
    return { layout: "profile_listing", confidence: 0.75 };
  }
  if (hasSponsorSection && tierHeadings >= 1 && sectionImages === 0 && textListItems === 0) {
    return { layout: "none_detected", confidence: 0.7 };
  }
  if (hasSponsorSection && sectionImages >= 1) {
    return { layout: "section_logo_grid", confidence: 0.55 };
  }
  if (profileLinks >= 1) {
    return { layout: "profile_listing", confidence: 0.5 };
  }

  return { layout: "none_detected", confidence: 0.4 };
}

function chooseExhibitorLayout(signals: {
  profileLinks: number;
  publicityForms: number;
  textListItems: number;
  hasExhibitorSection: boolean;
  pageType: ScrapedPageType;
}): { layout: ExhibitorLayout; confidence: number } {
  const { profileLinks, publicityForms, textListItems, hasExhibitorSection, pageType } = signals;

  if (publicityForms > 20) {
    return { layout: "publicity_forms", confidence: 0.95 };
  }
  if (profileLinks >= 5 || (profileLinks >= 1 && pageType === "exhibitors")) {
    return { layout: "profile_listing", confidence: 0.9 };
  }
  if (textListItems >= 5 && hasExhibitorSection) {
    return { layout: "text_list", confidence: 0.75 };
  }
  if (hasExhibitorSection && textListItems >= 3) {
    return { layout: "text_list", confidence: 0.6 };
  }

  return { layout: "none_detected", confidence: 0.5 };
}

export function analyzePageProfile(
  html: string,
  pageUrl: string,
  pageType: ScrapedPageType = "other"
): PageExtractionProfile {
  const $ = cheerio.load(html);
  $("nav, footer, header, [role='navigation'], [role='banner']").remove();

  const sponsorSection = findSponsorSection($);
  const exhibitorSection = findExhibitorSection($);

  const sponsorProfileLinkCount = countProfileLinks(html, "sponsors");
  const exhibitorProfileLinkCount = countProfileLinks(html, "exhibitors");
  const informaTierBlockCount = countInformaTierBlocks($);
  const sponsorTextListCount = countSponsorTextListItems($, sponsorSection);
  const sponsorSectionImageCount = countSponsorSectionImages($, sponsorSection);
  const sponsorTierHeadingCount = countTierHeadingsInSection($, sponsorSection);
  const embeddedSponsorCount = countEmbeddedSponsors(html);
  const publicityForms = (html.match(/-Publicity Form/gi) ?? []).length;

  const exhibitorTextListCount = exhibitorSection
    ? countSponsorTextListItems($, exhibitorSection)
    : 0;

  const hasSponsorSection =
    sponsorTierHeadingCount > 0 ||
    sponsorTextListCount >= 3 ||
    sponsorSectionImageCount >= 2 ||
    isSponsorSectionHeading(sponsorSection.find("h1, h2, h3, h4").first().text());

  const hasExhibitorSection = exhibitorSection !== null || exhibitorProfileLinkCount >= 3;

  const sponsorChoice = chooseSponsorLayout({
    profileLinks: sponsorProfileLinkCount,
    informaBlocks: informaTierBlockCount,
    textListItems: sponsorTextListCount,
    embeddedCount: embeddedSponsorCount,
    tierHeadings: sponsorTierHeadingCount,
    sectionImages: sponsorSectionImageCount,
    hasSponsorSection,
    pageType,
  });

  const exhibitorChoice = chooseExhibitorLayout({
    profileLinks: exhibitorProfileLinkCount,
    publicityForms,
    textListItems: exhibitorTextListCount,
    hasExhibitorSection,
    pageType,
  });

  return {
    sponsorLayout: sponsorChoice.layout,
    sponsorConfidence: sponsorChoice.confidence,
    exhibitorLayout: exhibitorChoice.layout,
    exhibitorConfidence: exhibitorChoice.confidence,
    sponsorProfileLinkCount,
    exhibitorProfileLinkCount,
    sponsorTierHeadingCount,
    sponsorTextListCount,
    sponsorSectionImageCount,
    informaTierBlockCount,
    embeddedSponsorCount,
    hasSponsorSection,
    hasExhibitorSection,
    speakerNames: collectSpeakerNames($),
    eventBrandingNames: collectEventBrandingNames($, pageUrl),
  };
}

export function isTierLabelName(name: string): boolean {
  return TIER_LABEL_PATTERN.test(name.trim()) || /^(sponsors?|exhibitors?|partners?)$/i.test(name.trim());
}

export function isLikelyFilenameNoise(name: string): boolean {
  return /^[a-f0-9]{6,}$/i.test(name) || /^\d{3,}[a-z]?\d*$/i.test(name) || FILENAME_NOISE_PATTERN.test(name);
}

export function nameFromImageSrc(src: string): string | null {
  const basename = src.split("/").pop()?.replace(/\?.*$/, "") ?? "";
  if (!basename) return null;

  let token = basename
    .replace(/-\d+x\d+(?=\.[a-z]+$)/i, "")
    .replace(/\.(png|jpe?g|svg|webp|gif)$/i, "")
    .replace(/^(wp-image-|attachment-)/i, "");

  token = token
    .replace(/[-_](?:logo|logotype|brand|white|black|blanco|colour|color|scaled|landscape|variable|light|attribution)(?:[-_]\d+)*/gi, "")
    .replace(/^(?:logo|logotype|brand)[-_]/i, "")
    .replace(/\b(?:blanco|scaled|landscape|variable|light|attribution|\d{2,})\b/gi, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (token.length < 2 || token.length > 80) return null;
  if (FILENAME_NOISE_PATTERN.test(token)) return null;

  return token
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function nameFromExternalUrl(url: string, pageUrl: string): string | null {
  const resolved = resolveUrl(pageUrl, url);
  if (!resolved) return null;

  try {
    const host = new URL(resolved).hostname.replace(/^www\./, "");
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./, "");
    if (host === pageHost) return null;

    const label = host.split(".")[0];
    if (!label || label.length < 3) return null;
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  } catch {
    return null;
  }
}

export function validateSponsorRows(
  rows: OrganizationRow[],
  profile: PageExtractionProfile
): OrganizationRow[] {
  if (rows.length === 0) return rows;

  const speakerSet = new Set(profile.speakerNames);
  const brandingSet = new Set(profile.eventBrandingNames);

  const filtered = rows.filter((row) => {
    const lower = row.name.toLowerCase();
    if (isTierLabelName(row.name)) return false;
    if (isLikelyFilenameNoise(row.name)) return false;
    if (speakerSet.has(lower)) return false;
    if (brandingSet.has(lower)) return false;
    if (/^(digital assets summit|breakpoint|fintech festival)$/i.test(row.name)) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  const contaminationRate =
    (rows.length - filtered.length) / Math.max(rows.length, 1);
  if (contaminationRate > 0.5 && filtered.length < 3) return [];

  if (
    profile.sponsorTierHeadingCount >= 2 &&
    filtered.length <= 2 &&
    profile.sponsorLayout !== "profile_listing"
  ) {
    return [];
  }

  return filtered;
}

export function validateExhibitorRows(
  rows: OrganizationRow[],
  profile: PageExtractionProfile
): OrganizationRow[] {
  if (profile.exhibitorLayout === "none_detected" && profile.exhibitorProfileLinkCount === 0) {
    return [];
  }

  const speakerSet = new Set(profile.speakerNames);
  const brandingSet = new Set(profile.eventBrandingNames);

  return rows.filter((row) => {
    const lower = row.name.toLowerCase();
    if (isTierLabelName(row.name)) return false;
    if (speakerSet.has(lower)) return false;
    if (brandingSet.has(lower)) return false;
    if (/^(home|about|contact|blog|shop|events)$/i.test(row.name)) return false;
    return true;
  });
}
