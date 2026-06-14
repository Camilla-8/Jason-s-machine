import * as cheerio from "cheerio";
import type { OrganizationRow } from "./types";

const FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_FETCHES = 120;
const DEFAULT_CONCURRENCY = 8;

const BLOCKED_HOST_PATTERNS = [
  /linkedin\.com/i,
  /facebook\.com/i,
  /twitter\.com/i,
  /x\.com/i,
  /instagram\.com/i,
  /youtube\.com/i,
  /t\.me/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /hubspot(?:usercontent)?/i,
  /cloudflare\.com/i,
  /w3\.org/i,
  /fonts\.googleapis\.com/i,
  /mas\.gov\.sg/i,
  /gftn\.co/i,
  /abs\.org\.sg/i,
  /fintechfestival\.sg/i,
  /inclusivefintechforum\.com/i,
  /pointzeroforum\.com/i,
  /gftnforum\.jp/i,
  /hubfs\//i,
  /cdnjs\.cloudflare\.com/i,
];

function resolveUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function isProfileUrl(url: string, eventOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === eventOrigin &&
      /\/(sponsors|exhibitors)\/[^/]+/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function isCompanyWebsiteUrl(url: string, eventOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.origin === eventOrigin) return false;
    const hostAndPath = `${parsed.hostname}${parsed.pathname}`;
    return !BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostAndPath));
  } catch {
    return false;
  }
}

function resolveWebsiteHref(pageUrl: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:")) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+(\/[^\s]*)?$/i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }

  return resolveUrl(pageUrl, href);
}

export function extractWebsiteFromProfileHtml(
  html: string,
  pageUrl: string,
  eventOrigin: string
): string | null {
  const $ = cheerio.load(html);
  let visitWebsite: string | null = null;
  let fallback: string | null = null;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const resolved = resolveWebsiteHref(pageUrl, href);
    if (!resolved || !isCompanyWebsiteUrl(resolved, eventOrigin)) return;

    const text = $(el).text().trim();
    if (/visit\s*website/i.test(text)) {
      visitWebsite = resolved;
      return false;
    }

    if (
      !fallback &&
      !/linkedin|facebook|twitter|instagram|youtube|telegram|inclusivefintechforum|pointzeroforum|gftnforum/i.test(
        resolved
      )
    ) {
      fallback = resolved;
    }
  });

  const chosen = visitWebsite ?? fallback;
  return chosen ? normalizeWebsiteUrl(chosen) : null;
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function enrichOrgWebsites(
  rows: OrganizationRow[],
  eventUrl: string,
  options?: { maxFetches?: number; concurrency?: number }
): Promise<OrganizationRow[]> {
  const maxFetches = options?.maxFetches ?? DEFAULT_MAX_FETCHES;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const eventOrigin = new URL(eventUrl).origin;

  const profileUrls = new Set<string>();
  for (const row of rows) {
    if (!row.website) continue;
    if (isProfileUrl(row.website, eventOrigin)) {
      profileUrls.add(row.website);
    }
  }

  const toFetch = Array.from(profileUrls).slice(0, maxFetches);
  const websiteByProfile = new Map<string, string>();

  if (toFetch.length > 0) {
    const fetched = await mapWithConcurrency(toFetch, concurrency, async (profileUrl) => {
      const html = await fetchPage(profileUrl);
      if (!html) return { profileUrl, website: null as string | null };
      const website = extractWebsiteFromProfileHtml(html, profileUrl, eventOrigin);
      return { profileUrl, website };
    });

    for (const { profileUrl, website } of fetched) {
      if (website) websiteByProfile.set(profileUrl, website);
    }
  }

  return rows.map((row) => {
    if (row.website && isCompanyWebsiteUrl(row.website, eventOrigin)) {
      return { ...row, website: normalizeWebsiteUrl(row.website) };
    }

    if (row.website && isProfileUrl(row.website, eventOrigin)) {
      const resolved = websiteByProfile.get(row.website) ?? null;
      return { ...row, website: resolved };
    }

    return row;
  });
}
