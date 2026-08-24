import { redirect } from "next/navigation";
import { LEGAL_PATHS } from "@/lib/legal/constants";

export default function PrivacyRedirect() {
  redirect(LEGAL_PATHS.privacy);
}
