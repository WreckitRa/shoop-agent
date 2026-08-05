import type { Metadata } from "next";
import { AskLookCard } from "@/components/ask/AskLookCard";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Should they get it? · Shoop",
    description: "Vote before you peek — Ask the Girls.",
    robots: { index: false, follow: false },
    openGraph: {
      title: "Should they get it? · Shoop",
      description: "Vote before you peek at Shoop’s verdict.",
      url: `/ask/${token}`,
    },
  };
}

export default async function AskLookPage({ params }: Props) {
  const { token } = await params;
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#E9E9EE] py-6">
      <AskLookCard token={token} />
    </main>
  );
}
