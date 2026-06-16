import * as cheerio from "cheerio";
import type { ScrapedPage } from "./types";

const PAGE_PATTERNS: Array<{ pattern: RegExp; type: ScrapedPage["pageType"] }> = [
  { pattern: /\/(about|who-we-are|our-story)(\/|$)/i, type: "about" },
  { pattern: /\/(agenda|schedule|program|programme)(\/|$)/i, type: "agenda" },
  { pattern: /\/(speakers?|presenters?)(\/|$)/i, type: "speakers" },
  { pattern: /\/exhibitor(-listing|s)?(\/|$)/i, type: "exhibitors" },
  { pattern: /\/(sponsors?|partners?)(\/|$)/i, type: "sponsors" },
];

const MAX_PAGES = 12;
const HTML_KEEP_TYPES: ScrapedPage["pageType"][] = ["homepage", "sponsors", "exhibitors", "about"];
const MAX_HTML_LENGTH = 300000;
const DEFAULT_CONTENT_LENGTH = 4000;
const HIGH_SIGNAL_CONTENT_LENGTH = 7000;
const FETCH_TIMEOUT_MS = 15000;

const TRACK_HEADING_PATTERN =
  /spotlight|stage|track|summit|zone|pillar|theme|programme|program|forum|symposium/i;

function normalizeUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function classifyPageType(url: string): ScrapedPage["pageType"] {
  for (const { pattern, type } of PAGE_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  return "other";
}

function humanizeFilenameToken(token: string): string | null {
  const cleaned = token.replace(/[-_]+/g, " ").trim();
  if (cleaned.length < 3 || /^(logo|banner|icon|image|sponsor|publicity|form|company)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function extractSponsorNames($: cheerio.CheerioAPI): string[] {
  const sponsors = new Set<string>();

  $("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (!alt || alt.length < 2 || alt.length > 80) return;
    if (/logo|banner|icon|image|placeholder|avatar/i.test(alt)) return;
    sponsors.add(alt);
  });

  $("img[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const filenameMatch = src.match(/\/([a-z0-9][a-z0-9-]{2,})(?:[-_.][a-z0-9-]+)*\.(?:png|jpe?g|svg|webp)/i);
    if (!filenameMatch) return;
    const name = humanizeFilenameToken(filenameMatch[1]);
    if (name) sponsors.add(name);
  });

  $("[class*='sponsor'], [class*='exhibitor'], [class*='partner']")
    .find("h2, h3, h4, li, span")
    .each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length >= 3 && text.length <= 60 && !/grand|platinum|gold|silver|bronze/i.test(text)) {
        sponsors.add(text);
      }
    });

  return Array.from(sponsors).slice(0, 50);
}

function extractTracksAndStages($: cheerio.CheerioAPI): string[] {
  const tracks = new Set<string>();

  $("h1, h2, h3, h4, h5, h6, strong, [class*='stage'], [class*='track'], [class*='spotlight'], [class*='theme']")
    .each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length < 8 || text.length > 220) return;
      if (TRACK_HEADING_PATTERN.test(text)) {
        tracks.add(text);
      }
    });

  return Array.from(tracks).slice(0, 30);
}

function extractSessionTitles($: cheerio.CheerioAPI): string[] {
  const sessions = new Set<string>();

  $("h3, h4, h5, li, [class*='session'], [class*='agenda'], [class*='programme'], [class*='program']")
    .each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length < 12 || text.length > 280) return;
      if (
        /tokeniz|blockchain|web3|defi|crypto|digital asset|bitcoin|nft|ai |artificial intelligence|payment|compliance|regtech|insurtech|martech/i.test(
          text
        )
      ) {
        sessions.add(text);
      }
    });

  return Array.from(sessions).slice(0, 30);
}

function extractStructuredSignals(
  $: cheerio.CheerioAPI,
  pageType: ScrapedPage["pageType"]
): string[] {
  const signals: string[] = [];
  const tracks = extractTracksAndStages($);
  const sessions = extractSessionTitles($);

  if (tracks.length > 0) {
    signals.push(`Dedicated tracks/stages/themes: ${tracks.join(" | ")}`);
  }

  if (sessions.length > 0) {
    signals.push(`Relevant sessions/agenda items: ${sessions.join(" | ")}`);
  }

  if (pageType === "sponsors" || pageType === "exhibitors" || pageType === "homepage" || pageType === "agenda") {
    const sponsors = extractSponsorNames($);
    if (sponsors.length > 0) {
      signals.push(`Sponsors/exhibitors detected: ${sponsors.join(", ")}`);
    }
  }

  return signals;
}

function extractText(
  html: string,
  pageUrl: string,
  pageType: ScrapedPage["pageType"] = "other"
): { title: string; content: string } {
  const $ = cheerio.load(html);

  $("script, style, nav, footer, noscript, iframe, svg").remove();

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Untitled";

  const metaDescription = $("meta[name='description']").attr("content")?.trim() ?? "";
  const ogDescription = $("meta[property='og:description']").attr("content")?.trim() ?? "";

  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 40);

  const structuredSignals = extractStructuredSignals($, pageType);

  const bodyText = $("main, article, [role='main'], .content, #content, body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const jsonLdBlocks: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).html()?.trim();
    if (raw) jsonLdBlocks.push(raw.slice(0, 2000));
  });

  const parts = [
    ...structuredSignals,
    metaDescription && `Description: ${metaDescription}`,
    ogDescription && ogDescription !== metaDescription && `OG Description: ${ogDescription}`,
    headings.length > 0 && `Headings: ${headings.join(" | ")}`,
    jsonLdBlocks.length > 0 && `Structured data: ${jsonLdBlocks.join(" ")}`,
    bodyText && `Body: ${bodyText}`,
  ].filter(Boolean);

  const maxLength =
    pageType === "agenda" ||
    pageType === "sponsors" ||
    pageType === "exhibitors" ||
    pageType === "homepage"
      ? HIGH_SIGNAL_CONTENT_LENGTH
      : DEFAULT_CONTENT_LENGTH;

  const content = parts.join("\n").slice(0, maxLength);

  return { title, content: content || `No extractable content from ${pageUrl}` };
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pagePayload(
  url: string,
  pageType: ScrapedPage["pageType"],
  html: string,
  extracted: { title: string; content: string }
): ScrapedPage {
  return {
    url,
    title: extracted.title,
    content: extracted.content,
    pageType,
    html: HTML_KEEP_TYPES.includes(pageType) ? html.slice(0, MAX_HTML_LENGTH) : undefined,
  };
}

function discoverLinks(baseUrl: string, html: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const origin = base.origin;
  const found = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    const normalized = normalizeUrl(baseUrl, href);
    if (!normalized) return;

    try {
      const linkUrl = new URL(normalized);
      if (linkUrl.origin !== origin) return;
    } catch {
      return;
    }

    const linkText = $(el).text().trim().replace(/\s+/g, " ");
    const type = classifyPageType(normalized);
    const textMatchesOrgPage =
      /^(sponsors?|partners?|exhibitors?|exhibitor\s+list(?:ing)?)$/i.test(linkText) ||
      /our\s+\d{4}\s+sponsors/i.test(linkText);

    if (type !== "other" || normalized === baseUrl.replace(/\/$/, "") || textMatchesOrgPage) {
      found.add(normalized);
    }
  });

  return Array.from(found);
}

function countExhibitorListingLinks(html: string): number {
  const $ = cheerio.load(html);
  let count = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/\/exhibitors\/[^/?#]+/.test(href)) count += 1;
  });
  return count;
}

function countSponsorProfileLinks(html: string): number {
  const $ = cheerio.load(html);
  let count = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/\/sponsors\/[^/?#]+/.test(href)) count += 1;
  });
  return count;
}

function hasDedicatedSponsorHtml(html: string): boolean {
  if (countSponsorProfileLinks(html) >= 3) return true;
  if (/<ul[^>]*class="[^"]*sr-only/i.test(html) && /<li>[^<]{2,}/i.test(html)) return true;
  if (/our\s+\d{4}\s+sponsors/i.test(html) && countSponsorProfileLinks(html) >= 1) return true;
  return false;
}

async function ensureSponsorListingPage(
  pages: ScrapedPage[],
  visited: Set<string>,
  eventBase: string,
  homepageHtml?: string
): Promise<void> {
  if (pages.some((p) => p.pageType === "sponsors")) return;

  const candidates = new Set<string>();
  const base = eventBase.replace(/\/$/, "");
  candidates.add(`${base}/sponsors`.replace(/([^:]\/)\/+/g, "$1"));
  candidates.add(`${base}/partners`.replace(/([^:]\/)\/+/g, "$1"));

  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (!/sponsors?|partners?|our\s+\d{4}\s+sponsors/i.test(text)) return;
      const normalized = normalizeUrl(eventBase, href);
      if (normalized) candidates.add(normalized);
    });
  }

  for (const candidateUrl of candidates) {
    if (visited.has(candidateUrl)) continue;

    const html = await fetchPage(candidateUrl);
    if (!html || !hasDedicatedSponsorHtml(html)) continue;

    visited.add(candidateUrl);
    const extracted = extractText(html, candidateUrl, "sponsors");
    pages.push(pagePayload(candidateUrl, "sponsors", html, extracted));
    return;
  }
}

async function ensureExhibitorListingPage(
  pages: ScrapedPage[],
  visited: Set<string>,
  origin: string
): Promise<void> {
  if (pages.some((p) => p.pageType === "exhibitors")) return;

  for (const path of ["/exhibitors", "/exhibitor-listing"]) {
    const url = `${origin}${path}`.replace(/([^:]\/)\/+/g, "$1");
    if (visited.has(url)) continue;

    const html = await fetchPage(url);
    if (!html || countExhibitorListingLinks(html) === 0) continue;

    visited.add(url);
    const extracted = extractText(html, url, "exhibitors");
    pages.push(pagePayload(url, "exhibitors", html, extracted));
    return;
  }
}

export async function scrapeEventSite(eventUrl: string): Promise<ScrapedPage[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(eventUrl);
  } catch {
    throw new Error("Invalid URL. Please enter a valid event website URL.");
  }

  const normalizedBase = parsedUrl.toString().replace(/\/$/, "");
  const homepageHtml = await fetchPage(normalizedBase);

  if (!homepageHtml) {
    throw new Error("Could not fetch the event website. Check the URL and try again.");
  }

  const pages: ScrapedPage[] = [];
  const visited = new Set<string>();

  const homepage = extractText(homepageHtml, normalizedBase, "homepage");
  pages.push(pagePayload(normalizedBase, "homepage", homepageHtml, homepage));
  visited.add(normalizedBase);

  const candidateUrls = discoverLinks(normalizedBase, homepageHtml);

  const priorityOrder: ScrapedPage["pageType"][] = [
    "agenda",
    "about",
    "speakers",
    "exhibitors",
    "sponsors",
    "other",
  ];
  const sortedCandidates = candidateUrls.sort((a, b) => {
    const typeA = classifyPageType(a);
    const typeB = classifyPageType(b);
    return priorityOrder.indexOf(typeA) - priorityOrder.indexOf(typeB);
  });

  for (const url of sortedCandidates) {
    if (pages.length >= MAX_PAGES) break;
    if (visited.has(url)) continue;

    const html = await fetchPage(url);
    if (!html) continue;

    visited.add(url);
    const pageType = classifyPageType(url);
    const extracted = extractText(html, url, pageType);
    pages.push(pagePayload(url, pageType, html, extracted));
  }

  const origin = parsedUrl.origin;
  await ensureSponsorListingPage(pages, visited, normalizedBase, homepageHtml);
  await ensureExhibitorListingPage(pages, visited, origin);

  return pages;
}

export function buildCorpus(pages: ScrapedPage[]): string {
  const weights: Record<ScrapedPage["pageType"], string> = {
    homepage: "HOMEPAGE (includes sponsors/themes when present)",
    agenda: "AGENDA — tracks, sessions, themes (highest topic signal)",
    about: "ABOUT",
    speakers: "SPEAKERS",
    sponsors: "SPONSORS — industry focus signal (weight heavily)",
    exhibitors: "EXHIBITORS — industry focus signal (weight heavily)",
    other: "OTHER",
  };

  const ordered = [...pages].sort((a, b) => {
    const priority: ScrapedPage["pageType"][] = [
      "agenda",
      "sponsors",
      "exhibitors",
      "homepage",
      "speakers",
      "about",
      "other",
    ];
    return priority.indexOf(a.pageType) - priority.indexOf(b.pageType);
  });

  return ordered
    .map(
      (p) =>
        `=== ${weights[p.pageType]} ===\nURL: ${p.url}\nTitle: ${p.title}\n${p.content}`
    )
    .join("\n\n")
    .slice(0, 28000);
}
