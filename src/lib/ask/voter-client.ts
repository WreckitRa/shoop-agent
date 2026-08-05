/** Client helpers for Ask-your-friends voter identity + display name. */

const VOTER_KEY = "shoop_ask_voter_id";
const NAME_KEY = "shoop_ask_display_name";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function getAskVoterKey(): string {
  if (typeof window === "undefined") return "guest:ssr";
  try {
    let id = localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VOTER_KEY, id);
    }
    return `guest:${id}`;
  } catch {
    return `guest:${randomId()}`;
  }
}

export function getAskDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const n = localStorage.getItem(NAME_KEY)?.trim();
    return n || null;
  } catch {
    return null;
  }
}

export function setAskDisplayName(name: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
  } catch {
    /* ignore */
  }
}
