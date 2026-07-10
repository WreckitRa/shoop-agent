import { createHash } from "node:crypto";

export function hashSystemPrompt(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Fire-and-forget upsert of prompt text by hash. */
export function upsertPromptVersion(params: {
  hash: string;
  stage: string;
  content: string;
}): void {
  void import("../db").then(({ fashionMemoryDb }) =>
    fashionMemoryDb()
      .from("prompt_versions")
      .upsert(
        {
          hash: params.hash,
          stage: params.stage,
          content: params.content,
        },
        { onConflict: "hash", ignoreDuplicates: true },
      )
      .then(({ error }: { error: { message: string } | null }) => {
        if (error && !error.message.includes("duplicate")) {
          import("@/lib/ai-chat/observability").then(({ logAiChat }) =>
            logAiChat("warn", "fashion_prompt_version_upsert_failed", {
              hash: params.hash,
              error: error.message,
            }),
          );
        }
      }),
  );
}
