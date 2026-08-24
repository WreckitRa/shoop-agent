import { redirect } from "next/navigation";
import { LEGAL_PATHS } from "@/lib/legal/constants";

export default function TermsRedirect() {
  redirect(LEGAL_PATHS.terms);
}
