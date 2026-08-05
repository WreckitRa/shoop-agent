import type { Metadata } from "next";
import { AskLookCard } from "@/components/ask/AskLookCard";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Should they get it? · Shoop",
    description: "Vote before you peek — Ask your friends.",
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
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#E9E9EE]">
      <AskLookCard token={token} />
    </main>
  );
}
