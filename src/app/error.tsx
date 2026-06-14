"use client";

import { getErrorMessage } from "@/lib/error-message";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
      <h2 className="text-lg font-semibold text-rose-900">Something went wrong</h2>
      <p className="mt-2 text-sm text-rose-800">{getErrorMessage(error)}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        Try again
      </button>
    </div>
  );
}
