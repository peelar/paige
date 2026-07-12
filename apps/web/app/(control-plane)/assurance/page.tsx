import {
  validationDisplayOutcomeSchema,
  validationKindSchema,
} from "@docs-agent/control-plane";
import type { Metadata } from "next";

import { AssuranceList } from "@/components/assurance-list";
import { PageHeading } from "@/components/page-heading";
import {
  resolveAssuranceList,
  type AssuranceFilters,
} from "@/lib/assurance";

export const metadata: Metadata = { title: "Assurance" };
export const dynamic = "force-dynamic";

export default async function AssurancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = validationKindSchema.safeParse(single(params.kind));
  const outcome = validationDisplayOutcomeSchema.safeParse(single(params.outcome));
  const query = single(params.query)?.trim().slice(0, 200);
  const filters: AssuranceFilters = {
    kind: kind.success ? kind.data : undefined,
    outcome: outcome.success ? outcome.data : undefined,
    query: query || undefined,
  };
  const result = await resolveAssuranceList(filters, single(params.scenario));
  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading index="05" title="Assurance" summary="Read the recorded behavioral and deterministic proof behind a change, then compare it with an earlier compatible baseline." />
      <AssuranceList filters={filters} result={result} />
    </div>
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
