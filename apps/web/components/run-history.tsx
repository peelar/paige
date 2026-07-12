import type { OperatorProductRunListItem } from "@docs-agent/control-plane";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatRunTime, formatRunType, runStateLabels, runStateStyles, tokenSummary } from "@/lib/run-display";
import type { RunFilters, RunListResult } from "@/lib/run-history";
import { cn } from "@/lib/utils";

export function RunHistory({ filters, result }: { filters: RunFilters; result: RunListResult }) {
  return (
    <div className="grid gap-6" data-run-list-state={result.state}>
      <Card className="border-accent/35 bg-[#f4ead8] py-0"><CardContent className="grid gap-3 p-[clamp(1.25rem,3vw,2.1rem)] md:grid-cols-[auto_minmax(0,1fr)] md:items-center"><span className="grid size-12 place-items-center rounded-full border border-accent/30 bg-background font-heading text-xl text-accent" aria-hidden="true">↗</span><div><p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Index, not execution log</p><p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/75">This page keeps product status, timing, usage, and stable Eve references. Messages, model output, reasoning, tool payloads, and credentials remain outside the app-owned index.</p></div></CardContent></Card>
      <RunFilters filters={filters} />
      {result.state === "ready" ? <div className="grid gap-px overflow-hidden rounded-xl border border-foreground/20 bg-foreground/20 xl:grid-cols-2">{result.runs.map((run, index) => <RunCard key={run.id} run={run} wide={result.runs.length % 2 === 1 && index === result.runs.length - 1} />)}</div> : <RunState state={result.state} />}
    </div>
  );
}

function RunFilters({ filters }: { filters: RunFilters }) {
  return <form className="grid gap-4 rounded-xl border border-foreground/20 bg-card p-[clamp(1.25rem,3vw,2rem)] lg:grid-cols-[minmax(12rem,1fr)_13rem_14rem_auto] lg:items-end" method="get">
    <label className="grid gap-2 text-sm font-medium">Search run references<input className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30" defaultValue={filters.query} maxLength={200} name="query" placeholder="Signal, session, model…" type="search" /></label>
    <label className="grid gap-2 text-sm font-medium">Status<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.status ?? ""} name="status"><option value="">All statuses</option><option value="active">Active</option><option value="waiting-for-input">Waiting for input</option><option value="failed">Failed</option><option value="completed">Completed</option><option value="expired">Expired</option></select></label>
    <label className="grid gap-2 text-sm font-medium">Run type<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.runType ?? ""} name="runType"><option value="">All run types</option><option value="signal-capture">Signal capture</option><option value="docs-verification">Docs verification</option><option value="patch-preparation">Patch preparation</option><option value="writeback">Writeback</option><option value="owned-docs-work">Owned docs work</option></select></label>
    <div className="flex gap-2"><Button className="h-10" type="submit">Apply filters</Button><Button asChild className="h-10" variant="outline"><Link href="/runs">Reset</Link></Button></div>
  </form>;
}

function RunCard({ run, wide }: { run: OperatorProductRunListItem; wide: boolean }) {
  const note = run.waitingSummary ?? run.failureSummary;
  return <article className={cn("grid min-h-80 content-between gap-8 bg-card p-[clamp(1.3rem,3vw,2.25rem)]", wide && "xl:col-span-2")} data-run-id={run.id} data-run-state={run.displayState}>
    <div><div className="flex flex-wrap items-start justify-between gap-3"><p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{formatRunType(run.runType)} · {run.trigger}</p><Badge className={runStateStyles[run.displayState]} variant="outline">{runStateLabels[run.displayState]}</Badge></div><h2 className="mt-8 max-w-[22ch] font-heading text-[clamp(1.8rem,3vw,2.8rem)] leading-[0.98] font-medium tracking-[-0.045em]"><Link className="underline decoration-foreground/15 underline-offset-6 hover:decoration-accent" href={`/runs/${encodeURIComponent(run.id)}`}>{run.signal?.summary ?? formatRunType(run.runType)}</Link></h2>{note ? <p className={cn("mt-4 max-w-xl border-l-2 pl-4 text-sm leading-6", run.status === "failed" ? "border-destructive text-destructive" : "border-amber-600 text-foreground/75")}>{note}</p> : null}</div>
    <dl className="grid grid-cols-2 gap-4 border-t border-foreground/15 pt-5 text-xs sm:grid-cols-4"><Fact label="Model" value={run.model ?? "Not reported"} /><Fact label="Tokens" value={tokenSummary(run)} /><Fact label="Started" value={formatRunTime(run.startedAt)} /><Fact label="Run" value={run.runId} /></dl>
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt><dd className="mt-1.5 truncate" title={value}>{value}</dd></div>; }
function RunState({ state }: { state: Exclude<RunListResult["state"], "ready"> }) { const [title, body] = state === "empty" ? ["No runs match this view.", "Change the filters or wait for a product operation to start."] : state === "unauthorized" ? ["Run history is not authorized.", "Sign in with an approved operator account before reading execution metadata."] : state === "invalid-record" ? ["A run no longer matches the index contract.", "The invalid row was not rendered. Inspect migrations and the app-owned database."] : ["Run history could not be read.", "Restore database access and apply committed migrations before inspecting execution metadata."]; return <Card className="min-h-64 border-foreground/20 bg-card py-0" role={state === "empty" ? "status" : "alert"}><CardContent className="grid min-h-64 content-center gap-4 p-[clamp(1.5rem,4vw,3.5rem)]"><p className="font-mono text-xs font-bold tracking-[0.1em] text-accent uppercase">Run index</p><h2 className="font-heading text-[clamp(2rem,4vw,3.5rem)] leading-none tracking-[-0.05em]">{title}</h2><p className="max-w-xl leading-7 text-muted-foreground">{body}</p></CardContent></Card>; }
