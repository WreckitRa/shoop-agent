/**
 * Diagnose judge defaults — call grade_appointment for N defaulted personas
 * and dump stop_reason / raw tool input. No score repair.
 *
 *   npx tsx scripts/eval-diagnose-judge.ts [runDir] [n=5]
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tracedLLMCall } from "@/lib/fashion-memory/observability/traced-llm-call";
import {
  GRADE_APPOINTMENT_TOOL,
  JUDGE_MODEL,
  buildJudgeSystemPrompt,
} from "@/lib/fashion-memory/eval/judge-prompt";
import {
  formatReadyToSearchContent,
  transcriptHasSpokenStylistTurn,
  type PersonaRunResult,
} from "@/lib/fashion-memory/eval/run-persona";

async function main() {
  const runDir = path.resolve(
    process.argv[2] ??
      "src/lib/fashion-memory/eval/runs/1-2026-08-27T09-22-14-850Z",
  );
  const n = Number(process.argv[3] ?? 5);
  const outDir = path.join(runDir, "judge-diagnose");
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(runDir)).filter(
    (f) => f.endsWith(".json") && f !== "summary.json",
  );
  const defaulted: string[] = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(runDir, f), "utf8")) as {
      judge?: { recognized?: { why?: string } };
    };
    if (j.judge?.recognized?.why === "dimension defaulted") defaulted.push(f);
  }
  console.log(`defaulted files: ${defaulted.length}; diagnosing ${n}`);

  for (const f of defaulted.slice(0, n)) {
    const raw = JSON.parse(
      await readFile(path.join(runDir, f), "utf8"),
    ) as PersonaRunResult & {
      checks?: unknown[];
      judge?: unknown;
    };
    const dropVoice = !transcriptHasSpokenStylistTurn(raw.transcript);
    const transcriptText = raw.transcript
      .map((t) => {
        const move = t.router?.move ? ` [${t.router.move}]` : "";
        let content = t.content;
        if (
          t.role === "assistant" &&
          (t.router?.move === "ready_to_search" ||
            /\(ready to search\)/i.test(content))
        ) {
          content = formatReadyToSearchContent({
            known_summary:
              t.router && "known_summary" in t.router
                ? (t.router as { known_summary?: string }).known_summary
                : undefined,
            reply: content.replace(/\(ready to search\)/gi, "").trim() || null,
          });
        }
        const qs =
          t.router?.move === "ask_clarification"
            ? `\n  Q: ${t.router.questions.map((q) => `${q.gap}:${q.text}`).join(" | ")}`
            : "";
        return `${t.role}${move}: ${content}${qs}`;
      })
      .join("\n");

    const dim = raw.stage === "full" ? "would_buy" : "would_proceed";
    const userContent = JSON.stringify(
      {
        stage: raw.stage ?? "router",
        purchase_dimension: dim,
        truth: raw.persona.truth,
        profile_state: raw.persona.profile.state,
        language: raw.persona.language,
        patience: raw.persona.patience,
        checks: raw.checks ?? [],
        brief: raw.brief,
        transcript: transcriptText,
        voice_na: dropVoice,
      },
      null,
      2,
    );

    // Reproduce the OLD settings (maxTokens 1600) to confirm failure mode.
    const msg = await tracedLLMCall({
      traceId: raw.traceId || crypto.randomUUID(),
      stage: "eval_judge_diagnose",
      model: JUDGE_MODEL,
      systemPrompt: buildJudgeSystemPrompt(dim),
      disablePromptCache: true,
      maxTokens: 1600,
      tools: [GRADE_APPOINTMENT_TOOL(dim) as unknown as never],
      toolChoice: { type: "tool", name: "grade_appointment" },
      inputMessages: [{ role: "user", content: userContent }],
    });

    const dump = {
      persona_id: raw.persona.id,
      file: f,
      stop_reason: msg.stop_reason,
      usage: msg.usage,
      content_types: msg.content.map((b) => b.type),
      text_blocks: msg.content
        .filter((b) => b.type === "text")
        .map((b) => ("text" in b ? b.text : "")),
      tool_blocks: msg.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          if (b.type !== "tool_use") return null;
          const input = b.input as Record<string, unknown>;
          return {
            name: b.name,
            input_keys: Object.keys(input ?? {}),
            input_json_len: JSON.stringify(input ?? {}).length,
            input,
          };
        }),
    };
    const outPath = path.join(outDir, `${raw.persona.id}.json`);
    await writeFile(outPath, `${JSON.stringify(dump, null, 2)}\n`);
    console.log(
      JSON.stringify({
        id: raw.persona.id,
        stop_reason: dump.stop_reason,
        output_tokens: dump.usage?.output_tokens,
        tool_keys: dump.tool_blocks[0]?.input_keys,
        input_json_len: dump.tool_blocks[0]?.input_json_len,
        text_len: dump.text_blocks.join("").length,
      }),
    );
  }
  console.log(`wrote ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
