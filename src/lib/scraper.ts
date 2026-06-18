import * as cheerio from "cheerio";
import type { ScrapedPage } from "./types";

const PAGE_PATTERNS: Array<{ pattern: RegExp; type: ScrapedPage["pageType"] }> = [
  { pattern: /\/(about|who-we-are|our-story)(\/|$)/i, type: "about" },
  { pattern: /\/(agenda|schedule|program|programme)(\/|$)/i, type: "agenda" },
  { pattern: /\/exhibitor(-listing|s)?(\/|$)/i, type: "exhibitors" },
  { pattern: /\/(sponsors?|partners?)(\/|$)/i, type: "sponsors" },
  { pattern: /\/(speakers?|presenters?)(\/|$)/i, type: "speakers" },
];

const MAX_PAGES = 8;
const DEFAULT_CONTENT_LENGTH = 4000;
const HIGH_SIGNAL_CONTENT_LENGTH = 7000;
const FETCH_TIMEOUT_MS = 15000;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type FetchFailureReason =
  | "blocked"
  | "not_found"
  | "not_html"
  | "timeout"
  | "network"
  | "http_error";

export type ScrapeAttemptResult =
  | { ok: true; pages: ScrapedPage[] }
  | { ok: false; reason: FetchFailureReason; status?: number };

function fetchFailureMessage(
  result: { ok: false; reason: FetchFailureReason; status?: number },
  url: string
): string {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "this site";
    }
  })();

  switch (result.reason) {
    case "blocked":
      return `${host} blocked automated access (HTTP ${result.status ?? 403}). The site likely uses bot protection (common on large trade-show sites). Try a related URL such as a parent conference homepage, or open the site in your browser to confirm it loads.`;
    case "not_found":
      return `Page not found (HTTP 404). Check the URL and try again.`;
    case "not_html":
      return `The URL did not return an HTML page. Check the URL points to the event website homepage.`;
    case "timeout":
      return `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. The site may be slow or unreachable — try again later.`;
    case "network":
      return `Could not connect to ${host}. Check the URL and your network connection.`;
    case "http_error":
      return `Could not fetch the event website (HTTP ${result.status ?? "error"}). Check the URL and try again.`;
    default:
      return "Could not fetch the event website. Check the URL and try again.";
  }
}

async function fetchPage(url: string): Promise<
  | { ok: true; html: string }
  | { ok: false; reason: FetchFailureReason; status?: number }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, reason: "not_found", status: 404 };
      }
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return { ok: false, reason: "blocked", status: response.status };
      }
      return { ok: false, reason: "http_error", status: response.status };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, reason: "not_html" };
    }

    return { ok: true, html: await response.text() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageHtml(url: string): Promise<string | null> {
  const result = await fetchPage(url);
  return result.ok ? result.html : null;
}

const TOPIC_ENSURE_PATHS = [
  "/program",
  "/programme",
  "/agenda",
  "/schedule",
  "/about",
  "/partners",
  "/sponsors",
] as const;

const TRACK_HEADING_PATTERN =
  /spotlight|stage|track|summit|zone|pillar|theme|programme|program|forum|symposium/i;

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function classifyPageType(url: string): ScrapedPage["pageType"] {
  const pathname = pathnameOf(url);
  for (const { pattern, type } of PAGE_PATTERNS) {
    if (pattern.test(pathname)) return type;
  }
  return "other";
}

function isSpeakerProfileUrl(url: string): boolean {
  return /\/speakers\/[^/]+/i.test(pathnameOf(url));
}

function isListingPageUrl(url: string): boolean {
  const pathname = pathnameOf(url);
  return (
    /\/(sponsors?|partners?|exhibitors?)(\/|$)/i.test(pathname) ||
    /\/(agenda|schedule|program|programme)(\/|$)/i.test(pathname) ||
    /\/(about|who-we-are|our-story)(\/|$)/i.test(pathname) ||
    /\/(speakers?|presenters?)(\/|$)/i.test(pathname)
  );
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

  return Array.from(sponsors).slice(0, 30);
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
        /tokeniz|blockchain|web3|defi|crypto|digital asset|bitcoin|nft|ai |artificial intelligence|payment|compliance|regtech|insurtech|martech|private equity|private credit/i.test(
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
      signals.push(`Industry names detected: ${sponsors.join(", ")}`);
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
    pageType === "homepage" ||
    pageType === "about"
      ? HIGH_SIGNAL_CONTENT_LENGTH
      : DEFAULT_CONTENT_LENGTH;

  const content = parts.join("\n").slice(0, maxLength);

  return { title, content: content || `No extractable content from ${pageUrl}` };
}

function pagePayload(
  url: string,
  pageType: ScrapedPage["pageType"],
  extracted: { title: string; content: string }
): ScrapedPage {
  return {
    url,
    title: extracted.title,
    content: extracted.content,
    pageType,
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

    if (isSpeakerProfileUrl(normalized)) return;

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

async function ensureTopicPages(
  pages: ScrapedPage[],
  visited: Set<string>,
  eventBase: string
): Promise<void> {
  const base = eventBase.replace(/\/$/, "");
  const haveType = new Set(pages.map((p) => p.pageType));

  for (const path of TOPIC_ENSURE_PATHS) {
    if (pages.length >= MAX_PAGES + 3) break;

    const candidateUrl = `${base}${path}`.replace(/([^:]\/)\/+/g, "$1");
    if (visited.has(candidateUrl)) continue;

    const inferredType = classifyPageType(candidateUrl);
    if (inferredType === "other") continue;
    if (inferredType === "agenda" && haveType.has("agenda")) continue;
    if (inferredType === "about" && haveType.has("about")) continue;
    if (inferredType === "sponsors" && haveType.has("sponsors")) continue;

    const html = await fetchPageHtml(candidateUrl);
    if (!html) continue;

    visited.add(candidateUrl);
    const extracted = extractText(html, candidateUrl, inferredType);
    pages.push(pagePayload(candidateUrl, inferredType, extracted));
    haveType.add(inferredType);
  }
}

export async function attemptScrapeEventSite(eventUrl: string): Promise<ScrapeAttemptResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(eventUrl);
  } catch {
    return { ok: false, reason: "network" };
  }

  const normalizedBase = parsedUrl.toString().replace(/\/$/, "");
  const homepageResult = await fetchPage(normalizedBase);

  if (!homepageResult.ok) {
    return {
      ok: false,
      reason: homepageResult.reason,
      status: homepageResult.status,
    };
  }

  const homepageHtml = homepageResult.html;

  const pages: ScrapedPage[] = [];
  const visited = new Set<string>();

  const homepage = extractText(homepageHtml, normalizedBase, "homepage");
  pages.push(pagePayload(normalizedBase, "homepage", homepage));
  visited.add(normalizedBase);

  const candidateUrls = discoverLinks(normalizedBase, homepageHtml);

  const priorityOrder: ScrapedPage["pageType"][] = [
    "agenda",
    "about",
    "sponsors",
    "exhibitors",
    "speakers",
    "other",
  ];
  const sortedCandidates = candidateUrls.sort((a, b) => {
    const typeA = classifyPageType(a);
    const typeB = classifyPageType(b);
    const priorityDiff = priorityOrder.indexOf(typeA) - priorityOrder.indexOf(typeB);
    if (priorityDiff !== 0) return priorityDiff;
    const listingA = isListingPageUrl(a) ? 0 : 1;
    const listingB = isListingPageUrl(b) ? 0 : 1;
    return listingA - listingB;
  });

  for (const url of sortedCandidates) {
    if (pages.length >= MAX_PAGES) break;
    if (visited.has(url)) continue;

    const html = await fetchPageHtml(url);
    if (!html) continue;

    visited.add(url);
    const pageType = classifyPageType(url);
    const extracted = extractText(html, url, pageType);
    pages.push(pagePayload(url, pageType, extracted));
  }

  await ensureTopicPages(pages, visited, normalizedBase);

  return { ok: true, pages };
}

export async function scrapeEventSite(eventUrl: string): Promise<ScrapedPage[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(eventUrl);
  } catch {
    throw new Error("Invalid URL. Please enter a valid event website URL.");
  }

  const result = await attemptScrapeEventSite(parsedUrl.toString());
  if (!result.ok) {
    throw new Error(
      fetchFailureMessage(
        { ok: false, reason: result.reason, status: result.status },
        eventUrl
      )
    );
  }
  return result.pages;
}

export function buildCorpus(pages: ScrapedPage[]): string {
  const weights: Record<ScrapedPage["pageType"], string> = {
    homepage: "HOMEPAGE — event title, tagline, positioning",
    agenda: "AGENDA — tracks, sessions, themes (highest topic signal)",
    about: "ABOUT",
    speakers: "SPEAKERS",
    sponsors: "SPONSORS/PARTNERS — industry focus signal",
    exhibitors: "EXHIBITORS — industry focus signal",
    other: "OTHER",
  };

  const ordered = [...pages].sort((a, b) => {
    const priority: ScrapedPage["pageType"][] = [
      "agenda",
      "homepage",
      "about",
      "sponsors",
      "exhibitors",
      "speakers",
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
