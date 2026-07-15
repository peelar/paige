import type { Metadata } from "next";

import { CapabilityReport } from "@/components/capability-report";
import { PageHeading } from "@/components/page-heading";
import { resolveCapabilityReport } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Capabilities" };
export const dynamic = "force-dynamic";

export default async function CapabilitiesPage({ searchParams }: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  const result = await resolveCapabilityReport(scenario);
  return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="03" title="Capabilities" summary="Explain which stable capability families are visible to each verified channel or principal class, and why unavailable authority stays unavailable." /><CapabilityReport result={result} /></div>;
}
