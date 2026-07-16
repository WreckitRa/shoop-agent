import { getAuthContext } from "@/lib/auth/session";
import { listPeopleForUser } from "@/lib/fashion-memory/people";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function personLabel(relation: string, name: string | null): string {
  if (name?.trim()) return name.trim();
  if (relation === "self") return "You";
  return relation.charAt(0).toUpperCase() + relation.slice(1);
}

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in to manage avatars." }, { status: 401 });
  }

  try {
    const people = await listPeopleForUser(auth.userId);
    const rows = await Promise.all(
      people.map(async (person) => {
        const avatar = await getStoredAvatar(auth.userId, person.id);
        return {
          id: person.id,
          relation: person.relation,
          name: person.name,
          label: personLabel(person.relation, person.name),
          has_avatar: Boolean(avatar),
          avatar_url: avatar?.url ?? null,
        };
      }),
    );
    return Response.json({ people: rows });
  } catch {
    return Response.json({ error: "Could not load people." }, { status: 500 });
  }
}
