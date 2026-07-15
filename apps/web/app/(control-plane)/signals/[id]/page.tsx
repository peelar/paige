import type { Metadata } from "next";

import { PageHeading } from "../../../../components/page-heading";
import { SignalDetail } from "../../../../components/signal-detail";
import { resolveSignalDetail } from "../../../../lib/signal-detail";

export const metadata: Metadata = { title: "Signal detail" };
export const dynamic = "force-dynamic";

export default async function SignalDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const [{ id }, { scenario }] = await Promise.all([params, searchParams]);
  const result = await resolveSignalDetail(id, scenario);

  return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="04 / detail" title="Signal record" summary="The evidence, decisions, workflow history, and artifacts behind one durable docs signal." /><SignalDetail result={result} /></div>;
}
