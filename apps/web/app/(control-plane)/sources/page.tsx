import type { Metadata } from "next";

import { KnowledgeSources } from "@/components/knowledge-sources";
import { PageHeading } from "@/components/page-heading";
import { resolveKnowledgeSources } from "@/lib/knowledge-sources";

export const metadata: Metadata = { title: "Knowledge sources" };
export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  const result = await resolveKnowledgeSources(scenario);
  return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="02" title="Knowledge sources" summary="See what Paige can inspect, how fresh it is, which evidence class it carries, and where read or draft authority stops." /><KnowledgeSources result={result} /></div>;
}
