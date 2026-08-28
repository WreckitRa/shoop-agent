import { getAuthContext } from "@/lib/auth/session";
import {
  countActiveMeasurementFacts,
  listActiveFashionFacts,
} from "@/lib/fashion-memory/facts";
import type { PersonDepartment } from "@/lib/fashion-memory/department";
import { listPeopleForUser } from "@/lib/fashion-memory/people";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import { resolveDisplayedAvatarUrl } from "@/lib/tryon/avatar/image-src";
import {
  getStoredAvatar,
  personHasStoredAvatar,
} from "@/lib/tryon/avatar/service";

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

export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth, { photoGate: false });
  if (!owner.ok) return owner.response;

  try {
    const people = await listPeopleForUser(owner.userId);
    const rows = await Promise.all(
      people.map(async (person) => {
        const avatar = await getStoredAvatar(owner.userId, person.id);
        const has_avatar =
          personHasStoredAvatar(person.avatar) || personHasStoredAvatar(avatar);
        const department = await personDepartment(owner.userId, person.id);
        const measurements_on_file = await countActiveMeasurementFacts({
          userId: owner.userId,
          personId: person.id,
        });
        return {
          id: person.id,
          relation: person.relation,
          name: person.name,
          label: personLabel(person.relation, person.name),
          has_avatar,
          avatar_url: resolveDisplayedAvatarUrl({
            personId: person.id,
            hasAvatar: has_avatar,
            signedUrl: avatar?.url,
          }),
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
