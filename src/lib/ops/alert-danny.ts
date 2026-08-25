import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import {
  getResendClient,
  getResendFrom,
  isResendConfigured,
} from "@/lib/auth/resend";

function opsAlertEmail(): string {
  return (
    process.env.OPS_ALERT_EMAIL?.trim() ||
    process.env.DANNY_ALERT_EMAIL?.trim() ||
    ""
  );
}

function utcDayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Email Danny (OPS_ALERT_EMAIL) at most once per subject per UTC day.
 * Logs if mail is not configured — never throws.
 */
export async function alertDanny(params: {
  subject: string;
  body: string;
}): Promise<void> {
  const to = opsAlertEmail();
  const stamp = `${params.subject} | ${utcDayStamp()}`;
  console.error(`[ops-alert] ${stamp}\n${params.body}`);
  if (!to) return;

  const dedupeKey = `ops-alert:${utcDayStamp()}:${params.subject}`;
  const already = await kvGet(dedupeKey);
  if (already) return;
  await kvSetex(dedupeKey, 60 * 60 * 36, "1");

  if (!isResendConfigured()) return;
  try {
    await getResendClient().emails.send({
      from: getResendFrom(),
      to,
      subject: `[Shoop] ${params.subject}`,
      text: params.body,
    });
  } catch (error) {
    console.error("[ops-alert] send failed", error);
  }
}
