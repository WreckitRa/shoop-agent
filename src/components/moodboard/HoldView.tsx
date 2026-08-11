"use client";

import Link from "next/link";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";

export function HoldView({ onGoBoard }: { onGoBoard?: () => void }) {
  return (
    <div className="shoop-decide__hold">
      <div className="shoop-decide__soon-banner" role="status">
        <span className="shoop-decide__soon-pill">Coming soon</span>
        <p>
          <b>The Hold isn&apos;t live yet.</b> You can&apos;t park a look here
          today — this tab is a preview of what&apos;s next.
        </p>
      </div>

      <div className="shoop-decide__holdnote">
        <span className="shoop-decide__holdnote-k" aria-hidden />
        <p>
          When it ships: a hold is not storage. You said yes, so I&apos;ll watch{" "}
          <b>price, your size, and the delivery date</b> for seven days — then
          it goes back to the moodboard unless you tell me otherwise.
        </p>
      </div>

      <p className="shoop-decide__empty">
        Nothing on hold — and nothing can be yet. Use the moodboard to keep
        loves; Buy now when you&apos;re ready.
      </p>

      <div className="shoop-decide__hold-ctas">
        <button
          type="button"
          className="shoop-decide__mini shoop-decide__mini--solid"
          onClick={() => onGoBoard?.()}
        >
          Back to moodboard
        </button>
        <Link href={NEW_CHAT_PATH} className="shoop-decide__mini">
          Keep finding
        </Link>
      </div>
    </div>
  );
}
