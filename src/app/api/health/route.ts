import { NextResponse } from "next/server";
import { getEnvStatus } from "@/lib/env-status";

export async function GET() {
  const status = getEnvStatus();
  return NextResponse.json(status);
}
