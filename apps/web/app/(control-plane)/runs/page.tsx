import type { Metadata } from "next";

import { productRunDisplayStateSchema, productRunTypeSchema } from "@docs-agent/control-plane";

import { PageHeading } from "@/components/page-heading";
import { RunHistory } from "@/components/run-history";
import { resolveRunList, type RunFilters } from "@/lib/run-history";

export const metadata: Metadata = { title: "Product runs" };
export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = productRunDisplayStateSchema.safeParse(single(params.status));
  const runType = productRunTypeSchema.safeParse(single(params.runType));
  const query = single(params.query)?.trim().slice(0, 200);
  const filters: RunFilters = { status: status.success ? status.data : undefined, runType: runType.success ? runType.data : undefined, query: query === "" ? undefined : query };
  const result = await resolveRunList(filters, single(params.scenario));
  return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="04" title="Product runs" summary="See what ran for each docs signal, where it paused or failed, and where the deeper durable trace lives." /><RunHistory filters={filters} result={result} /></div>;
}
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
