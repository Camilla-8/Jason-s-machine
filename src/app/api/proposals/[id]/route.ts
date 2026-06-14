import { NextResponse } from "next/server";
import { getProposalById, updateProposal } from "@/lib/proposals";
import { addApprovedTag, getTagBySlug } from "@/lib/tags";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const proposal = await getProposalById(id);

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  return NextResponse.json({ proposal });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "approve" | "reject" | "merge";
      reviewNote?: string;
      mergedIntoSlug?: string;
      editedName?: string;
      editedDescription?: string;
      editedSynonyms?: string[];
    };

    const proposal = await getProposalById(id);
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }

    if (proposal.status !== "pending") {
      return NextResponse.json({ error: "Proposal has already been reviewed." }, { status: 400 });
    }

    const reviewedAt = new Date().toISOString();

    if (body.action === "approve") {
      const newTag = await addApprovedTag({
        name: body.editedName ?? proposal.suggestedName,
        description: body.editedDescription ?? proposal.suggestedDescription,
        synonyms: body.editedSynonyms ?? proposal.suggestedSynonyms,
        negative_signals: [],
        related_tags: [],
      });

      const updated = await updateProposal(id, {
        status: "approved",
        reviewNote: body.reviewNote ?? `Approved as "${newTag.name}"`,
        reviewedAt,
      });

      return NextResponse.json({ proposal: updated, tag: newTag });
    }

    if (body.action === "merge") {
      if (!body.mergedIntoSlug) {
        return NextResponse.json({ error: "mergedIntoSlug is required for merge." }, { status: 400 });
      }

      const existingTag = await getTagBySlug(body.mergedIntoSlug);
      if (!existingTag) {
        return NextResponse.json({ error: "Target tag not found." }, { status: 400 });
      }

      const updated = await updateProposal(id, {
        status: "merged",
        mergedIntoSlug: body.mergedIntoSlug,
        reviewNote: body.reviewNote ?? `Merged into "${existingTag.name}"`,
        reviewedAt,
      });

      return NextResponse.json({ proposal: updated, tag: existingTag });
    }

    if (body.action === "reject") {
      const updated = await updateProposal(id, {
        status: "rejected",
        reviewNote: body.reviewNote ?? "Rejected",
        reviewedAt,
      });

      return NextResponse.json({ proposal: updated });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
