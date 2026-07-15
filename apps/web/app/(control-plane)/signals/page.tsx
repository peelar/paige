import type { Metadata } from "next";

import {
  docsSignalSourceKindSchema,
  docsSignalStatusSchema,
} from "@docs-agent/control-plane";

import { PageHeading } from "../../../components/page-heading";
import { SignalQueue } from "../../../components/signal-queue";
import { resolveSignalQueue } from "../../../lib/signal-queue";

export const metadata: Metadata = {
  title: "Signals",
};

export const dynamic = "force-dynamic";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = docsSignalStatusSchema.safeParse(single(params.status));
  const sourceKind = docsSignalSourceKindSchema.safeParse(single(params.source));
  const filters = {
    status: status.success ? status.data : undefined,
    sourceKind: sourceKind.success ? sourceKind.data : undefined,
    includeClosed: single(params.scope) === "all",
  };
  const result = await resolveSignalQueue(filters, single(params.scenario));

  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="04"
        title="Signals"
        summary="The durable work queue for evidence, documentation impact, and the next careful action."
      />
      <SignalQueue filters={filters} result={result} />
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
