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
  sponsorSectionAnchored: boolean;
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
  kolPartnerNames: string[];
  eventBrandingNames: string[];
}

const TIER_HEADING_PATTERN =
  /grand|platinum|platinium|gold|silver|bronze|principal|associate|pavilion|exhibitor|co-?sponsors?|sponsors?|partners?|exhibitors?|media|supporter/i;

const NON_TIER_HEADING_PATTERN =
  /be a sponsor|become a sponsor|want to sponsor|why sponsor|join the sponsors|be an? sff|why singapore|real results|apply to|community partners?$|interested in raising|download sponsorship/i;

const SPONSOR_SECTION_HEADING_PATTERN =
  /^(#?\s*)?((our\s+)?\d{4}\s+)?sponsors?(\s+(&|and)\s+partners?)?$/i;

const TIER_ONLY_HEADING_PATTERN =
  /^(main|gold|silver|bronze|platinum|grand|principal|associate|supporter|media|ecosystem|co-?)\s*(sponsor|partner)s?$/i;

const STOP_SECTION_HEADING_PATTERN =
  /^(#?\s*)?(tickets?|speakers?|thought\s+leaders|testimonials?|attendee reviews|key\s+themes|what\s+you\s+can\s+expect|why\s+turkiye|event schedule|our venue|gallery|join\s+us|kol\s+partners?|faq|contact|blog|shop)$/i;

const NON_SPONSOR_TIER_HEADING_PATTERN = /\bkol\s+partners?\b/i;

const SPEAKER_SECTION_HEADING_PATTERN =
  /thought\s+leaders|all\s+speakers|featured\s+speakers?|keynote\s+speakers?|^#?\s*speakers?$/i;

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
  return (
    SPONSOR_SECTION_HEADING_PATTERN.test(normalized) ||
    /\bour\s+\d{4}\s+sponsors\b/i.test(normalized) ||
    /\b20\d{2}\s+sponsors?\b/i.test(normalized)
  );
}

function shouldStopSponsorCollection(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  if (!normalized) return false;
  return STOP_SECTION_HEADING_PATTERN.test(normalized) || NON_SPONSOR_TIER_HEADING_PATTERN.test(normalized);
}

export function isSponsorSectionAnchored(section: cheerio.Cheerio<Element>): boolean {
  const cls = section.attr("class") ?? "";
  return (
    cls.includes("sponsor-range-root") ||
    cls.includes("sponsor-sr-only-root") ||
    cls.includes("sponsor-link-root")
  );
}

export function getEffectiveImageUrl($img: cheerio.Cheerio<Element>): string {
  const src = $img.attr("src") ?? "";
  if (src && !/^data:image\/svg/i.test(src)) return src;

  const lazySrc =
    $img.attr("data-src") ??
    $img.attr("data-lazy-src") ??
    $img.attr("data-original") ??
    "";
  if (lazySrc && !/^data:image\/svg/i.test(lazySrc)) return lazySrc;

  return src;
}

function findContainerForHeading(
  $: cheerio.CheerioAPI,
  heading: cheerio.Cheerio<Element>
): cheerio.Cheerio<Element> {
  for (const selector of ["section", ".e-parent", "[class*='e-con'][class*='e-parent']", "article", "main"]) {
    const container = heading.closest(selector);
    if (container.length > 0) return container.first() as cheerio.Cheerio<Element>;
  }
  return heading.parent() as cheerio.Cheerio<Element>;
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
  const sponsorHeadingCandidates = $("h1, h2, h3, h4, h5, h6")
    .filter((_, el) => isSponsorSectionHeading($(el).text()))
    .toArray()
    .sort((a, b) => {
      const aText = normalizeHeading($(a).text());
      const bText = normalizeHeading($(b).text());
      const aScore = /\b20\d{2}\s+sponsors?\b/i.test(aText) ? 0 : /\bour\s+\d{4}\s+sponsors\b/i.test(aText) ? 1 : 2;
      const bScore = /\b20\d{2}\s+sponsors?\b/i.test(bText) ? 0 : /\bour\s+\d{4}\s+sponsors\b/i.test(bText) ? 1 : 2;
      return aScore - bScore;
    });

  const sectionHeading = sponsorHeadingCandidates[0] ? $(sponsorHeadingCandidates[0]) : $("nonexistent");

  if (sectionHeading.length > 0) {
    let node = findContainerForHeading($, sectionHeading);
    while (node.length > 0) {
      const profileLinks = node.find('a[href*="/sponsors/"]').length;
      if (profileLinks >= 5 && !node.is("body") && !node.is("main")) {
        const wrapper = $("<div class='sponsor-range-root'></div>");
        wrapper.append(node.clone());
        return wrapper as cheerio.Cheerio<Element>;
      }
      if (node.is("body") || node.is("main")) break;
      const parent = node.parent();
      if (!parent.length) break;
      node = parent as cheerio.Cheerio<Element>;
    }

    const container = findContainerForHeading($, sectionHeading);
    if (!container.is("body") && !container.is("main")) {
      return collectSponsorContainersFromAnchor($, container);
    }
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
    const tierContainer = findContainerForHeading($, tierHeading);
    let startContainer = tierContainer;

    tierContainer.prevAll(".e-parent, section").each((_, el) => {
      const heading = normalizeHeading($(el).find("h1, h2, h3, h4").first().text());
      if (isSponsorSectionHeading(heading)) {
        startContainer = $(el) as cheerio.Cheerio<Element>;
      }
    });

    if (!startContainer.is("body") && !startContainer.is("main")) {
      return collectSponsorContainersFromAnchor($, startContainer);
    }
  }

  return $("<div class='sponsor-section-unanchored'></div>") as cheerio.Cheerio<Element>;
}

function collectSponsorContainersFromAnchor(
  $: cheerio.CheerioAPI,
  anchor: cheerio.Cheerio<Element>
): cheerio.Cheerio<Element> {
  if (anchor.is("section") || anchor.closest("section").length > 0) {
    return collectSponsorSectionsFromAnchor($, anchor);
  }

  const container = anchor.hasClass("e-parent") ? anchor : anchor.closest(".e-parent");
  if (container.length === 0) {
    const wrapper = $("<div class='sponsor-range-root'></div>");
    wrapper.append(anchor.clone());
    return wrapper as cheerio.Cheerio<Element>;
  }

  const collected = $("<div class='sponsor-range-root'></div>");
  collected.append(container.clone());
  let current = container;
  while (current.length > 0) {
    const next = current.next(".e-parent");
    if (next.length === 0) break;
    const heading = normalizeHeading(next.find("h1, h2, h3, h4").first().text());
    if (shouldStopSponsorCollection(heading)) break;
    collected.append(next.clone());
    current = next;
  }

  return collected as cheerio.Cheerio<Element>;
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
    if (shouldStopSponsorCollection(heading)) break;
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
  section
    .find("ul li, ol li")
    .not("nav li, footer li, header li, [class*='menu'] li, [class*='nav'] li")
    .each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length >= 2 && text.length <= 80 && !isTierHeading(text) && !TIER_LABEL_PATTERN.test(text)) {
        count += 1;
      }
    });
  return count;
}

function countSponsorSectionImages($: cheerio.CheerioAPI, section: cheerio.Cheerio<Element>): number {
  let count = 0;
  section.find("img").each((_, el) => {
    const src = getEffectiveImageUrl($(el));
    if (!src || /^data:image\/svg/i.test(src)) return;
    if (/\bspeaker/i.test(src)) return;
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

  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (!SPEAKER_SECTION_HEADING_PATTERN.test(normalizeHeading($(el).text()))) return;

    const root = $(el).closest(".e-parent, section, article, main");
    const searchIn = root.length > 0 ? root : $(el).parent();

    searchIn.find("h3, h4, h5, h6, strong, [class*='speaker']").each((_, nameEl) => {
      const text = normalizeHeading($(nameEl).text());
      if (text.length >= 3 && text.length <= 80) names.add(text.toLowerCase());
    });
  });

  $(".ibw-speakers-wrapper img[alt], [class*='speaker'] img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (alt && alt.length >= 3 && alt.length <= 80) names.add(alt.toLowerCase());
  });

  return Array.from(names);
}

function collectKolPartnerNames($: cheerio.CheerioAPI): string[] {
  const names = new Set<string>();

  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (!NON_SPONSOR_TIER_HEADING_PATTERN.test(normalizeHeading($(el).text()))) return;

    const root = $(el).closest(".e-parent, section, article, main");
    const searchIn = root.length > 0 ? root : $(el).parent();

    searchIn.find("h4, h5, h6, strong, span").each((_, nameEl) => {
      const text = normalizeHeading($(nameEl).text());
      if (text.length >= 3 && text.length <= 80 && !isTierHeading(text)) {
        names.add(text.toLowerCase());
      }
    });
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
  sponsorSectionAnchored: boolean;
  pageType: ScrapedPageType;
}): { layout: SponsorLayout; confidence: number } {
  const {
    profileLinks,
    informaBlocks,
    textListItems,
    embeddedCount,
    tierHeadings,
    sectionImages,
    hasSponsorSection,
    sponsorSectionAnchored,
    pageType,
  } = signals;

  if (!sponsorSectionAnchored && profileLinks < 3) {
    return { layout: "none_detected", confidence: 0.85 };
  }

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
  const sponsorSectionAnchored = isSponsorSectionAnchored(sponsorSection);
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
    sponsorSectionAnchored &&
    (sponsorTierHeadingCount > 0 ||
      sponsorTextListCount >= 3 ||
      sponsorSectionImageCount >= 2 ||
      sponsorSection.find("h1, h2, h3, h4, h5, h6").filter((_, el) => isSponsorSectionHeading($(el).text())).length > 0);

  const hasExhibitorSection = exhibitorSection !== null || exhibitorProfileLinkCount >= 3;

  const sponsorChoice = chooseSponsorLayout({
    profileLinks: sponsorProfileLinkCount,
    informaBlocks: informaTierBlockCount,
    textListItems: sponsorTextListCount,
    embeddedCount: embeddedSponsorCount,
    tierHeadings: sponsorTierHeadingCount,
    sectionImages: sponsorSectionImageCount,
    hasSponsorSection,
    sponsorSectionAnchored,
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
    sponsorSectionAnchored,
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
    kolPartnerNames: collectKolPartnerNames($),
    eventBrandingNames: collectEventBrandingNames($, pageUrl),
  };
}

export function isTierLabelName(name: string): boolean {
  return TIER_LABEL_PATTERN.test(name.trim()) || /^(sponsors?|exhibitors?|partners?)$/i.test(name.trim());
}

export function isWebflowCdnImageUrl(src: string): boolean {
  return /website-files\.com|uploads-ssl\.webflow\.com|assets\.website-files/i.test(src);
}

function decodeFilenameToken(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw.replace(/%20/g, " ").replace(/%40/g, "@");
  }
  return decoded.replace(/\+/g, " ");
}

function stripCdnAssetIdPrefix(filename: string): string {
  return filename
    .replace(/^[a-f0-9]{24}[-_]/i, "")
    .replace(/^[a-f0-9]{24}$/i, "");
}

function isOpaqueCdnAssetLabel(token: string): boolean {
  const normalized = token.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) return true;

  return (
    /^group\s*[\d@()]/i.test(normalized) ||
    /^group$/i.test(normalized) ||
    /^rectangle\s*\d*/i.test(normalized) ||
    /^rectangle$/i.test(normalized) ||
    /^sponbg$/i.test(normalized) ||
    /^christamas\s*logo$/i.test(normalized) ||
    /^logo$/i.test(normalized) ||
    /^placeholder/i.test(normalized) ||
    /^dsc\d+/i.test(normalized) ||
    /^vm\d+/i.test(normalized) ||
    /^copie\s+de$/i.test(normalized) ||
    /^footer$/i.test(normalized) ||
    /^frame$/i.test(normalized) ||
    /^vector$/i.test(normalized) ||
    /^dinner$/i.test(normalized) ||
    /^party$/i.test(normalized) ||
    /^main\s+event$/i.test(normalized) ||
    /^institutional\s+day$/i.test(normalized) ||
    /^corporate\s+breakfast$/i.test(normalized) ||
    /^(linkedin|youtube|instagram|telegram|facebook|twitter|x)$/i.test(normalized) ||
    /whatapp/i.test(normalized) ||
    /paris\s+blockchain\s+week/i.test(normalized) ||
    /[@%]2x$/i.test(normalized) ||
    /%\d{2}/.test(normalized) ||
    /\b[a-f0-9]{20,}\b/i.test(normalized) ||
    /^\d[\d\s().-]*$/.test(normalized)
  );
}

function looksLikeCompanyName(name: string): boolean {
  const normalized = name.trim();
  if (normalized.length < 2 || isLikelyFilenameNoise(normalized) || isOpaqueCdnAssetLabel(normalized)) {
    return false;
  }
  if (normalized.split(/\s+/).length > 4) return false;
  if (/\.(com|io|net|org)$/i.test(normalized)) return false;
  return true;
}

export function isLikelyFilenameNoise(name: string): boolean {
  const normalized = name.trim();
  return (
    /^[a-f0-9]{6,}$/i.test(normalized) ||
    /^\d{3,}[a-z]?\d*$/i.test(normalized) ||
    FILENAME_NOISE_PATTERN.test(normalized) ||
    /\bspeaker\b/i.test(normalized) ||
    /^copy of\b/i.test(normalized) ||
    /^frame[-\s]?\d/i.test(normalized) ||
    /^image[-\s]?\d/i.test(normalized) ||
    /^mask[-\s]?group/i.test(normalized) ||
    /^button$/i.test(normalized) ||
    /^ibw\d*/i.test(normalized) ||
    /\be\d{8,}/i.test(normalized) ||
    /\bscaled\b/i.test(normalized) ||
    /[%]/.test(normalized) ||
    /@2x$/i.test(normalized) ||
    /\b[a-f0-9]{20,}\b/i.test(normalized) ||
    isOpaqueCdnAssetLabel(normalized)
  );
}

export function isNonSponsorTierLabel(label: string): boolean {
  return NON_SPONSOR_TIER_HEADING_PATTERN.test(normalizeHeading(label));
}

export function nameFromImageSrc(src: string): string | null {
  const rawBasename = src.split("/").pop()?.replace(/\?.*$/, "") ?? "";
  if (!rawBasename) return null;

  const basename = decodeFilenameToken(rawBasename);

  let token = basename
    .replace(/-\d+x\d+(?=\.[a-z]+$)/i, "")
    .replace(/\.(png|jpe?g|svg|webp|gif)$/i, "")
    .replace(/^(wp-image-|attachment-)/i, "");

  token = stripCdnAssetIdPrefix(token);

  token = token
    .replace(/[-_](?:logo|logotype|brand|white|black|blanco|colour|color|scaled|landscape|variable|light|attribution)(?:[-_]\d+)*/gi, "")
    .replace(/^(?:logo|logotype|brand)[-_]/i, "")
    .replace(/\b(?:blanco|scaled|landscape|variable|light|attribution|\d{2,})\b/gi, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .replace(/@2x$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (token.length < 2 || token.length > 80) return null;
  if (FILENAME_NOISE_PATTERN.test(token)) return null;
  if (isOpaqueCdnAssetLabel(token)) return null;
  if (isWebflowCdnImageUrl(src) && /^[a-f0-9]{20,}/i.test(token)) return null;

  return token
    .split(" ")
    .filter((word) => word.length > 0 && !/^[a-f0-9]{20,}$/i.test(word))
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

  const speakerSet = new Set([...profile.speakerNames, ...profile.kolPartnerNames]);
  const brandingSet = new Set(profile.eventBrandingNames);

  const filtered = rows.filter((row) => {
    const lower = row.name.toLowerCase();
    if (isTierLabelName(row.name)) return false;
    if (isNonSponsorTierLabel(row.tierLabel)) return false;
    if (isLikelyFilenameNoise(row.name)) return false;
    if (speakerSet.has(lower)) return false;
    if (brandingSet.has(lower)) return false;
    if (/^(digital assets summit|breakpoint|fintech festival)$/i.test(row.name)) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  const qualityRows = filtered.filter((row) => looksLikeCompanyName(row.name));

  if (profile.sponsorLayout === "section_logo_grid") {
    const noiseRatio = (rows.length - qualityRows.length) / Math.max(rows.length, 1);
    if (qualityRows.length < 3 && (noiseRatio > 0.35 || rows.length > 8)) {
      return qualityRows;
    }

    const lowQualityCount = rows.filter(
      (row) =>
        isLikelyFilenameNoise(row.name) ||
        isOpaqueCdnAssetLabel(row.name) ||
        /\b[a-f0-9]{20,}\b/i.test(row.name) ||
        /[%@]2x/i.test(row.name)
    ).length;
    if (rows.length >= 3 && lowQualityCount / rows.length > 0.6) {
      return qualityRows.length >= 3 ? qualityRows : [];
    }

    return qualityRows.length > 0 ? qualityRows : [];
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
