import { attemptScrapeEventSite } from "./scraper";
import { fetchEventContentViaOpenAIWebSearch } from "./openai-web-search-fallback";
import {
  fetchEventContentViaTavily,
  isTavilyFallbackError,
  TavilySearchError,
  tavilyFallbackWarning,
} from "./web-search-fallback";
import { eventUrlVariants } from "./url-variants";
import type { ScanSource, ScrapedPage } from "./types";

export interface EventIngestResult {
  pages: ScrapedPage[];
  source: ScanSource;
  sourceNote?: string;
  sourceWarning?: string;
}

const BLOCKED_TAVILY_NOTE =
  "The event website blocked automated access. Topics were classified from Tavily public web search.";

const BLOCKED_OPENAI_NOTE =
  "The event website blocked automated access. Topics were classified from OpenAI public web search.";

async function fetchViaWebSearch(eventUrl: string): Promise<{
  pages: ScrapedPage[];
  source: ScanSource;
  sourceNote: string;
  sourceWarning?: string;
}> {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();

  if (tavilyKey) {
    try {
      const pages = await fetchEventContentViaTavily(eventUrl);
      return {
        pages,
        source: "web_search_tavily",
        sourceNote: BLOCKED_TAVILY_NOTE,
      };
    } catch (error) {
      if (error instanceof TavilySearchError) {
        if (error.code === "auth") {
          throw error;
        }
        if (isTavilyFallbackError(error)) {
          const pages = await fetchEventContentViaOpenAIWebSearch(eventUrl);
          return {
            pages,
            source: "web_search_openai",
            sourceNote: BLOCKED_OPENAI_NOTE,
            sourceWarning: tavilyFallbackWarning(error),
          };
        }
      }
      throw error;
    }
  }

  const pages = await fetchEventContentViaOpenAIWebSearch(eventUrl);
  return {
    pages,
    source: "web_search_openai",
    sourceNote: BLOCKED_OPENAI_NOTE,
    sourceWarning:
      "Tavily is not configured — classified using OpenAI web search instead. Add TAVILY_API_KEY for the primary search fallback.",
  };
}

export async function ingestEventContent(eventUrl: string): Promise<EventIngestResult> {
  try {
    new URL(eventUrl);
  } catch {
    throw new Error("Invalid URL. Please enter a valid event website URL.");
  }

  const normalizedInput = eventUrl.replace(/\/$/, "");
  const variants = eventUrlVariants(eventUrl);

  for (const candidate of variants) {
    const result = await attemptScrapeEventSite(candidate);
    if (result.ok) {
      return {
        pages: result.pages,
        source: "direct",
        sourceNote:
          candidate !== normalizedInput ? `Read via alternate URL: ${candidate}` : undefined,
      };
    }

    if (result.reason !== "blocked" && result.reason !== "timeout") {
      continue;
    }
  }

  const webSearch = await fetchViaWebSearch(eventUrl);
  return {
    pages: webSearch.pages,
    source: webSearch.source,
    sourceNote: webSearch.sourceNote,
    sourceWarning: webSearch.sourceWarning,
  };
}
