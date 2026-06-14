import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ClassificationResult, ProposalStatus, TagProposal } from "./types";

const PROPOSALS_PATH = path.join(process.cwd(), "data", "proposals.json");

interface ProposalsFile {
  proposals: TagProposal[];
}

async function readProposalsFile(): Promise<ProposalsFile> {
  const raw = await fs.readFile(PROPOSALS_PATH, "utf-8");
  return JSON.parse(raw) as ProposalsFile;
}

async function writeProposalsFile(data: ProposalsFile): Promise<void> {
  await fs.writeFile(PROPOSALS_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function getProposals(status?: ProposalStatus): Promise<TagProposal[]> {
  const data = await readProposalsFile();
  if (!status) return data.proposals;
  return data.proposals.filter((p) => p.status === status);
}

export async function getProposalById(id: string): Promise<TagProposal | undefined> {
  const data = await readProposalsFile();
  return data.proposals.find((p) => p.id === id);
}

export async function createProposal(input: {
  eventUrl: string;
  suggestedName: string;
  suggestedDescription: string;
  suggestedSynonyms: string[];
  reason: string;
  evidence: string[];
  aiRecommendations: ClassificationResult;
  staffNote: string;
  proposedBy: string;
}): Promise<TagProposal> {
  const data = await readProposalsFile();

  const proposal: TagProposal = {
    id: randomUUID(),
    eventUrl: input.eventUrl,
    suggestedName: input.suggestedName,
    suggestedDescription: input.suggestedDescription,
    suggestedSynonyms: input.suggestedSynonyms,
    reason: input.reason,
    evidence: input.evidence,
    aiRecommendations: input.aiRecommendations,
    staffNote: input.staffNote,
    proposedBy: input.proposedBy,
    status: "pending",
    reviewNote: null,
    mergedIntoSlug: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
  };

  data.proposals.unshift(proposal);
  await writeProposalsFile(data);
  return proposal;
}

export async function updateProposal(
  id: string,
  update: Partial<Pick<TagProposal, "status" | "reviewNote" | "mergedIntoSlug" | "reviewedAt">>
): Promise<TagProposal | undefined> {
  const data = await readProposalsFile();
  const index = data.proposals.findIndex((p) => p.id === id);
  if (index === -1) return undefined;

  data.proposals[index] = { ...data.proposals[index], ...update };
  await writeProposalsFile(data);
  return data.proposals[index];
}

export async function getPendingCount(): Promise<number> {
  const data = await readProposalsFile();
  return data.proposals.filter((p) => p.status === "pending").length;
}
