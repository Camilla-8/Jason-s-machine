import { NextResponse } from "next/server";
import { createProposal, getProposals } from "@/lib/proposals";
import type { ClassificationResult } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as "pending" | "approved" | "rejected" | "merged" | null;

  const proposals = await getProposals(status ?? undefined);
  return NextResponse.json({ proposals });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      eventUrl?: string;
      suggestedName?: string;
      suggestedDescription?: string;
      suggestedSynonyms?: string[];
      reason?: string;
      evidence?: string[];
      aiRecommendations?: ClassificationResult;
      staffNote?: string;
      proposedBy?: string;
    };

    if (!body.eventUrl || !body.suggestedName || !body.reason || !body.aiRecommendations) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const proposal = await createProposal({
      eventUrl: body.eventUrl,
      suggestedName: body.suggestedName,
      suggestedDescription: body.suggestedDescription ?? "",
      suggestedSynonyms: body.suggestedSynonyms ?? [],
      reason: body.reason,
      evidence: body.evidence ?? [],
      aiRecommendations: body.aiRecommendations,
      staffNote: body.staffNote ?? "",
      proposedBy: body.proposedBy ?? "staff",
    });

    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create proposal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
