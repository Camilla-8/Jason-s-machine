import * as XLSX from "xlsx";
import {
  EVENT_DETAIL_FIELDS,
  EVENT_DETAIL_LABELS,
  type SheetsExport,
} from "./types";

export function buildXlsxWorkbook(sheets: SheetsExport): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const tab1Rows = EVENT_DETAIL_FIELDS.map((field) => [
    EVENT_DETAIL_LABELS[field],
    sheets.eventDetails[field] ?? "",
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet(tab1Rows);
  XLSX.utils.book_append_sheet(wb, ws1, "Event details");

  const orgHeader = ["tier_rank", "tier_label", "Name", "Website"];
  const ws2 = XLSX.utils.aoa_to_sheet([
    orgHeader,
    ...sheets.sponsors.map((r) => [r.tierRank, r.tierLabel, r.name, r.website ?? ""]),
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, "Sponsors");

  const ws3 = XLSX.utils.aoa_to_sheet([
    orgHeader,
    ...sheets.exhibitors.map((r) => [r.tierRank, r.tierLabel, r.name, r.website ?? ""]),
  ]);
  XLSX.utils.book_append_sheet(wb, ws3, "Exhibitors");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
