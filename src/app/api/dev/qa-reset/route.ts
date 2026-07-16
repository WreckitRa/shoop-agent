import { isQaUserAllowed, qaDevForbiddenResponse } from "@/lib/qa/guard";
import { qaResetUser } from "@/lib/qa/reset-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  user_id?: string;
  keep_traces?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const userId = body.user_id?.trim();
  if (!userId) {
    return Response.json({ error: "user_id is required." }, { status: 400 });
  }

  if (!isQaUserAllowed(userId)) {
    return qaDevForbiddenResponse();
  }

  const { summary, preserved } = await qaResetUser({
    userId,
    keepTraces: body.keep_traces === true,
  });

  return Response.json({
    ok: true,
    user_id: userId,
    keep_traces: body.keep_traces === true,
    deleted: summary,
    preserved,
  });
}
