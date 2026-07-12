import type { OperatorValidationRunListItem } from "@docs-agent/control-plane";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  assuranceOutcomeLabels,
  assuranceOutcomeStyles,
  caseCountSummary,
  formatAssuranceKind,
  formatAssuranceTime,
  formatDuration,
} from "@/lib/assurance-display";
import type { AssuranceFilters, AssuranceListResult } from "@/lib/assurance";

export function AssuranceList({
  filters,
  result,
}: {
  filters: AssuranceFilters;
  result: AssuranceListResult;
}) {
  return (
    <div className="grid gap-6" data-assurance-list-state={result.state}>
      <AssuranceBoundary />
      <AssuranceFilters filters={filters} />
      {result.state === "ready" ? (
        <div className="overflow-hidden rounded-xl border border-foreground/20 bg-card">
          <div className="hidden grid-cols-[minmax(13rem,1.4fr)_minmax(10rem,1fr)_9rem_8rem_7rem] gap-5 border-b border-foreground/15 bg-primary px-6 py-3 font-mono text-[0.6rem] font-bold tracking-[0.09em] text-primary-foreground/60 uppercase lg:grid">
            <span>Suite and proof type</span>
            <span>Runtime identity</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Result</span>
          </div>
          <div className="divide-y divide-foreground/15">
            {result.runs.map((run) => (
              <AssuranceRow key={run.id} run={run} />
            ))}
          </div>
        </div>
      ) : result.state === "loading" ? (
        <div className="grid min-h-64 animate-pulse content-center gap-4 rounded-xl border border-foreground/15 bg-card p-[clamp(1.5rem,4vw,3.5rem)]" aria-label="Loading assurance records"><div className="h-3 w-32 rounded bg-foreground/10" /><div className="h-12 max-w-xl rounded bg-foreground/10" /><div className="h-4 max-w-2xl rounded bg-foreground/10" /></div>
      ) : (
        <AssuranceState state={result.state} />
      )}
    </div>
  );
}

function AssuranceBoundary() {
  return (
    <Card className="overflow-hidden border-primary bg-primary py-0 text-primary-foreground">
      <CardContent className="grid gap-7 p-[clamp(1.4rem,4vw,3rem)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)] lg:items-end">
        <div>
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.12em] text-[#d7aa6d] uppercase">
            Proof, not a test runner
          </p>
          <h2 className="mt-4 max-w-[16ch] font-heading text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.9] tracking-[-0.055em]">
            See what behavior held—and what did not.
          </h2>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg bg-primary-foreground/15 sm:grid-cols-2">
          <BoundaryFact label="Live model eval" body="Behavior observed through a real Eve agent run." />
          <BoundaryFact label="Deterministic validation" body="Code and contract checks with no model behavior implied." />
        </div>
      </CardContent>
    </Card>
  );
}

function BoundaryFact({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-[#24443b] p-5">
      <p className="font-mono text-[0.62rem] font-bold tracking-[0.08em] text-[#d7aa6d] uppercase">{label}</p>
      <p className="mt-2 text-sm leading-6 text-primary-foreground/70">{body}</p>
    </div>
  );
}

function AssuranceFilters({ filters }: { filters: AssuranceFilters }) {
  return (
    <form className="grid gap-4 rounded-xl border border-foreground/20 bg-card p-[clamp(1.25rem,3vw,2rem)] lg:grid-cols-[minmax(12rem,1fr)_15rem_12rem_auto] lg:items-end" method="get">
      <label className="grid gap-2 text-sm font-medium">
        Search assurance records
        <input className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30" defaultValue={filters.query} maxLength={200} name="query" placeholder="Suite, model, commit…" type="search" />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Proof type
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.kind ?? ""} name="kind">
          <option value="">All proof types</option>
          <option value="live-eval">Live model eval</option>
          <option value="deterministic-validation">Deterministic validation</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Result
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filters.outcome ?? ""} name="outcome">
          <option value="">All results</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="flaky">Flaky</option>
          <option value="skipped">Skipped</option>
          <option value="missing">Missing</option>
          <option value="expired">Expired</option>
        </select>
      </label>
      <div className="flex gap-2">
        <Button className="h-10" type="submit">Apply filters</Button>
        <Button asChild className="h-10" variant="outline"><Link href="/assurance">Reset</Link></Button>
      </div>
    </form>
  );
}

function AssuranceRow({ run }: { run: OperatorValidationRunListItem }) {
  const identity = run.revision ?? run.deployment ?? "Not reported";
  return (
    <article className="grid gap-6 px-[clamp(1.25rem,3vw,2rem)] py-6 lg:grid-cols-[minmax(13rem,1.4fr)_minmax(10rem,1fr)_9rem_8rem_7rem] lg:items-center" data-assurance-kind={run.kind} data-assurance-outcome={run.displayOutcome} data-assurance-run-id={run.id}>
      <div className="min-w-0">
        <p className="font-mono text-[0.6rem] font-bold tracking-[0.09em] text-accent uppercase">{formatAssuranceKind(run.kind)}</p>
        <h2 className="mt-2 font-heading text-[clamp(1.65rem,3vw,2.35rem)] leading-none tracking-[-0.04em]"><Link className="underline decoration-foreground/15 underline-offset-6 hover:decoration-accent" href={`/assurance/${encodeURIComponent(run.id)}`}>{run.suite}</Link></h2>
        <p className="mt-3 text-xs text-muted-foreground">{caseCountSummary(run.caseCounts) || "No case result was recorded"}</p>
      </div>
      <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-1">
        <Fact label="Model" value={run.model ?? "Not applicable"} />
        <Fact label={run.revision ? "Commit" : "Deployment"} value={identity} />
        <Fact label="Target" value={run.target} />
      </dl>
      <Fact label="Started" value={formatAssuranceTime(run.startedAt)} />
      <Fact label="Duration" value={formatDuration(run.durationMs)} />
      <Badge className={assuranceOutcomeStyles[run.displayOutcome]} variant="outline">{assuranceOutcomeLabels[run.displayOutcome]}</Badge>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-mono text-[0.56rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt><dd className="mt-1.5 truncate text-xs" title={value}>{value}</dd></div>;
}

function AssuranceState({ state }: { state: Exclude<AssuranceListResult["state"], "ready" | "loading"> }) {
  const content = state === "empty"
    ? ["No assurance records match.", "Change the filters or run a recorded validation suite."]
    : state === "unauthorized"
      ? ["Assurance is not authorized.", "Sign in with an approved operator account before reading validation metadata."]
      : state === "invalid-record"
        ? ["A validation record is corrupt.", "The invalid row was not rendered. Inspect migrations and the app-owned database."]
        : ["Assurance data is unavailable.", "Restore database access and apply committed migrations before reading validation results."];
  return <Card className="min-h-64 border-foreground/20 bg-card py-0" role={state === "empty" ? "status" : "alert"}><CardContent className="grid min-h-64 content-center gap-4 p-[clamp(1.5rem,4vw,3.5rem)]"><p className="font-mono text-xs font-bold tracking-[0.1em] text-accent uppercase">Assurance ledger</p><h2 className="font-heading text-[clamp(2rem,4vw,3.5rem)] leading-none tracking-[-0.05em]">{content[0]}</h2><p className="max-w-xl leading-7 text-muted-foreground">{content[1]}</p></CardContent></Card>;
}
