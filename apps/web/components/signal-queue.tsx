import Link from "next/link";

import {
  docsSignalSourceKindSchema,
  docsSignalStatuses,
  type DocsSignalQueueItem,
} from "@docs-agent/control-plane";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SignalQueueFilters, SignalQueueResult } from "@/lib/signal-queue";

const statusStyles: Record<DocsSignalQueueItem["status"], string> = {
  captured: "border-[#aa7e3d]/35 bg-[#f1dfbd] text-[#674515]",
  "needs-maintainer-answer": "border-[#a86848]/35 bg-[#f0d5c8] text-[#71351f]",
  "needs-source-evidence": "border-destructive/30 bg-[#f0d1c8] text-[#762c22]",
  "verification-skipped": "border-foreground/15 bg-muted text-muted-foreground",
  "docs-verified": "border-[#54716a]/30 bg-[#dce8e2] text-[#24463f]",
  "patch-failed": "border-destructive/30 bg-[#f0d1c8] text-[#762c22]",
  "patch-prepared": "border-[#718251]/35 bg-[#dce4c8] text-[#2f482f]",
  "draft-pr-opened": "border-[#4f6f91]/30 bg-[#d9e4ee] text-[#294b6b]",
  "closed-already-covered": "border-foreground/15 bg-muted text-muted-foreground",
  "closed-not-docs-relevant": "border-foreground/15 bg-muted text-muted-foreground",
};

export function SignalQueue({
  filters,
  result,
}: {
  filters: SignalQueueFilters;
  result: SignalQueueResult;
}) {
  return (
    <div className="grid gap-5">
      <QueueFilters filters={filters} />
      {result.state === "ready" ? <QueueTable signals={result.signals} /> : null}
      {result.state === "empty" ? <QueueEmpty filtered={hasFilters(filters)} /> : null}
      {result.state === "database-error" ? (
        <QueueFailure
          code="database-error"
          kicker="Database unavailable"
          title="The work queue cannot be read."
          body={`${result.message} Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate before retrying.`}
        />
      ) : null}
      {result.state === "invalid-record" ? (
        <QueueFailure
          code="invalid-record"
          kicker="Invalid persisted record"
          title="One signal does not fit the queue contract."
          body={`${result.message} Inspect the persisted record and migration history; the list will not silently omit it.`}
        />
      ) : null}
    </div>
  );
}

function QueueFilters({ filters }: { filters: SignalQueueFilters }) {
  return (
    <form
      className="grid gap-4 rounded-xl border border-foreground/20 bg-card/80 p-4 shadow-[0_18px_55px_rgba(28,43,38,0.07)] lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end"
      method="get"
      aria-label="Signal queue filters"
    >
      <FilterSelect
        label="Status"
        name="status"
        value={filters.status ?? ""}
        options={docsSignalStatuses.map((status) => ({ value: status, label: label(status) }))}
        emptyLabel="All open statuses"
      />
      <FilterSelect
        label="Source"
        name="source"
        value={filters.sourceKind ?? ""}
        options={docsSignalSourceKindSchema.options.map((source) => ({
          value: source,
          label: label(source),
        }))}
        emptyLabel="All source kinds"
      />
      <label className="flex min-h-9 items-center gap-2 rounded-lg border border-foreground/15 bg-background px-3 text-sm">
        <input
          className="size-4 accent-accent"
          defaultChecked={filters.includeClosed}
          name="scope"
          type="checkbox"
          value="all"
        />
        Include closed
      </label>
      <Button className="min-h-9" type="submit">Apply filters</Button>
    </form>
  );
}

function FilterSelect({
  emptyLabel,
  label: fieldLabel,
  name,
  options,
  value,
}: {
  emptyLabel: string;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[0.62rem] font-bold tracking-[0.09em] text-muted-foreground uppercase">
        {fieldLabel}
      </span>
      <select
        className="min-h-9 rounded-lg border border-foreground/20 bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        defaultValue={value}
        name={name}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function QueueTable({ signals }: { signals: DocsSignalQueueItem[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-foreground/20 bg-card shadow-[0_24px_70px_rgba(28,43,38,0.09)]" aria-labelledby="queue-heading">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-foreground/15 px-[clamp(1.2rem,3vw,2rem)] py-5">
        <div>
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Open work first</p>
          <h2 className="mt-1 font-heading text-3xl font-medium tracking-[-0.04em]" id="queue-heading">
            {signals.length} {signals.length === 1 ? "signal" : "signals"}
          </h2>
        </div>
        <p className="max-w-sm text-right text-xs leading-5 text-muted-foreground">
          Priority high to low. Newest update breaks ties; stable ids resolve exact ties.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left lg:min-w-[60rem]">
          <thead className="hidden lg:table-header-group">
            <tr className="border-b border-foreground/15 bg-background/50 font-mono text-[0.61rem] tracking-[0.08em] text-muted-foreground uppercase">
              <th className="px-5 py-3 font-bold">Priority</th>
              <th className="px-5 py-3 font-bold">Signal</th>
              <th className="px-5 py-3 font-bold">Status</th>
              <th className="px-5 py-3 font-bold">Source</th>
              <th className="px-5 py-3 font-bold">Uncertainty</th>
              <th className="px-5 py-3 font-bold">Next action</th>
              <th className="px-5 py-3 font-bold">Updated</th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {signals.map((signal) => <SignalRow key={signal.id} signal={signal} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SignalRow({ signal }: { signal: DocsSignalQueueItem }) {
  return (
    <tr
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 border-b border-foreground/10 px-5 py-6 align-top transition-colors last:border-b-0 hover:bg-popover lg:table-row lg:px-0 lg:py-0"
      data-signal-id={signal.id}
      data-signal-source={signal.sourceKind}
      data-signal-status={signal.status}
    >
      <td className="row-span-2 px-0 py-0 lg:table-cell lg:px-5 lg:py-5">
        <div className="grid size-12 place-items-center rounded-full border border-foreground/20 bg-background font-heading text-xl font-semibold" aria-label={`Priority ${signal.priority}`}>
          {signal.priority}
        </div>
      </td>
      <td className="max-w-md px-0 py-0 lg:table-cell lg:px-5 lg:py-5">
        <p className="text-sm leading-6 font-medium">{signal.sourceSummary}</p>
        <p className="mt-2 font-mono text-[0.6rem] tracking-[0.06em] text-muted-foreground uppercase">{signal.id}</p>
      </td>
      <td className="col-start-2 mt-3 px-0 py-0 lg:table-cell lg:mt-0 lg:px-5 lg:py-5">
        <Badge className={cn("whitespace-nowrap capitalize", statusStyles[signal.status])} variant="outline">
          {label(signal.status)}
        </Badge>
      </td>
      <td className="col-span-2 mt-6 border-t border-foreground/10 px-0 pt-4 text-sm capitalize lg:table-cell lg:mt-0 lg:border-t-0 lg:px-5 lg:py-5">
        <MobileFieldLabel>Source</MobileFieldLabel>
        {label(signal.sourceKind)}
      </td>
      <td className="col-span-2 mt-4 max-w-xs px-0 py-0 text-sm leading-5 text-muted-foreground lg:table-cell lg:mt-0 lg:px-5 lg:py-5">
        <MobileFieldLabel>Uncertainty</MobileFieldLabel>
        {signal.uncertainty ?? "None recorded"}
      </td>
      <td className="col-span-2 mt-4 px-0 py-0 text-sm leading-5 lg:table-cell lg:mt-0 lg:px-5 lg:py-5">
        <MobileFieldLabel>Next action</MobileFieldLabel>
        {signal.nextActionAt === null ? "Not scheduled" : <QueueTime value={signal.nextActionAt} />}
      </td>
      <td className="col-span-2 mt-4 px-0 py-0 text-sm leading-5 text-muted-foreground lg:table-cell lg:mt-0 lg:px-5 lg:py-5">
        <MobileFieldLabel>Updated</MobileFieldLabel>
        <QueueTime value={signal.updatedAt} />
      </td>
    </tr>
  );
}

function QueueTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatTimestamp(value)}</time>;
}

function MobileFieldLabel({ children }: { children: string }) {
  return (
    <span className="mb-1 block font-mono text-[0.6rem] font-bold tracking-[0.08em] text-muted-foreground uppercase lg:hidden">
      {children}
    </span>
  );
}

function QueueEmpty({ filtered }: { filtered: boolean }) {
  return (
    <Card className="border-foreground/20 bg-card/80 py-0">
      <CardContent className="grid min-h-72 content-end p-[clamp(1.5rem,4vw,3.5rem)]">
        <p className="font-mono text-[0.66rem] font-bold tracking-[0.1em] text-accent uppercase">Queue clear</p>
        <h2 className="mt-3 max-w-[17ch] font-heading text-[clamp(2rem,5vw,4rem)] leading-none font-medium tracking-[-0.055em]">
          {filtered ? "No signals match these filters." : "No open docs signals are waiting."}
        </h2>
        <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
          {filtered
            ? "Reset the view to return to all open work. No records were changed."
            : "New provider-neutral signals will appear here after durable capture."}
        </p>
        {filtered ? <Link className="mt-6 w-fit text-sm font-bold text-accent underline underline-offset-4" href="/signals">Reset filters</Link> : null}
      </CardContent>
    </Card>
  );
}

function QueueFailure({
  body,
  code,
  kicker,
  title,
}: {
  body: string;
  code: "database-error" | "invalid-record";
  kicker: string;
  title: string;
}) {
  return (
    <Card className="border-destructive/30 bg-card py-0" data-signal-error={code} role="alert">
      <CardContent className="grid min-h-72 content-end p-[clamp(1.5rem,4vw,3.5rem)]">
        <p className="font-mono text-[0.66rem] font-bold tracking-[0.1em] text-destructive uppercase">{kicker}</p>
        <h2 className="mt-3 max-w-[18ch] font-heading text-[clamp(2rem,5vw,4rem)] leading-none font-medium tracking-[-0.055em]">{title}</h2>
        <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">{body}</p>
        <Link className="mt-6 w-fit text-sm font-bold text-accent underline underline-offset-4" href="/signals">Retry the queue</Link>
      </CardContent>
    </Card>
  );
}

function hasFilters(filters: SignalQueueFilters): boolean {
  return filters.status !== undefined || filters.sourceKind !== undefined || filters.includeClosed;
}

function label(value: string): string {
  return value.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}
