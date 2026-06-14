import { NextResponse } from "next/server";
import { getApprovedTags } from "@/lib/tags";

export async function GET() {
  const tags = await getApprovedTags();
  return NextResponse.json({ tags });
}
