import type { ScrapedPage } from "./types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 8;
const CONTENT_LENGTH = 7000;

export type TavilyErrorCode =
  | "missing_key"
  | "auth"
  | "quota"
  | "network"
  | "empty_results"
  | "unknown";

export class TavilySearchError extends Error {
  readonly code: TavilyErrorCode;
  readonly status?: number;

  constructor(message: string, code: TavilyErrorCode, status?: number) {
    super(message);
    this.name = "TavilySearchError";
    this.code = code;
    this.status = status;
  }
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  results?: TavilyResult[];
  error?: string;
}

function eventSearchQuery(eventUrl: string): string {
  let hostname = eventUrl;
  try {
    hostname = new URL(eventUrl).hostname.replace(/^www\./, "");
  } catch {
    // keep raw url fragment
  }

  return [
    `"${hostname}" event conference`,
    "main topics themes tracks agenda summits program pillars",
    "what is this event about",
  ].join(" ");
}

function classifyTavilyHttpError(status: number, detail: string): TavilySearchError {
  if (status === 401 || status === 403) {
    return new TavilySearchError(
      "Tavily API key is invalid or unauthorized.",
      "auth",
      status
    );
  }
  if (status === 429) {
    return new TavilySearchError(
      "Tavily monthly credits are exhausted.",
      "quota",
      status
    );
  }
  return new TavilySearchError(
    `Tavily web search failed (HTTP ${status}).${detail ? ` ${detail.slice(0, 200)}` : ""}`,
    "unknown",
    status
  );
}

function pagesFromSearchResults(eventUrl: string, results: TavilyResult[]): ScrapedPage[] {
  const usable = results.filter((r) => r.content.trim().length > 80).slice(0, MAX_RESULTS);

  if (usable.length === 0) {
    throw new TavilySearchError(
      "Tavily web search did not return enough content to classify this event.",
      "empty_results"
    );
  }

  return usable.map((result, index) => ({
    url: result.url,
    title: result.title || "Web search result",
    content: [
      `Source: Tavily public web search (event site blocked)`,
      `Original event URL: ${eventUrl}`,
      `Relevance score: ${result.score.toFixed(2)}`,
      result.content.trim(),
    ]
      .join("\n")
      .slice(0, CONTENT_LENGTH),
    pageType: index === 0 ? "homepage" : "other",
  }));
}

export function isTavilyFallbackError(error: TavilySearchError): boolean {
  return (
    error.code === "quota" ||
    error.code === "network" ||
    error.code === "empty_results" ||
    error.code === "unknown"
  );
}

export function tavilyFallbackWarning(error: TavilySearchError): string {
  switch (error.code) {
    case "quota":
      return "Tavily credits are exhausted — classified using OpenAI web search instead.";
    case "empty_results":
      return "Tavily returned thin results — classified using OpenAI web search instead.";
    case "network":
      return "Tavily was unreachable — classified using OpenAI web search instead.";
    default:
      return "Tavily web search failed — classified using OpenAI web search instead.";
  }
}

export async function fetchEventContentViaTavily(eventUrl: string): Promise<ScrapedPage[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new TavilySearchError(
      "Tavily is not configured. Add TAVILY_API_KEY to .env.local or rely on OpenAI web search fallback.",
      "missing_key"
    );
  }

  let response: Response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: eventSearchQuery(eventUrl),
        search_depth: "advanced",
        max_results: MAX_RESULTS,
        include_answer: false,
      }),
    });
  } catch {
    throw new TavilySearchError("Could not reach Tavily web search.", "network");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw classifyTavilyHttpError(response.status, detail);
  }

  const data = (await response.json()) as TavilySearchResponse;
  if (data.error) {
    if (/credit|quota|limit/i.test(data.error)) {
      throw new TavilySearchError(data.error, "quota");
    }
    throw new TavilySearchError(`Tavily error: ${data.error}`, "unknown");
  }

  return pagesFromSearchResults(eventUrl, data.results ?? []);
}

/** @deprecated Use fetchEventContentViaTavily */
export async function fetchEventContentViaWebSearch(eventUrl: string): Promise<ScrapedPage[]> {
  return fetchEventContentViaTavily(eventUrl);
}
