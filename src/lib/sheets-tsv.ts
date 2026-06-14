import {
  EVENT_DETAIL_FIELDS,
  EVENT_DETAIL_LABELS,
  type EventDetailsTab,
  type OrganizationRow,
} from "./types";

function escapeTsvCell(value: string): string {
  if (value.includes("\t") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toTab1Tsv(details: EventDetailsTab): string {
  return EVENT_DETAIL_FIELDS.map((field) => {
    const label = EVENT_DETAIL_LABELS[field];
    const value = details[field] ?? "";
    return `${escapeTsvCell(label)}\t${escapeTsvCell(String(value))}`;
  }).join("\n");
}

export function toOrgTableTsv(rows: OrganizationRow[]): string {
  const header = "tier_rank\ttier_label\tName\tWebsite";
  const lines = rows.map((r) =>
    [r.tierRank, r.tierLabel, r.name, r.website ?? ""].map((c) => escapeTsvCell(String(c))).join("\t")
  );
  return [header, ...lines].join("\n");
}

export function toTab2Tsv(sponsors: OrganizationRow[]): string {
  return toOrgTableTsv(sponsors);
}

export function toTab3Tsv(exhibitors: OrganizationRow[]): string {
  return toOrgTableTsv(exhibitors);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
