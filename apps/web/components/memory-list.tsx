import type {
  OperatorMemoryListInput,
  OperatorMemoryListItem,
} from "@docs-agent/control-plane";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MemoryListResult } from "@/lib/memory-review";
import {
  formatMemoryKind,
  formatMemoryTimestamp,
  memoryDisplayLabels,
  memoryDisplayStyles,
} from "@/lib/memory-display";
import { cn } from "@/lib/utils";

export function MemoryList({
  filters,
  result,
}: {
  filters: OperatorMemoryListInput;
  result: MemoryListResult;
}) {
  return (
    <div className="grid gap-6" data-memory-list-state={result.state}>
      <MemorySafetyBoundary />
      <MemoryFilters filters={filters} />
      {result.state === "ready" ? (
        <div className="grid gap-px overflow-hidden rounded-xl border border-foreground/20 bg-foreground/20 xl:grid-cols-2">
          {result.memories.map((memory, index) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              wide={result.memories.length % 2 === 1 && index === result.memories.length - 1}
            />
          ))}
        </div>
      ) : result.state === "empty" ? (
        <MemoryState
          mark="○"
          title="No memories match this review."
          body="Change the filters or wait for Paige to propose provenance-backed routing context."
        />
      ) : result.state === "invalid-record" ? (
        <MemoryState
          mark="!"
          title="A memory no longer matches the review contract."
          body="The stored row was not rendered. Inspect the app-owned database and migration state before reviewing memories."
          error
        />
      ) : (
        <MemoryState
          mark="!"
          title="Workspace memories could not be read."
          body="Restore database access and apply committed migrations before making lifecycle decisions."
          error
        />
      )}
    </div>
  );
}

function MemorySafetyBoundary() {
  return (
    <Card className="overflow-hidden border-accent/35 bg-[#f4ead8] py-0" data-memory-safety-boundary>
      <CardContent className="grid gap-5 p-[clamp(1.25rem,3vw,2.25rem)] md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <span className="grid size-12 place-items-center rounded-full border border-accent/30 bg-background font-heading text-2xl text-accent" aria-hidden="true">≠</span>
        <div>
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Routing context, not public proof</p>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/75">
            Workspace memories help Paige find people, paths, conventions, and prior decisions. Public documentation claims still require source evidence and current-docs verification.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryFilters({ filters }: { filters: OperatorMemoryListInput }) {
  return (
    <form className="grid gap-4 rounded-xl border border-foreground/20 bg-card p-[clamp(1.25rem,3vw,2rem)] lg:grid-cols-[minmax(12rem,1fr)_12rem_14rem_auto] lg:items-end" method="get">
      <label className="grid gap-2 text-sm font-medium">
        Search memory text
        <input
          className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
          defaultValue={filters.query}
          maxLength={200}
          name="query"
          placeholder="Owner, path, convention…"
          type="search"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Status
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.status ?? ""} name="status">
          <option value="">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="active">Active</option>
          <option value="stale">Stale</option>
          <option value="retired">Retired</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Kind
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.kind ?? ""} name="kind">
          <option value="">All kinds</option>
          <option value="concept">Concept</option>
          <option value="docs_surface">Docs surface</option>
          <option value="style_rule">Style rule</option>
          <option value="workflow_rule">Workflow rule</option>
          <option value="ownership">Ownership</option>
          <option value="decision">Decision</option>
        </select>
      </label>
      <div className="flex gap-2">
        <Button className="h-10" type="submit">Apply filters</Button>
        <Button asChild className="h-10" variant="outline"><Link href="/memories">Reset</Link></Button>
      </div>
    </form>
  );
}

function MemoryCard({
  memory,
  wide,
}: {
  memory: OperatorMemoryListItem;
  wide: boolean;
}) {
  return (
    <article className={cn("grid min-h-80 content-between gap-8 bg-card p-[clamp(1.3rem,3vw,2.25rem)]", wide && "xl:col-span-2")} data-memory-id={memory.id} data-memory-display-state={memory.displayState}>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{formatMemoryKind(memory.kind)}</p>
          <Badge className={cn("capitalize", memoryDisplayStyles[memory.displayState])} variant="outline">{memoryDisplayLabels[memory.displayState]}</Badge>
        </div>
        <h2 className="mt-8 max-w-[26ch] font-heading text-[clamp(1.65rem,3vw,2.5rem)] leading-[1.02] font-medium tracking-[-0.04em]">
          <Link className="underline decoration-foreground/15 underline-offset-6 hover:decoration-accent" href={`/memories/${encodeURIComponent(memory.id)}`}>{memory.statement}</Link>
        </h2>
        {memory.summary ? <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{memory.summary}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">{memory.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div>
      </div>
      <dl className="grid grid-cols-2 gap-4 border-t border-foreground/15 pt-5 text-xs sm:grid-cols-4">
        <Fact label="Confidence" value={memory.confidence} />
        <Fact label="Fresh until" value={formatMemoryTimestamp(memory.freshUntil)} />
        <Fact label="Validated" value={formatMemoryTimestamp(memory.lastValidatedAt)} />
        <Fact label="Updated" value={formatMemoryTimestamp(memory.updatedAt)} />
      </dl>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt><dd className="mt-1.5 capitalize">{value}</dd></div>;
}

function MemoryState({ body, error = false, mark, title }: { body: string; error?: boolean; mark: string; title: string }) {
  return (
    <Card className="min-h-64 border-foreground/20 bg-card py-0" role={error ? "alert" : "status"}>
      <CardContent className="grid min-h-64 items-center gap-6 p-[clamp(1.5rem,4vw,3.5rem)] md:grid-cols-[auto_minmax(0,1fr)]">
        <span className={cn("grid size-20 place-items-center rounded-full border border-foreground/20 font-heading text-4xl text-accent", error && "text-destructive")} aria-hidden="true">{mark}</span>
        <div><h2 className="font-heading text-[clamp(2rem,4vw,3.5rem)] leading-none tracking-[-0.05em]">{title}</h2><p className="mt-4 max-w-xl leading-7 text-muted-foreground">{body}</p></div>
      </CardContent>
    </Card>
  );
}
