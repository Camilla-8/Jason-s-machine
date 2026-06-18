import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import type { ScrapedPage } from "./types";

const CONTENT_LENGTH = 7000;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to your .env.local file.");
  }
  return new OpenAI({ apiKey });
}

function eventResearchPrompt(eventUrl: string): string {
  let hostname = eventUrl;
  try {
    hostname = new URL(eventUrl).hostname.replace(/^www\./, "");
  } catch {
    // keep raw url
  }

  return `Research the event website ${eventUrl} (${hostname}).

Return a factual briefing for event classification:
- Official event name and tagline
- What the event is mainly about (primary themes)
- Named summits, stages, tracks, or program pillars
- Major industry topics emphasized in marketing and agenda
- Organizer and scale if publicly stated

Focus on sustained primary topics, not one-off mentions.`;
}

function getResponseOutputText(response: Response): string {
  const withOutputText = response as Response & { output_text?: string };
  if (typeof withOutputText.output_text === "string" && withOutputText.output_text.trim()) {
    return withOutputText.output_text.trim();
  }

  const texts: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "output_text" && content.text.trim()) {
        texts.push(content.text.trim());
      }
    }
  }
  return texts.join("\n\n");
}

function extractUrlCitations(response: Response): Array<{ url: string; title: string }> {
  const citations: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type !== "output_text") continue;
      for (const annotation of content.annotations) {
        if (annotation.type !== "url_citation") continue;
        if (seen.has(annotation.url)) continue;
        seen.add(annotation.url);
        citations.push({
          url: annotation.url,
          title: annotation.title || annotation.url,
        });
      }
    }
  }

  return citations;
}

function pagesFromOpenAIResearch(
  eventUrl: string,
  researchText: string,
  citations: Array<{ url: string; title: string }>
): ScrapedPage[] {
  const pages: ScrapedPage[] = [
    {
      url: eventUrl,
      title: "OpenAI web research summary",
      pageType: "homepage",
      content: [
        "Source: OpenAI web search (event site blocked; Tavily unavailable or exhausted)",
        `Original event URL: ${eventUrl}`,
        researchText,
      ]
        .join("\n")
        .slice(0, CONTENT_LENGTH),
    },
  ];

  for (const citation of citations.slice(0, 7)) {
    pages.push({
      url: citation.url,
      title: citation.title,
      pageType: "other",
      content: `Cited public source: ${citation.title}\nURL: ${citation.url}`,
    });
  }

  if (researchText.trim().length < 120) {
    throw new Error(
      "OpenAI web search did not return enough content to classify this event. Try a different URL or try again later."
    );
  }

  return pages;
}

export async function fetchEventContentViaOpenAIWebSearch(
  eventUrl: string
): Promise<ScrapedPage[]> {
  const openai = getOpenAIClient();

  const response = await openai.responses.create({
    model: "gpt-4o",
    tools: [{ type: "web_search_preview" }],
    input: eventResearchPrompt(eventUrl),
  });

  const researchText = getResponseOutputText(response);
  const citations = extractUrlCitations(response);
  return pagesFromOpenAIResearch(eventUrl, researchText, citations);
}
