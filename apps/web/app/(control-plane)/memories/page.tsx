import type { Metadata } from "next";

import {
  operatorMemoryListInputSchema,
  workspaceMemoryKindSchema,
  workspaceMemoryStatusSchema,
} from "@docs-agent/control-plane";

import { MemoryList } from "@/components/memory-list";
import { PageHeading } from "@/components/page-heading";
import { resolveMemoryList } from "@/lib/memory-review";

export const metadata: Metadata = { title: "Workspace memories" };
export const dynamic = "force-dynamic";

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = workspaceMemoryStatusSchema.safeParse(single(params.status));
  const kind = workspaceMemoryKindSchema.safeParse(single(params.kind));
  const rawQuery = single(params.query)?.trim().slice(0, 200);
  const filters = operatorMemoryListInputSchema.parse({
    status: status.success ? status.data : undefined,
    kind: kind.success ? kind.data : undefined,
    query: rawQuery === "" ? undefined : rawQuery,
  });
  const result = await resolveMemoryList(filters, single(params.scenario));

  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="03"
        title="Workspace memories"
        summary="Review the routing context Paige carries forward, where it came from, and whether it is still fit to use."
      />
      <MemoryList filters={filters} result={result} />
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
