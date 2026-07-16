import { FASHN_API_BASE, FASHN_TIMEOUT_MS } from "../config";

type FashnRunResponse = {
  id?: string;
  error?: string | { message?: string } | null;
};

type FashnStatusResponse = {
  status?: string;
  output?: string[] | { images?: string[] };
  error?: string | { message?: string };
};

function formatFashnError(error: FashnRunResponse["error"]): string {
  if (!error) return "FASHN request failed";
  if (typeof error === "string") return error;
  return error.message ?? "FASHN request failed";
}

export function extractFashnOutputUrl(body: FashnStatusResponse): string | null {
  const output = body.output;
  if (Array.isArray(output)) return output[0] ?? null;
  if (output && typeof output === "object" && Array.isArray(output.images)) {
    return output.images[0] ?? null;
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function pollFashnPrediction(
  predictionId: string,
  apiKey: string,
  deadlineMs: number,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) break;

    const res = await fetchWithTimeout(
      `${FASHN_API_BASE}/status/${predictionId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      Math.min(10_000, remaining),
    );
    if (!res.ok) {
      throw new Error(`FASHN status ${res.status}`);
    }
    const body = (await res.json()) as FashnStatusResponse;
    if (body.status === "completed") {
      const url = extractFashnOutputUrl(body);
      if (url) return url;
      throw new Error("FASHN completed without image URL");
    }
    if (body.status === "failed") {
      const err =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? "FASHN generation failed";
      throw new Error(err);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("FASHN generation timed out");
}

export async function runFashnPrediction(params: {
  modelName: string;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) throw new Error("FASHN_API_KEY not configured");

  const timeoutMs = params.timeoutMs ?? FASHN_TIMEOUT_MS;
  const started = Date.now();

  const runRes = await fetchWithTimeout(
    `${FASHN_API_BASE}/run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: params.modelName,
        inputs: params.inputs,
      }),
    },
    Math.min(30_000, timeoutMs),
  );

  const runText = await runRes.text().catch(() => "");
  if (!runRes.ok) {
    throw new Error(`FASHN run ${runRes.status}: ${runText.slice(0, 300)}`);
  }

  let runBody: FashnRunResponse;
  try {
    runBody = JSON.parse(runText) as FashnRunResponse;
  } catch {
    throw new Error(`FASHN run invalid JSON: ${runText.slice(0, 200)}`);
  }

  if (runBody.error) {
    throw new Error(formatFashnError(runBody.error));
  }
  if (!runBody.id) throw new Error("FASHN missing prediction id");

  const remaining = timeoutMs - (Date.now() - started);
  return pollFashnPrediction(runBody.id, apiKey, remaining);
}
