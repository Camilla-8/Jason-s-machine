export interface Tag {
  slug: string;
  name: string;
  description: string;
  synonyms: string[];
  negative_signals: string[];
  related_tags: string[];
}

export interface TagRecommendation {
  slug: string;
  name: string;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface SuggestedNewTag {
  name: string;
  confidence: number;
  reason: string;
  description: string;
  synonyms: string[];
}

export const CONFIDENCE_THRESHOLD = 0.55;
export const MAX_PRIMARY_TOPICS = 3;

export interface ClassificationResult {
  recommended_tags: TagRecommendation[];
  suggested_new_tag: SuggestedNewTag | null;
  overall_confidence: "high" | "medium" | "low";
  summary: string;
}

export type ScrapedPageType =
  | "homepage"
  | "about"
  | "agenda"
  | "speakers"
  | "sponsors"
  | "exhibitors"
  | "other";

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  pageType: ScrapedPageType;
  /** Raw HTML retained for structured extraction on key pages */
  html?: string;
}

export interface EventDetailsTab {
  eventWebsite: string;
  eventLogo: string | null;
  eventSeries: string | null;
  eventEdition: string | null;
  startDate: string | null;
  endDate: string | null;
  attendees: string | null;
  region: string | null;
  stateProvince: string | null;
  city: string | null;
  venue: string | null;
  venueWebsite: string | null;
  venueGoogleMap: string | null;
  organizer: string | null;
  organizerWebsite: string | null;
  topics: string;
}

export interface OrganizationRow {
  tierRank: number;
  tierLabel: string;
  name: string;
  website: string | null;
}

export interface SheetsExport {
  eventDetails: EventDetailsTab;
  sponsors: OrganizationRow[];
  exhibitors: OrganizationRow[];
}

export type ApiErrorCode =
  | "openai_missing_key"
  | "openai_auth"
  | "openai_quota"
  | "openai_rate_limit"
  | "openai_error"
  | "tavily_missing_key"
  | "tavily_auth"
  | "tavily_quota"
  | "tavily_error"
  | "web_search_failed"
  | "scan_failed";

export type ScanSource = "direct" | "web_search_tavily" | "web_search_openai";

export interface ScanResult {
  eventUrl: string;
  topics: string;
  classification: ClassificationResult;
  pages: Array<Omit<ScrapedPage, "html">>;
  scannedAt: string;
  source: ScanSource;
  sourceNote?: string;
  sourceWarning?: string;
  proposalQueued?: boolean;
  proposalId?: string;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "merged";

export interface TagProposal {
  id: string;
  eventUrl: string;
  suggestedName: string;
  suggestedDescription: string;
  suggestedSynonyms: string[];
  reason: string;
  evidence: string[];
  aiRecommendations: ClassificationResult;
  staffNote: string;
  proposedBy: string;
  status: ProposalStatus;
  reviewNote: string | null;
  mergedIntoSlug: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AppliedEvent {
  id: string;
  eventUrl: string;
  tags: string[];
  scanResult: ScanResult;
  appliedAt: string;
  appliedBy: string;
}

export const EVENT_DETAIL_FIELDS: Array<keyof EventDetailsTab> = [
  "eventWebsite",
  "eventLogo",
  "eventSeries",
  "eventEdition",
  "startDate",
  "endDate",
  "attendees",
  "region",
  "stateProvince",
  "city",
  "venue",
  "venueWebsite",
  "venueGoogleMap",
  "organizer",
  "organizerWebsite",
  "topics",
];

export const EVENT_DETAIL_LABELS: Record<keyof EventDetailsTab, string> = {
  eventWebsite: "Event Website",
  eventLogo: "Event logo",
  eventSeries: "Event Series",
  eventEdition: "Event Edition",
  startDate: "Start Date",
  endDate: "End Date",
  attendees: "Attendees",
  region: "Region",
  stateProvince: "State/Province",
  city: "City",
  venue: "Venue",
  venueWebsite: "Venue Website",
  venueGoogleMap: "Venue Google Map",
  organizer: "Organizer",
  organizerWebsite: "Organizer Website",
  topics: "Topics",
};
