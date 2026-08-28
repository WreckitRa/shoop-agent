import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-[11px] font-extrabold tracking-[0.18em] text-ink-muted">
        SHOOP
      </p>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
        Page not found
      </h1>
      <p className="max-w-sm text-sm text-ink-muted">
        That link doesn&apos;t go anywhere — head back and keep shopping.
      </p>
      <Link
        href="/"
        className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
      >
        Back to Shoop
      </Link>
    </main>
  );
}
