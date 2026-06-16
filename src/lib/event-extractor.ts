import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import {
  analyzePageProfile,
  findExhibitorSection,
  findSponsorSection,
  getEffectiveImageUrl,
  isLikelyFilenameNoise,
  isNonSponsorTierLabel,
  isSponsorSectionHeadingText,
  isTierLabelName,
  nameFromExternalUrl,
  nameFromImageSrc,
  validateExhibitorRows,
  validateSponsorRows,
} from "./page-profile";
import type {
  EventDetailsTab,
  OrganizationRow,
  ScrapedPage,
  ScrapedPageType,
  SheetsExport,
} from "./types";
import { isCompanyWebsiteUrl } from "./org-website-resolver";

const TIER_RANK_MAP: Record<string, number> = {
  grand: 1,
  principal: 1,
  platinum: 2,
  platinium: 2,
  gold: 3,
  silver: 4,
  bronze: 5,
  associate: 6,
  pavilion: 1,
  exhibitor: 2,
};

const TIER_HEADING_PATTERN =
  /grand|platinum|platinium|gold|silver|bronze|principal|associate|pavilion|exhibitor|co-?sponsors?|sponsors?|partners?|exhibitors?|media/i;

const NON_TIER_HEADING_PATTERN =
  /be a sponsor|become a sponsor|want to sponsor|why sponsor|join the sponsors|be an? sff|our \d{4}|why singapore|real results|apply to|community partners?$|interested in raising|download sponsorship|become a breakpoint/i;

const PROFILE_SPONSOR_MIN_COUNT = 8;

const NOISE_NAME_PATTERN =
  /^(logo|banner|icon|image|placeholder|avatar|learn more|read more|view all|see all|sff|home)$/i;

const FILENAME_NOISE_PATTERN =
  /(?:^|_)(?:logo|banner|icon|revwht|sff\d{4}|partners?-logo)(?:_|$)|_{2,}|\blogo[-_]/i;

const KNOWN_VENUES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bSingapore\s+EXPO\b/i, name: "Singapore EXPO" },
  { pattern: /\bMarina\s+Bay\s+Sands\b/i, name: "Marina Bay Sands" },
  {
    pattern: /\bMarina\s+Bay\s+Sands\s+Expo\s+and\s+Convention\s+Centre\b/i,
    name: "Marina Bay Sands Expo and Convention Centre",
  },
  { pattern: /\bSands\s+Expo\s+and\s+Convention\s+Centre\b/i, name: "Sands Expo and Convention Centre" },
];

function cleanEventName(raw: string): string {
  return raw
    .replace(/\s*\|\s*.*$/, "")
    .replace(/\s*[-–—]\s*Home\s*$/i, "")
    .replace(/\b(20\d{2})\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEventYear(...sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const match = source.match(/\b(20\d{2})\b/);
    if (match) return match[1];
  }
  return null;
}

export function finalizeEventDetails(details: EventDetailsTab): EventDetailsTab {
  const series = details.eventSeries ? cleanEventName(details.eventSeries) : null;
  const year = extractEventYear(
    details.startDate,
    details.endDate,
    details.eventEdition,
    details.eventSeries
  );

  const venue = details.venue ? sanitizeVenue(details.venue) : null;

  return {
    ...details,
    eventLogo: null,
    eventSeries: series,
    eventEdition: series && year ? `${series} ${year}` : series,
    venue,
  };
}

function sanitizeVenue(venue: string): string | null {
  const trimmed = venue.trim();
  if (trimmed.length < 3) return null;
  if (/^(singapore|united states|usa|uk|london)$/i.test(trimmed)) return null;

  for (const { pattern, name } of KNOWN_VENUES) {
    if (pattern.test(trimmed)) return name;
  }

  if (/convention\s+cent(er|re)$/i.test(trimmed) && trimmed.length < 25) return null;

  return trimmed;
}

function extractVenue(html: string): string | null {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");

  for (const { pattern, name } of KNOWN_VENUES) {
    if (pattern.test(bodyText)) return name;
  }

  const labelMatch = bodyText.match(
    /(?:Venue|Location|Held at|Taking place at)\s*[:\-–—]?\s*([A-Z][A-Za-z0-9\s&.',-]{3,70}?)(?:\s{2,}|\.|,|\||$)/i
  );
  if (labelMatch) {
    const candidate = labelMatch[1].trim();
    if (candidate.length >= 4 && candidate.length <= 70 && !/sponsor|exhibitor|register/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

export interface RawSheetsExtraction {
  eventDetails: Partial<EventDetailsTab>;
  sponsors: OrganizationRow[];
  exhibitors: OrganizationRow[];
}

function resolveUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function formatDisplayDate(isoOrText: string): string | null {
  const d = new Date(isoOrText);
  if (!Number.isNaN(d.getTime()) && isoOrText.includes("-")) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  const match = isoOrText.match(
    /(\d{1,2})\s*[-–—]\s*(\d{1,2})?\s*([A-Za-z]+)\s*(\d{4})/i
  );
  if (match) {
    const day = match[1];
    const month = match[3].slice(0, 3);
    const year = match[4];
    const monthCap = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
    return `${day} ${monthCap} ${year}`;
  }

  const single = isoOrText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (single) {
    const month = single[2].slice(0, 3);
    const monthCap = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
    return `${single[1]} ${monthCap} ${single[3]}`;
  }

  return null;
}

function parseJsonLdEvent(html: string): Partial<EventDetailsTab> {
  const $ = cheerio.load(html);
  const partial: Partial<EventDetailsTab> = {};

  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).html()?.trim();
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as unknown;
      const events = Array.isArray(data) ? data : [data];
      for (const item of events) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const type = obj["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (!types.some((t) => typeof t === "string" && /Event/i.test(t))) continue;

        if (typeof obj.name === "string") {
          partial.eventSeries = cleanEventName(obj.name);
        }
        if (typeof obj.startDate === "string") {
          partial.startDate = formatDisplayDate(obj.startDate);
        }
        if (typeof obj.endDate === "string") partial.endDate = formatDisplayDate(obj.endDate);

        const loc = obj.location;
        if (loc && typeof loc === "object") {
          const place = loc as Record<string, unknown>;
          if (typeof place.name === "string") partial.venue = place.name;
          if (typeof place.address === "object" && place.address) {
            const addr = place.address as Record<string, unknown>;
            if (typeof addr.addressLocality === "string") partial.city = addr.addressLocality;
            if (typeof addr.addressRegion === "string") partial.stateProvince = addr.addressRegion;
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });

  return partial;
}

function extractMetaFields(html: string, pageUrl: string): Partial<EventDetailsTab> {
  const $ = cheerio.load(html);
  const partial: Partial<EventDetailsTab> = {};

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";
  if (title) {
    partial.eventSeries = cleanEventName(title);
  }

  const bodyText = $("body").text().replace(/\s+/g, " ");

  const dateMatch = bodyText.match(
    /(\d{1,2})\s*[-–—]\s*(\d{1,2})?\s*([A-Za-z]+)\s*(20\d{2})/i
  );
  if (dateMatch && !partial.startDate) {
    const start = formatDisplayDate(dateMatch[0]);
    if (start) partial.startDate = start;
    if (dateMatch[2]) {
      const endStr = `${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}`;
      partial.endDate = formatDisplayDate(endStr);
    }
  }

  const attendeesMatch = bodyText.match(/([\d,]+)\+?\s*(?:Participants|Attendees|Visitors)/i);
  if (attendeesMatch) partial.attendees = attendeesMatch[1].replace(/,/g, "");

  const venue = extractVenue(html);
  if (venue) partial.venue = venue;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();
    const resolved = resolveUrl(pageUrl, href);
    if (!resolved) return;

    if (/google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(resolved)) {
      partial.venueGoogleMap = resolved;
    }
    if (/singaporeexpo\.com/i.test(resolved) && !partial.venueWebsite) {
      partial.venueWebsite = resolved;
      if (!partial.venue) partial.venue = "Singapore EXPO";
    }
    if (/gftn|elevandi|organizer|organiser/i.test(resolved) && !partial.organizerWebsite) {
      partial.organizerWebsite = resolved;
      if (!partial.organizer) partial.organizer = text || "GFTN";
    }
  });

  if (/singapore/i.test(bodyText) && !partial.city) {
    partial.city = "Singapore";
    partial.stateProvince = "Singapore";
    partial.region = "APAC";
  }

  return partial;
}

function tierRankFromLabel(label: string): number {
  const lower = label.toLowerCase();
  for (const [key, rank] of Object.entries(TIER_RANK_MAP)) {
    if (lower.includes(key)) return rank;
  }
  return 2;
}

function normalizeLogoAltName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(png|jpe?g|svg|webp|gif)$/i, "")
    .replace(/[-_\s]+(?:logo|icon|banner|image)\s*$/i, "")
    .replace(/[-_\s]+\d+$/i, "")
    .trim();
}

function cleanOrgName(raw: string): string | null {
  const name = normalizeLogoAltName(raw);
  if (name.length < 2 || name.length > 120) return null;
  if (NOISE_NAME_PATTERN.test(name)) return null;
  if (FILENAME_NOISE_PATTERN.test(name)) return null;
  if (/^(grand|platinum|platinium|gold|silver|bronze|sponsors?|exhibitors?)$/i.test(name)) return null;
  if (/publicity form|company profile|company logo|company banner/i.test(name)) return null;
  return name;
}

function sponsorNameQuality(name: string): number {
  let score = 0;
  if (/[-_]\d+$/i.test(name)) score -= 10;
  if (/logo|banner|icon/i.test(name)) score -= 8;
  if (/\s/.test(name)) score += 3;
  if (/^[A-Z]/.test(name)) score += 2;
  score += Math.min(name.length, 30) / 10;
  return score;
}

function preferSponsorDisplayName(
  slug: string,
  ...candidates: Array<string | null | undefined>
): string | null {
  const slugName = cleanOrgName(nameFromProfilePath(`/sponsors/${slug}`) ?? "");
  const cleaned = candidates
    .map((candidate) => (candidate ? cleanOrgName(candidate) : null))
    .filter((candidate): candidate is string => candidate !== null);

  const all = slugName ? [slugName, ...cleaned.filter((c) => c.toLowerCase() !== slugName.toLowerCase())] : cleaned;
  if (all.length === 0) return null;
  return all.sort((a, b) => sponsorNameQuality(b) - sponsorNameQuality(a))[0] ?? null;
}

function isPrimarySponsorsPage(url: string): boolean {
  try {
    return /\/sponsors\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function profileSlugFromUrl(url: string, kind: "sponsors" | "exhibitors"): string | null {
  try {
    const match = new URL(url).pathname.match(new RegExp(`/${kind}/([^/]+)`, "i"));
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function sponsorProfileSlug(href: string, pageUrl: string): string | null {
  const resolved = resolveUrl(pageUrl, href);
  if (!resolved) return null;
  return profileSlugFromUrl(resolved, "sponsors");
}

function sponsorDedupeKey(row: OrganizationRow): string {
  if (row.website) {
    const slug = profileSlugFromUrl(row.website, "sponsors");
    if (slug) return `slug:${slug}`;
  }
  return `name:${row.name.toLowerCase()}`;
}

function mergeSponsorRows(existing: OrganizationRow, candidate: OrganizationRow): OrganizationRow {
  const slug =
    (existing.website ? profileSlugFromUrl(existing.website, "sponsors") : null) ??
    (candidate.website ? profileSlugFromUrl(candidate.website, "sponsors") : null);
  const keepExistingTier = existing.tierRank <= candidate.tierRank;
  const mergedName = slug
    ? preferSponsorDisplayName(slug, existing.name, candidate.name)
    : preferSponsorDisplayName(existing.name.toLowerCase(), existing.name, candidate.name);

  return {
    tierRank: Math.min(existing.tierRank, candidate.tierRank),
    tierLabel: keepExistingTier ? existing.tierLabel : candidate.tierLabel,
    name: mergedName ?? existing.name,
    website: existing.website ?? candidate.website,
  };
}

function getSponsorSectionRoot($: cheerio.CheerioAPI): cheerio.Cheerio<Element> {
  return findSponsorSection($);
}

function sponsorNameFromProfileAnchor(
  $: cheerio.CheerioAPI,
  el: Element,
  href: string,
  slug: string
): string | null {
  const linkText = cleanOrgName($(el).text().replace(/\s+/g, " ").trim());
  const img = $(el).find("img").first();
  return (
    linkText ??
    nameFromProfilePath(href) ??
    preferSponsorDisplayName(slug, img.attr("alt") ?? "", img.attr("title") ?? "")
  );
}

function countProfileStyleSponsors(rows: OrganizationRow[]): number {
  return rows.filter(
    (row) => row.website != null && profileSlugFromUrl(row.website, "sponsors") !== null
  ).length;
}

function finalizeSponsorRows(rows: OrganizationRow[]): OrganizationRow[] {
  const profileCount = countProfileStyleSponsors(rows);
  if (profileCount < PROFILE_SPONSOR_MIN_COUNT || profileCount < rows.length * 0.4) {
    return rows;
  }

  return rows
    .filter((row) => row.website != null && profileSlugFromUrl(row.website, "sponsors") !== null)
    .map((row) => {
      const slugName = row.website ? nameFromProfilePath(row.website) : null;
      const useLinkText =
        row.name.length >= 3 &&
        (!slugName || row.name.length > slugName.length || /\s/.test(row.name));
      return { ...row, name: useLinkText ? row.name : slugName ?? row.name };
    });
}

function extractSponsorsFromTierSections(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  const byKey = new Map<string, OrganizationRow>();

  $('[class*="sponsor-category"], [class*="SponsorCategory"], [class*="sponsor_category"]').each(
    (_, sec) => {
      const headingText = $(sec).find("h2, h3, h4").first().text().trim().replace(/\s+/g, " ");
      if (
        !headingText ||
        !TIER_HEADING_PATTERN.test(headingText) ||
        NON_TIER_HEADING_PATTERN.test(headingText)
      ) {
        return;
      }

      const tierLabel = headingText;
      const tierRank = tierRankFromLabel(headingText);

      $(sec)
        .find("a[href]")
        .each((_, el) => {
          const href = $(el).attr("href") ?? "";
          if (!isInternalProfileLink(href, pageUrl) || !/\/sponsors\//i.test(href)) return;

          const resolved = resolveUrl(pageUrl, href);
          const slug = sponsorProfileSlug(href, pageUrl);
          if (!resolved || !slug) return;

          const name = sponsorNameFromProfileAnchor($, el, href, slug);
          if (!name) return;

          const candidate: OrganizationRow = {
            tierRank,
            tierLabel,
            name,
            website: resolved,
          };
          const key = `slug:${slug}`;
          const existing = byKey.get(key);
          byKey.set(key, existing ? mergeSponsorRows(existing, candidate) : candidate);
        });

      $(sec)
        .find("img")
        .each((_, el) => {
          const row = extractOrgFromLogo($, el, pageUrl, tierRank, tierLabel);
          if (!row) return;
          const key = sponsorDedupeKey(row);
          const existing = byKey.get(key);
          byKey.set(key, existing ? mergeSponsorRows(existing, row) : row);
        });
    }
  );

  return Array.from(byKey.values());
}

const PUBLICITY_EXHIBITOR_PATTERN =
  /([A-Z0-9][A-Z0-9\s&().,'+/_\\-]*?)-(\d[A-Z0-9-]+(?:-\d[A-Z0-9]+)?)-Publicity Form/gi;

function formatExhibitorNameFromFilename(raw: string): string {
  const trimmed = raw.replace(/\\/g, "").replace(/\s+/g, " ").trim();
  if (!/^[A-Z0-9\s&().,'+/_-]+$/.test(trimmed)) return trimmed;

  return trimmed
    .toLowerCase()
    .replace(/(^|[\s(])\S/g, (char) => char.toUpperCase());
}

function extractExhibitorsFromPublicityData(html: string): OrganizationRow[] {
  const rows: OrganizationRow[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(PUBLICITY_EXHIBITOR_PATTERN)) {
    const rawName = match[1]?.trim();
    if (!rawName) continue;

    const name = cleanOrgName(formatExhibitorNameFromFilename(rawName));
    if (!name || seen.has(name.toLowerCase())) continue;

    seen.add(name.toLowerCase());
    rows.push({
      tierRank: 2,
      tierLabel: "Exhibitor",
      name,
      website: null,
    });
  }

  return rows;
}

function isCompanyWebsiteCandidate(url: string, pageUrl: string): boolean {
  try {
    const eventOrigin = new URL(pageUrl).origin;
    return isCompanyWebsiteUrl(url, eventOrigin);
  } catch {
    return false;
  }
}
function nameFromProfilePath(href: string): string | null {
  const match = href.match(/\/(sponsors|exhibitors)\/([^/?#]+)/i);
  if (!match) return null;
  const slug = match[2];
  const cleaned = slug.replace(/[-_]+/g, " ").trim();
  if (cleaned.length < 2) return null;
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function isInternalProfileLink(href: string, pageUrl: string): boolean {
  const resolved = resolveUrl(pageUrl, href);
  if (!resolved) return false;
  try {
    const linkOrigin = new URL(resolved).origin;
    const pageOrigin = new URL(pageUrl).origin;
    return linkOrigin === pageOrigin && /\/(sponsors|exhibitors)\/[^/]+/.test(resolved);
  } catch {
    return false;
  }
}

function mergeExhibitorNames(
  publicityRows: OrganizationRow[],
  listingRows: OrganizationRow[]
): OrganizationRow[] {
  if (listingRows.length === 0) return publicityRows;
  if (publicityRows.length === 0) return listingRows;

  const normalizeKey = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const listingByKey = new Map<string, { name: string; website: string | null }>();
  for (const row of listingRows) {
    listingByKey.set(normalizeKey(row.name), {
      name: row.name,
      website: row.website,
    });
  }

  const merged: OrganizationRow[] = [];
  const seen = new Set<string>();

  for (const row of publicityRows) {
    const key = normalizeKey(row.name);
    const listing = listingByKey.get(key);
    const preferredName = listing?.name ?? row.name;
    const preferredWebsite = listing?.website ?? row.website;
    const dedupeKey = preferredName.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push({ ...row, name: preferredName, website: preferredWebsite });
  }

  for (const row of listingRows) {
    const dedupeKey = row.name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push(row);
  }

  return merged;
}

function isExhibitorDetailPath(pathname: string): boolean {
  return /^\/exhibitors\/[^/]+/.test(pathname);
}

function stripBoothFromExhibitorName(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\s+(?:[\d][A-Z0-9-]+(?:,\s*[\d][A-Z0-9-]+)*(?:,)?|\d+-\d+\s*Media\d*|\d+Media)\s*$/i,
      ""
    )
    .trim();
}

function extractExhibitorsFromListingLinks(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  const rows: OrganizationRow[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const resolved = resolveUrl(pageUrl, href);
    if (!resolved) return;

    let pathname = "";
    try {
      pathname = new URL(resolved).pathname;
    } catch {
      return;
    }

    if (!isExhibitorDetailPath(pathname)) return;

    const rawText = $(el).text().replace(/\s+/g, " ").trim();
    const name = cleanOrgName(stripBoothFromExhibitorName(rawText));
    if (!name || seen.has(name.toLowerCase())) return;

    seen.add(name.toLowerCase());
    rows.push({
      tierRank: 2,
      tierLabel: "Exhibitor",
      name,
      website: resolved,
    });
  });

  return rows;
}

function extractSponsorsFromProfileLinks(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  $("nav, footer, header, [role='navigation'], [role='banner']").remove();

  const bySlug = new Map<string, OrganizationRow>();
  const searchRoot = getSponsorSectionRoot($);

  let currentTierLabel = "Sponsor";
  let currentTierRank = 2;

  searchRoot
    .find("h1, h2, h3, h4, h5, h6, a")
    .each((_, el) => {
      const tag = el.tagName?.toLowerCase();
      if (tag?.match(/^h[1-6]$/)) {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (
          text.length >= 3 &&
          text.length < 80 &&
          TIER_HEADING_PATTERN.test(text) &&
          !NON_TIER_HEADING_PATTERN.test(text)
        ) {
          currentTierLabel = text;
          currentTierRank = tierRankFromLabel(text);
        }
        return;
      }

      if (tag !== "a") return;

      const href = $(el).attr("href") ?? "";
      if (!isInternalProfileLink(href, pageUrl) || !/\/sponsors\//i.test(href)) return;

      const resolved = resolveUrl(pageUrl, href);
      if (!resolved) return;

      const slug = sponsorProfileSlug(href, pageUrl);
      if (!slug) return;

      const name = sponsorNameFromProfileAnchor($, el, href, slug);
      if (!name) return;

      const candidate: OrganizationRow = {
        tierRank: currentTierRank,
        tierLabel: currentTierLabel,
        name,
        website: resolved,
      };

      const existing = bySlug.get(slug);
      bySlug.set(slug, existing ? mergeSponsorRows(existing, candidate) : candidate);
    });

  return Array.from(bySlug.values());
}

function extractOrgFromLogo(
  $: cheerio.CheerioAPI,
  el: Element,
  pageUrl: string,
  tierRank: number,
  tierLabel: string
): OrganizationRow | null {
  const img = $(el);
  const alt = img.attr("alt")?.trim() ?? "";
  const parentLink = img.closest("a").attr("href");
  const imageUrl = getEffectiveImageUrl(img);

  let name = cleanOrgName(alt) ?? cleanOrgName(img.attr("title") ?? "");

  if (!name && parentLink) {
    name = cleanOrgName(nameFromExternalUrl(parentLink, pageUrl) ?? "");
  }

  if (!name && imageUrl) {
    name = cleanOrgName(nameFromImageSrc(imageUrl) ?? "");
  }

  if (!name && parentLink) {
    name = cleanOrgName(nameFromProfilePath(parentLink) ?? "");
  }

  if (!name || isTierLabelName(name) || isLikelyFilenameNoise(name)) return null;
  if (/\bspeaker\b/i.test(imageUrl)) return null;

  let website: string | null = null;
  if (parentLink) {
    const resolved = resolveUrl(pageUrl, parentLink);
    if (resolved) {
      website = isInternalProfileLink(parentLink, pageUrl)
        ? resolved
        : isCompanyWebsiteCandidate(resolved, pageUrl)
          ? resolved
          : null;
    }
  }

  return { tierRank, tierLabel, name, website };
}

function extractSponsorsFromTextList(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  $("nav, footer, header, [role='navigation'], [role='banner']").remove();

  const section = findSponsorSection($);
  const rows: OrganizationRow[] = [];
  const seen = new Set<string>();
  let currentTierLabel = "Sponsor";
  let currentTierRank = 2;

  section.find("h1, h2, h3, h4, h5, h6, ul li, ol li, a").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag?.match(/^h[1-6]$/)) {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (
        text.length >= 3 &&
        text.length < 80 &&
        TIER_HEADING_PATTERN.test(text) &&
        !NON_TIER_HEADING_PATTERN.test(text) &&
        !isSponsorSectionHeadingText(text)
      ) {
        if (isNonSponsorTierLabel(text)) {
          currentTierLabel = "Sponsor";
          currentTierRank = 2;
        } else {
          currentTierLabel = text;
          currentTierRank = tierRankFromLabel(text);
        }
      }
      return;
    }

    if (tag === "a") {
      const inList = $(el).closest("li").length > 0;
      if (!inList) return;
    } else if (tag !== "li") {
      return;
    }

    const link = tag === "a" ? $(el) : $(el).find("a[href]").first();
    const href = link.attr("href");
    const rawName = (tag === "a" ? link.text() : link.text() || $(el).text()).replace(/\s+/g, " ").trim();
    const name = cleanOrgName(rawName);
    if (!name || isTierLabelName(name) || seen.has(name.toLowerCase())) return;

    const website = href ? resolveUrl(pageUrl, href) : null;
    seen.add(name.toLowerCase());
    rows.push({
      tierRank: currentTierRank,
      tierLabel: currentTierLabel,
      name,
      website: website && isCompanyWebsiteCandidate(website, pageUrl) ? website : null,
    });
  });

  return rows;
}

function extractSponsorsFromSectionLogos(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  $("nav, footer, header, [role='navigation'], [role='banner']").remove();

  const section = findSponsorSection($);
  const rows: OrganizationRow[] = [];
  const seen = new Set<string>();
  let currentTierLabel = "Sponsor";
  let currentTierRank = 2;

  section.find("h1, h2, h3, h4, h5, h6, img").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag?.match(/^h[1-6]$/)) {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (
        text.length >= 3 &&
        text.length < 80 &&
        TIER_HEADING_PATTERN.test(text) &&
        !NON_TIER_HEADING_PATTERN.test(text) &&
        !isSponsorSectionHeadingText(text)
      ) {
        if (isNonSponsorTierLabel(text)) {
          currentTierLabel = "Sponsor";
          currentTierRank = 2;
        } else {
          currentTierLabel = text;
          currentTierRank = tierRankFromLabel(text);
        }
      }
      return;
    }

    if (tag !== "img") return;

    const imageUrl = getEffectiveImageUrl($(el));
    if (!imageUrl || /^data:image\/svg/i.test(imageUrl)) return;
    if (/\bspeaker\b/i.test(imageUrl)) return;
    if (isNonSponsorTierLabel(currentTierLabel)) return;

    const row = extractOrgFromLogo($, el, pageUrl, currentTierRank, currentTierLabel);
    if (!row) return;
    const key = row.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });

  return rows;
}

function extractSponsorsFromEmbeddedJson(html: string): OrganizationRow[] {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return [];

  try {
    const data = JSON.parse(nextDataMatch[1]) as unknown;
    const names = new Set<string>();
    collectSponsorNamesFromJson(data, names, 0);

    return Array.from(names)
      .map((name) => cleanOrgName(name))
      .filter((name): name is string => name !== null && !isTierLabelName(name))
      .map((name) => ({
        tierRank: 2,
        tierLabel: "Sponsor",
        name,
        website: null,
      }));
  } catch {
    return [];
  }
}

function collectSponsorNamesFromJson(value: unknown, names: Set<string>, depth: number): void {
  if (depth > 12 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) collectSponsorNamesFromJson(item, names, depth + 1);
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
      collectSponsorNamesFromJson(obj[key], names, depth + 1);
    }
  }
}

function extractSponsorsFromPage(html: string, pageUrl: string, pageType: ScrapedPageType): OrganizationRow[] {
  const profile = analyzePageProfile(html, pageUrl, pageType);
  let rows: OrganizationRow[] = [];

  switch (profile.sponsorLayout) {
    case "profile_listing":
      rows = extractSponsorsFromProfileLinks(html, pageUrl);
      break;
    case "informa_tier_blocks":
      rows = extractSponsorsFromTierSections(html, pageUrl);
      if (rows.length === 0) rows = extractSponsorsFromProfileLinks(html, pageUrl);
      break;
    case "text_list":
      rows = extractSponsorsFromTextList(html, pageUrl);
      break;
    case "section_logo_grid":
      rows = extractSponsorsFromSectionLogos(html, pageUrl);
      break;
    case "embedded_json":
      rows = extractSponsorsFromEmbeddedJson(html);
      if (rows.length < 3) rows = extractSponsorsFromTextList(html, pageUrl);
      break;
    case "none_detected":
      return [];
  }

  return validateSponsorRows(rows, profile);
}

function extractExhibitorsFromTextList(html: string, pageUrl: string): OrganizationRow[] {
  const $ = cheerio.load(html);
  const section = findExhibitorSection($);
  if (!section || section.length === 0) return [];

  const rows: OrganizationRow[] = [];
  const seen = new Set<string>();

  section.find("ul li, ol li, [class*='exhibitor']").each((_, el) => {
    const link = $(el).find("a[href]").first();
    const href = link.attr("href");
    const name = cleanOrgName(stripBoothFromExhibitorName(link.text() || $(el).text()));
    if (!name || seen.has(name.toLowerCase())) return;

    const website = href ? resolveUrl(pageUrl, href) : null;
    seen.add(name.toLowerCase());
    rows.push({
      tierRank: /pavilion/i.test($(el).parent().text()) ? 1 : 2,
      tierLabel: /pavilion/i.test($(el).parent().text()) ? "Pavilion" : "Exhibitor",
      name,
      website,
    });
  });

  return rows;
}

function extractExhibitorsFromPage(html: string, pageUrl: string, pageType: ScrapedPageType): OrganizationRow[] {
  const profile = analyzePageProfile(html, pageUrl, pageType);
  let rows: OrganizationRow[] = [];

  switch (profile.exhibitorLayout) {
    case "profile_listing":
      rows = extractExhibitorsFromListingLinks(html, pageUrl);
      break;
    case "text_list":
      rows = extractExhibitorsFromTextList(html, pageUrl);
      break;
    case "publicity_forms":
      rows = extractExhibitorsFromPublicityData(html);
      break;
    case "none_detected":
      return [];
  }

  return validateExhibitorRows(rows, profile);
}

function extractOrganizationsFromHtml(
  html: string,
  pageUrl: string,
  kind: "sponsor" | "exhibitor",
  pageType: ScrapedPageType = "other"
): OrganizationRow[] {
  if (kind === "sponsor") {
    return extractSponsorsFromPage(html, pageUrl, pageType);
  }
  return extractExhibitorsFromPage(html, pageUrl, pageType);
}

function mergeDetails(
  eventUrl: string,
  ...partials: Array<Partial<EventDetailsTab>>
): EventDetailsTab {
  const merged: EventDetailsTab = {
    eventWebsite: eventUrl,
    eventLogo: null,
    eventSeries: null,
    eventEdition: null,
    startDate: null,
    endDate: null,
    attendees: null,
    region: null,
    stateProvince: null,
    city: null,
    venue: null,
    venueWebsite: null,
    venueGoogleMap: null,
    organizer: null,
    organizerWebsite: null,
    topics: "",
  };

  for (const p of partials) {
    for (const key of Object.keys(p) as Array<keyof EventDetailsTab>) {
      const val = p[key];
      if (val != null && val !== "" && key !== "eventWebsite" && key !== "eventLogo") {
        merged[key] = val as never;
      }
    }
  }

  return finalizeEventDetails(merged);
}

export function extractEventData(pages: ScrapedPage[], eventUrl: string): RawSheetsExtraction {
  const homepage = pages.find((p) => p.pageType === "homepage");
  const sponsorPages = pages.filter((p) => p.pageType === "sponsors");
  const primarySponsorPages = sponsorPages.filter((p) => isPrimarySponsorsPage(p.url));
  const sponsorPagesToScan = primarySponsorPages.length > 0 ? primarySponsorPages : sponsorPages;
  const exhibitorPages = pages.filter((p) => p.pageType === "exhibitors");

  const detailPartials: Array<Partial<EventDetailsTab>> = [];

  if (homepage?.html) {
    detailPartials.push(parseJsonLdEvent(homepage.html));
    detailPartials.push(extractMetaFields(homepage.html, homepage.url));
  }

  const sponsorByKey = new Map<string, OrganizationRow>();
  const exhibitors: OrganizationRow[] = [];
  const exhibitorSeen = new Set<string>();

  const addSponsorRow = (row: OrganizationRow): void => {
    const key = sponsorDedupeKey(row);
    const existing = sponsorByKey.get(key);
    sponsorByKey.set(key, existing ? mergeSponsorRows(existing, row) : row);
  };

  for (const page of sponsorPagesToScan) {
    if (!page.html) continue;
    for (const row of extractOrganizationsFromHtml(page.html, page.url, "sponsor", page.pageType)) {
      addSponsorRow(row);
    }
  }

  if (sponsorByKey.size < 55 && homepage?.html) {
    for (const row of extractOrganizationsFromHtml(homepage.html, homepage.url, "sponsor", "homepage")) {
      addSponsorRow(row);
    }
  }

  const sponsors = finalizeSponsorRows(Array.from(sponsorByKey.values()));

  for (const page of exhibitorPages) {
    if (!page.html) continue;
    for (const row of extractOrganizationsFromHtml(page.html, page.url, "exhibitor", page.pageType)) {
      const key = row.name.toLowerCase();
      if (exhibitorSeen.has(key)) continue;
      exhibitorSeen.add(key);
      exhibitors.push(row);
    }
  }

  if (homepage?.html) {
    const homeProfile = analyzePageProfile(homepage.html, homepage.url, "homepage");
    if (homeProfile.hasExhibitorSection && exhibitors.length < 5) {
      for (const row of extractOrganizationsFromHtml(homepage.html, homepage.url, "exhibitor", "homepage")) {
        const key = row.name.toLowerCase();
        if (exhibitorSeen.has(key)) continue;
        exhibitorSeen.add(key);
        exhibitors.push(row);
      }
    }
  }

  const firstExhibitorHtml = exhibitorPages[0]?.html;
  const publicityCount = firstExhibitorHtml?.match(/-Publicity Form/gi)?.length ?? 0;
  if (firstExhibitorHtml && publicityCount > 20) {
    const listingRows = [...exhibitors];
    const publicityRows = extractExhibitorsFromPublicityData(firstExhibitorHtml);
    exhibitors.length = 0;
    exhibitorSeen.clear();
    for (const row of mergeExhibitorNames(publicityRows, listingRows)) {
      const key = row.name.toLowerCase();
      if (exhibitorSeen.has(key)) continue;
      exhibitorSeen.add(key);
      exhibitors.push(row);
    }
  }

  return {
    eventDetails: mergeDetails(eventUrl, ...detailPartials),
    sponsors,
    exhibitors,
  };
}

async function fetchListingHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "EventTagBot/1.0 (internal event classification)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function attachExhibitorProfileUrls(
  exhibitors: OrganizationRow[],
  eventUrl: string
): Promise<OrganizationRow[]> {
  const origin = new URL(eventUrl).origin;
  const base = `${origin}/exhibitors`;
  const profileByKey = new Map<string, string>();

  const listingPages = Array.from({ length: 6 }, (_, i) => (i === 0 ? base : `${base}?page=${i + 1}`));
  const htmlPages = await Promise.all(listingPages.map((pageUrl) => fetchListingHtml(pageUrl)));

  for (const [index, html] of htmlPages.entries()) {
    if (!html) break;
    const url = listingPages[index] ?? base;
    const listings = extractExhibitorsFromListingLinks(html, url);
    if (listings.length === 0 && index > 0) break;

    for (const listing of listings) {
      if (!listing.website) continue;
      const key = listing.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      profileByKey.set(key, listing.website);
    }
  }

  return exhibitors.map((row) => {
    if (row.website) return row;
    const key = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const profileUrl = profileByKey.get(key);
    return profileUrl ? { ...row, website: profileUrl } : row;
  });
}

export function buildSheetsExport(
  raw: RawSheetsExtraction,
  topics: string
): SheetsExport {
  const eventDetails: EventDetailsTab = {
    eventWebsite: raw.eventDetails.eventWebsite ?? "",
    eventLogo: null,
    eventSeries: raw.eventDetails.eventSeries ?? null,
    eventEdition: raw.eventDetails.eventEdition ?? null,
    startDate: raw.eventDetails.startDate ?? null,
    endDate: raw.eventDetails.endDate ?? null,
    attendees: raw.eventDetails.attendees ?? null,
    region: raw.eventDetails.region ?? null,
    stateProvince: raw.eventDetails.stateProvince ?? null,
    city: raw.eventDetails.city ?? null,
    venue: raw.eventDetails.venue ?? null,
    venueWebsite: raw.eventDetails.venueWebsite ?? null,
    venueGoogleMap: raw.eventDetails.venueGoogleMap ?? null,
    organizer: raw.eventDetails.organizer ?? null,
    organizerWebsite: raw.eventDetails.organizerWebsite ?? null,
    topics,
  };

  return {
    eventDetails,
    sponsors: raw.sponsors,
    exhibitors: raw.exhibitors,
  };
}
