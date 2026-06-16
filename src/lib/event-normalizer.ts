import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { EventDetailsTab, OrganizationRow } from "./types";
import type { RawSheetsExtraction } from "./event-extractor";
import { finalizeEventDetails } from "./event-extractor";

const OrgRowSchema = z.object({
  tierRank: z.number(),
  tierLabel: z.string(),
  name: z.string(),
  website: z.string().nullable(),
});

const NormalizedSchema = z.object({
  eventDetails: z.object({
    eventSeries: z.string().nullable(),
    eventEdition: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    attendees: z.string().nullable(),
    region: z.string().nullable(),
    stateProvince: z.string().nullable(),
    city: z.string().nullable(),
    venue: z.string().nullable(),
    venueWebsite: z.string().nullable(),
    venueGoogleMap: z.string().nullable(),
    organizer: z.string().nullable(),
    organizerWebsite: z.string().nullable(),
  }),
  sponsors: z.array(OrgRowSchema),
  exhibitors: z.array(OrgRowSchema),
});

function filterToKnownOrgs(original: OrganizationRow[], normalized: OrganizationRow[]): OrganizationRow[] {
  if (original.length === 0) return normalized;
  const originalNames = new Set(original.map((o) => o.name.toLowerCase()));
  const filtered = normalized.filter((n) => originalNames.has(n.name.toLowerCase()));
  return filtered.length > 0 ? filtered : original;
}

export async function normalizeEventData(
  raw: RawSheetsExtraction,
  corpusSnippet: string
): Promise<{
  eventDetails: EventDetailsTab;
  sponsors: OrganizationRow[];
  exhibitors: OrganizationRow[];
}> {
  const baseDetails = finalizeEventDetails({
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
    topics: raw.eventDetails.topics ?? "",
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { eventDetails: baseDetails, sponsors: raw.sponsors, exhibitors: raw.exhibitors };
  }

  const openai = new OpenAI({ apiKey });

  const completion = await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You clean and normalize scraped event data for a Google Sheet export.

Rules:
1. Fix formatting of dates to "D MMM YYYY" (e.g. "12 Nov 2025")
2. eventSeries = the event name only (no year), e.g. "Singapore FinTech Festival"
3. eventEdition = eventSeries + year, e.g. "Singapore FinTech Festival 2026"
4. venue = physical venue name only (e.g. "Singapore EXPO"), not city or country
5. Leave event logo blank — do not return or invent a logo URL
6. Clean company names (proper casing, remove noise like "logo", file extensions)
7. Deduplicate sponsors and exhibitors by name
8. NEVER add sponsors or exhibitors that are not in the input lists
9. For website URLs: keep only URLs that were scraped or resolved from profile pages — never invent or guess company websites
10. Infer region (e.g. APAC) from city/country when obvious
11. For tier_label, use headings from the site (Grand Sponsors, Platinium Sponsors, Pavilion, Exhibitor)
12. tier_rank: 1 = highest tier / Pavilion, 2 = next tier / Exhibitor, etc.`,
      },
      {
        role: "user",
        content: `Normalize this event data.

SCRAPED CORPUS SNIPPET:
${corpusSnippet.slice(0, 8000)}

RAW EVENT DETAILS:
${JSON.stringify(raw.eventDetails, null, 2)}

RAW SPONSORS (${raw.sponsors.length}):
${JSON.stringify(raw.sponsors.slice(0, 80), null, 2)}

RAW EXHIBITORS (${raw.exhibitors.length}):
${JSON.stringify(raw.exhibitors.slice(0, 80), null, 2)}`,
      },
    ],
    response_format: zodResponseFormat(NormalizedSchema, "normalized_event"),
    temperature: 0.1,
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    return { eventDetails: baseDetails, sponsors: raw.sponsors, exhibitors: raw.exhibitors };
  }

  const eventDetails = finalizeEventDetails({
    ...baseDetails,
    eventLogo: null,
    eventSeries: parsed.eventDetails.eventSeries ?? baseDetails.eventSeries,
    eventEdition: parsed.eventDetails.eventEdition ?? baseDetails.eventEdition,
    startDate: parsed.eventDetails.startDate ?? baseDetails.startDate,
    endDate: parsed.eventDetails.endDate ?? baseDetails.endDate,
    attendees: parsed.eventDetails.attendees ?? baseDetails.attendees,
    region: parsed.eventDetails.region ?? baseDetails.region,
    stateProvince: parsed.eventDetails.stateProvince ?? baseDetails.stateProvince,
    city: parsed.eventDetails.city ?? baseDetails.city,
    venue: parsed.eventDetails.venue ?? baseDetails.venue,
    venueWebsite: parsed.eventDetails.venueWebsite ?? baseDetails.venueWebsite,
    venueGoogleMap: parsed.eventDetails.venueGoogleMap ?? baseDetails.venueGoogleMap,
    organizer: parsed.eventDetails.organizer ?? baseDetails.organizer,
    organizerWebsite: parsed.eventDetails.organizerWebsite ?? baseDetails.organizerWebsite,
  });

  const sponsors = filterToKnownOrgs(raw.sponsors, parsed.sponsors);
  const exhibitors = filterToKnownOrgs(raw.exhibitors, parsed.exhibitors);

  return {
    eventDetails,
    sponsors: sponsors.length > 0 ? sponsors : raw.sponsors,
    exhibitors: exhibitors.length > 0 ? exhibitors : raw.exhibitors,
  };
}
