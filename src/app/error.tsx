"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-[11px] font-extrabold tracking-[0.18em] text-ink-muted">
        SHOOP
      </p>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Let&apos;s get you back to shopping.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-hairline px-4 py-2 text-sm font-semibold text-ink"
        >
          Back to Shoop
        </a>
      </div>
    </main>
  );
}
