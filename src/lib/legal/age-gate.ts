import {
  ageYearsFromBirthDate,
  isAtLeastAge,
} from "@/lib/onboarding/form-options";
import { MIN_ACCOUNT_AGE } from "./constants";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoBirthDate(raw: string): string | null {
  const value = raw.trim();
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const [year, month, day] = value.split("-");
  if (
    d.getUTCFullYear() !== Number(year) ||
    d.getUTCMonth() + 1 !== Number(month) ||
    d.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return value;
}

export function assertSignupAge(birthDate: string): {
  ok: true;
  birthDate: string;
  ageYears: number;
} | { ok: false; error: string } {
  const parsed = parseIsoBirthDate(birthDate);
  if (!parsed) {
    return { ok: false, error: "Enter your date of birth." };
  }
  if (!isAtLeastAge(parsed, MIN_ACCOUNT_AGE)) {
    return {
      ok: false,
      error: `You must be at least ${MIN_ACCOUNT_AGE} to use Shoop.`,
    };
  }
  const ageYears = ageYearsFromBirthDate(parsed);
  if (ageYears == null) {
    return { ok: false, error: "Enter your date of birth." };
  }
  return { ok: true, birthDate: parsed, ageYears };
}
