import type { Metadata } from "next";

import { AssuranceDetail } from "@/components/assurance-detail";
import { PageHeading } from "@/components/page-heading";
import { resolveAssuranceDetail } from "@/lib/assurance";

export const metadata: Metadata = { title: "Assurance run" };
export const dynamic = "force-dynamic";

export default async function AssuranceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ baseline?: string; scenario?: string }>;
}) {
  const [{ id }, { baseline, scenario }] = await Promise.all([params, searchParams]);
  const result = await resolveAssuranceDetail(decodeRouteId(id), baseline, scenario);
  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading index="05 / detail" title="Assurance run" summary="Inspect safe case evidence and compare it with an earlier run without changing the suite, assertions, or runtime." />
      <AssuranceDetail baselineId={baseline} result={result} scenario={scenario} />
    </div>
  );
}

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
