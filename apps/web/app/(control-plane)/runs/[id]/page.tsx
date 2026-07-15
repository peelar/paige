import type { Metadata } from "next";

import { PageHeading } from "@/components/page-heading";
import { RunDetail } from "@/components/run-detail";
import { resolveRunDetail } from "@/lib/run-history";

export const metadata: Metadata = { title: "Product run" };
export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ scenario?: string }> }) {
  const [{ id }, { scenario }] = await Promise.all([params, searchParams]);
  const result = await resolveRunDetail(id, scenario);
  return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="06 / detail" title="Run detail" summary="Review the safe product projection, then follow stable Eve, Vercel, or OpenTelemetry links for deeper execution evidence." /><RunDetail result={result} /></div>;
}
