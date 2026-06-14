import { NextResponse } from "next/server";
import { buildXlsxWorkbook } from "@/lib/sheets-export";
import type { SheetsExport } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sheets?: SheetsExport; filename?: string };
    const sheets = body.sheets;

    if (!sheets?.eventDetails) {
      return NextResponse.json({ error: "Sheets data is required." }, { status: 400 });
    }

    const buffer = buildXlsxWorkbook(sheets);
    const filename = body.filename?.replace(/[^\w.-]+/g, "-") || "event-export.xlsx";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
