import { getAuthContext } from "@/lib/auth/session";
import {
  countActiveMeasurementFacts,
  listActiveFashionFacts,
} from "@/lib/fashion-memory/facts";
import type { PersonDepartment } from "@/lib/fashion-memory/department";
import { listPeopleForUser } from "@/lib/fashion-memory/people";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function personLabel(relation: string, name: string | null): string {
  if (name?.trim()) return name.trim();
  if (relation === "self") return "You";
  return relation.charAt(0).toUpperCase() + relation.slice(1);
}

async function personDepartment(
  userId: string,
  personId: string,
): Promise<PersonDepartment | null> {
  const facts = await listActiveFashionFacts({
    userId,
    personId,
    factType: "gender_presentation",
  });
  const v = facts[0]?.value as { presentation?: PersonDepartment } | undefined;
  return v?.presentation ?? null;
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
        const department = await personDepartment(auth.userId, person.id);
        // Privacy: count only — never return measurement values
        const measurements_on_file = await countActiveMeasurementFacts({
          userId: auth.userId,
          personId: person.id,
        });
        return {
          id: person.id,
          relation: person.relation,
          name: person.name,
          label: personLabel(person.relation, person.name),
          has_avatar: Boolean(avatar),
          avatar_url: avatar?.url ?? null,
          department,
          measurements_on_file,
        };
      }),
    );
    return Response.json({ people: rows });
  } catch {
    return Response.json({ error: "Could not load people." }, { status: 500 });
  }
}
