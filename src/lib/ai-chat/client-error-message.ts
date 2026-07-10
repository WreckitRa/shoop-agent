import { APIUserAbortError } from "@anthropic-ai/sdk/error";

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** User-visible message for chat/search failures — never leaks secrets. */
export function clientErrorMessage(err: unknown): string {
  if (err instanceof APIUserAbortError) return "Generation stopped.";

  const msg = errorText(err);
  const lower = msg.toLowerCase();

  if (/credit balance|insufficient.*credit|purchase credits|billing/i.test(lower)) {
    return "Anthropic API credits are exhausted. Add credits in your Anthropic console, then retry.";
  }
  if (/rate_limit/i.test(lower)) {
    return "The provider rate limit was hit. Retry in a moment.";
  }
  if (/overloaded/i.test(lower)) {
    return "The provider is overloaded. Retry shortly.";
  }
  if (/authentication|invalid.*api.?key|api key/i.test(lower)) {
    return "AI provider authentication failed. Check ANTHROPIC_API_KEY and retry.";
  }
  if (/invalid_request|model.*not found|does not exist/i.test(lower)) {
    return "AI provider rejected the request. Check model configuration and retry.";
  }

  return "Something went wrong. Retry.";
}
