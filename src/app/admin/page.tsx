"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tag, TagProposal } from "@/lib/types";

export default function AdminPage() {
  const [proposals, setProposals] = useState<TagProposal[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [mergeSlug, setMergeSlug] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [proposalsRes, tagsRes] = await Promise.all([
      fetch("/api/proposals"),
      fetch("/api/tags"),
    ]);
    const proposalsData = (await proposalsRes.json()) as { proposals: TagProposal[] };
    const tagsData = (await tagsRes.json()) as { tags: Tag[] };
    setProposals(proposalsData.proposals);
    setTags(tagsData.tags);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReview(id: string, action: "approve" | "reject" | "merge") {
    setReviewingId(id);
    setMessage(null);

    const res = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        reviewNote,
        mergedIntoSlug: action === "merge" ? mergeSlug : undefined,
        editedName: action === "approve" ? editedName : undefined,
        editedDescription: action === "approve" ? editedDescription : undefined,
      }),
    });

    const data = (await res.json()) as { error?: string; tag?: Tag };
    setReviewingId(null);

    if (!res.ok) {
      setMessage(data.error ?? "Review failed");
      return;
    }

    if (action === "approve" && data.tag) {
      setMessage(`Approved and added "${data.tag.name}" to the dictionary.`);
    } else if (action === "merge") {
      setMessage("Proposal merged into existing tag.");
    } else {
      setMessage("Proposal rejected.");
    }

    setReviewNote("");
    setEditedName("");
    setEditedDescription("");
    setMergeSlug("");
    await load();
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const reviewed = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Admin — Tag proposals</h1>
        <p className="mt-2 text-stone-600">
          Review tag suggestions auto-queued from scans. Approve new tags to add them to the
          dictionary, merge into an existing tag, or reject.
        </p>
      </section>

      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          {message}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold">
          Pending ({pending.length})
        </h2>

        {loading ? (
          <p className="mt-4 text-sm text-stone-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-4 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">
            No pending proposals.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            {pending.map((proposal) => (
              <article
                key={proposal.id}
                className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{proposal.suggestedName}</h3>
                    <p className="mt-1 text-sm text-stone-500">
                      <a
                        href={proposal.eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {proposal.eventUrl}
                      </a>
                      {" · "}
                      {new Date(proposal.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    pending
                  </span>
                </div>

                <p className="mt-4 text-sm text-stone-700">{proposal.reason}</p>

                {proposal.suggestedDescription && (
                  <p className="mt-2 text-sm text-stone-600">{proposal.suggestedDescription}</p>
                )}

                {proposal.staffNote && (
                  <div className="mt-3 rounded-md bg-stone-50 p-3 text-sm text-stone-600">
                    <span className="font-medium">Staff note:</span> {proposal.staffNote}
                  </div>
                )}

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                    AI recommended
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {proposal.aiRecommendations.recommended_tags?.map((t) => (
                      <span
                        key={t.slug}
                        className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700"
                      >
                        {t.name} ({Math.round(t.confidence * 100)}%)
                      </span>
                    )) ?? (
                      <span className="text-xs text-stone-400">No dictionary tags recommended</span>
                    )}
                  </div>
                </div>

                <div className="mt-6 space-y-3 border-t border-stone-100 pt-4">
                  <input
                    type="text"
                    placeholder="Review note (optional)"
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="Tag name (edit before approve)"
                      value={editedName || proposal.suggestedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Description (edit before approve)"
                      value={editedDescription || proposal.suggestedDescription}
                      onChange={(e) => setEditedDescription(e.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={mergeSlug}
                      onChange={(e) => setMergeSlug(e.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    >
                      <option value="">Merge into existing tag…</option>
                      {tags.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={reviewingId === proposal.id}
                      onClick={() => handleReview(proposal.id, "approve")}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Approve & add to dictionary
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === proposal.id || !mergeSlug}
                      onClick={() => handleReview(proposal.id, "merge")}
                      className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                    >
                      Merge into existing
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === proposal.id}
                      onClick={() => handleReview(proposal.id, "reject")}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Reviewed ({reviewed.length})</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3">Suggested tag</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {reviewed.map((p) => (
                  <tr key={p.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.suggestedName}</td>
                    <td className="px-4 py-3 text-stone-500">
                      <a href={p.eventUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        Link
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === "approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.status === "merged"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-500">
                      {p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Current dictionary ({tags.length} tags)</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700"
              title={tag.description}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
