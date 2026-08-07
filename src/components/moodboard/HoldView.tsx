"use client";

import Link from "next/link";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";

export function HoldView({ onGoBoard }: { onGoBoard?: () => void }) {
  return (
    <div className="shoop-decide__hold">
      <div className="shoop-decide__holdnote">
        <span className="shoop-decide__holdnote-k" aria-hidden />
        <p>
          A hold is not storage. You said yes, so I&apos;m watching it for
          you… <b>price, your size, and the delivery date</b>. Seven days, then
          it goes back to the moodboard unless you tell me otherwise.
        </p>
      </div>

      <p className="shoop-decide__empty">
        Nothing on hold yet. When you say yes on a piece, it lands here while I
        watch it for you.
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
