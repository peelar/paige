import type { Metadata } from "next";

import { MemoryDetail } from "@/components/memory-detail";
import { PageHeading } from "@/components/page-heading";
import { resolveMemoryDetail } from "@/lib/memory-review";

export const metadata: Metadata = { title: "Workspace memory" };
export const dynamic = "force-dynamic";

export default async function MemoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const [{ id }, { scenario }] = await Promise.all([params, searchParams]);
  const result = await resolveMemoryDetail(id, scenario);

  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="03 / detail"
        title="Memory review"
        summary="Keep model-generated routing context, source provenance, and human lifecycle decisions visibly separate."
      />
      <MemoryDetail result={result} />
    </div>
  );
}
