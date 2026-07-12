import type {
  ValidationAssuranceDetail,
  ValidationRun,
} from "@docs-agent/control-plane";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  assuranceOutcomeLabels,
  assuranceOutcomeStyles,
  formatAssuranceKind,
  formatAssuranceTime,
  formatDuration,
} from "@/lib/assurance-display";
import type { AssuranceDetailResult } from "@/lib/assurance";
import { cn } from "@/lib/utils";

export function AssuranceDetail({
  baselineId,
  result,
  scenario,
}: {
  baselineId?: string;
  result: AssuranceDetailResult;
  scenario?: string;
}) {
  if (result.state !== "ready") return <Unavailable state={result.state} />;
  const { detail } = result;
  const { run } = detail;
  const displayOutcome = new Date(run.expiresAt).getTime() <= Date.now()
    ? "expired"
    : run.outcome;

  return (
    <div className="grid gap-6" data-assurance-detail-state="ready" data-assurance-run-id={run.id}>
      <Link className="w-fit text-sm font-bold text-accent underline decoration-accent/30 underline-offset-4" href="/assurance">← Back to assurance</Link>
      <Card className="overflow-hidden border-foreground/25 bg-primary py-0 text-primary-foreground">
        <CardContent className="grid gap-10 p-[clamp(1.5rem,5vw,4rem)] lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-3">
              <Badge className={assuranceOutcomeStyles[displayOutcome]} variant="outline">{assuranceOutcomeLabels[displayOutcome]}</Badge>
              <Badge className="border-primary-foreground/25 text-primary-foreground" variant="outline">{formatAssuranceKind(run.kind)}</Badge>
            </div>
            <p className="mt-10 font-mono text-[0.64rem] font-bold tracking-[0.11em] text-[#d7aa6d] uppercase">Recorded assurance</p>
            <h2 className="mt-4 max-w-[16ch] font-heading text-[clamp(3rem,7vw,6.5rem)] leading-[0.86] tracking-[-0.065em]">{run.suite}</h2>
          </div>
          <dl className="grid gap-4 border-t border-primary-foreground/20 pt-6 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
            <HeroFact label="Target" value={run.target} />
            <HeroFact label="Model" value={run.model ?? "Not applicable"} />
            <HeroFact label="Commit / deployment" value={run.revision ?? run.deployment ?? "Not reported"} />
            <HeroFact label="Started" value={formatAssuranceTime(run.startedAt)} />
            <HeroFact label="Duration" value={formatDuration(run.durationMs)} />
          </dl>
        </CardContent>
      </Card>

      <BaselineComparison baselineId={baselineId} detail={detail} scenario={scenario} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="grid gap-4" aria-labelledby="assurance-log-title">
          <div>
            <SectionLabel>Safe summaries only</SectionLabel>
            <h2 className="mt-2 font-heading text-[clamp(2.2rem,5vw,4rem)] leading-none tracking-[-0.055em]" id="assurance-log-title">Recorded assurance log</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Each case names the product behavior under test, its assertion contract, and a redacted failure summary. Prompts, outputs, private context, reasoning, credentials, and raw event logs are not stored here.</p>
          </div>
          <ol className="grid gap-4">
            {run.cases.map((item, index) => (
              <CaseRecord caseRecord={item} index={index} key={item.id} />
            ))}
          </ol>
        </section>

        <aside className="h-fit rounded-xl border border-foreground/20 bg-card p-[clamp(1.25rem,3vw,2rem)] xl:sticky xl:top-6">
          <SectionLabel>Record contract</SectionLabel>
          <h2 className="mt-3 font-heading text-3xl leading-none tracking-[-0.045em]">Bounded proof, retained briefly.</h2>
          <dl className="mt-6 grid gap-5 border-t border-foreground/15 pt-6 text-sm">
            <SideFact label="Run id" value={run.id} />
            <SideFact label="Proof type" value={formatAssuranceKind(run.kind)} />
            <SideFact label="Redaction policy" value={`Version ${run.redactionVersion}`} />
            <SideFact label="Completed" value={formatAssuranceTime(run.completedAt)} />
            <SideFact label="Expires" value={formatAssuranceTime(run.expiresAt)} />
          </dl>
          {run.artifactReferences.length > 0 ? <div className="mt-6 border-t border-foreground/15 pt-6"><p className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Safe artifact references</p><ul className="mt-3 grid gap-2">{run.artifactReferences.map((reference) => <li className="break-all rounded-md bg-muted px-3 py-2 font-mono text-[0.68rem]" key={reference}>{reference}</li>)}</ul></div> : null}
          <p className="mt-6 border-t border-foreground/15 pt-6 text-xs leading-5 text-muted-foreground">This view reads recorded summaries only. It cannot start evals, run repository commands, or change an assertion.</p>
        </aside>
      </div>
    </div>
  );
}

function BaselineComparison({
  baselineId,
  detail,
  scenario,
}: {
  baselineId?: string;
  detail: ValidationAssuranceDetail;
  scenario?: string;
}) {
  const counts = detail.comparison.reduce(
    (result, item) => ({ ...result, [item.change]: result[item.change] + 1 }),
    { unchanged: 0, new: 0, missing: 0, improved: 0, regressed: 0, weakened: 0 },
  );
  return (
    <Card className="border-foreground/20 bg-[#f4ead8] py-0" data-baseline-state={detail.baseline === null ? "missing" : "ready"}>
      <CardContent className="grid gap-7 p-[clamp(1.4rem,4vw,3rem)]">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-end">
          <div>
            <SectionLabel>Earlier compatible run</SectionLabel>
            <h2 className="mt-3 font-heading text-[clamp(2rem,4vw,3.8rem)] leading-none tracking-[-0.055em]">Baseline comparison</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/70">Comparison is restricted to an earlier run of the same suite and proof type. Removed assertions, softer gates, and lower thresholds are called out as weakened.</p>
          </div>
          {detail.availableBaselines.length > 0 ? <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" method="get"><label className="grid gap-2 text-sm font-medium">Baseline<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={baselineId ?? detail.baseline?.id ?? ""} name="baseline">{detail.availableBaselines.map((candidate) => <option key={candidate.id} value={candidate.id}>{formatAssuranceTime(candidate.startedAt)} · {candidate.revision ?? candidate.deployment ?? candidate.id}</option>)}</select></label>{scenario ? <input name="scenario" type="hidden" value={scenario} /> : null}<Button className="h-10" type="submit">Compare</Button></form> : null}
        </div>
        {detail.baseline === null ? <div className="border-l-2 border-amber-700 pl-4 text-sm leading-6">No earlier compatible baseline has been recorded. This run stands alone and is not presented as a regression.</div> : <><div className="grid gap-px overflow-hidden rounded-lg bg-foreground/15 sm:grid-cols-3"><ComparisonFact label="Current" value={`${assuranceOutcomeLabels[detail.run.outcome]} · ${detail.run.revision ?? detail.run.deployment ?? detail.run.id}`} /><ComparisonFact label="Baseline" value={`${assuranceOutcomeLabels[detail.baseline.outcome]} · ${detail.baseline.revision ?? detail.baseline.deployment ?? detail.baseline.id}`} /><ComparisonFact label="Change" value={`${counts.regressed} regressed · ${counts.weakened} weakened · ${counts.improved} improved`} /></div><ul className="grid gap-2">{detail.comparison.filter((item) => item.change !== "unchanged").map((item) => <li className="flex flex-col justify-between gap-2 rounded-lg border border-foreground/15 bg-card/70 px-4 py-3 sm:flex-row sm:items-center" data-comparison-change={item.change} key={item.caseId}><span className="font-medium">{item.name}</span><span className={cn("font-mono text-[0.62rem] font-bold tracking-[0.08em] uppercase", item.change === "regressed" || item.change === "weakened" || item.change === "missing" ? "text-destructive" : "text-emerald-800")}>{item.change} · {item.baselineOutcome ?? "not present"} → {item.currentOutcome ?? "not present"}</span></li>)}</ul></>}
      </CardContent>
    </Card>
  );
}

function CaseRecord({ caseRecord, index }: { caseRecord: ValidationRun["cases"][number]; index: number }) {
  return (
    <li className="overflow-hidden rounded-xl border border-foreground/20 bg-card" data-assurance-case={caseRecord.caseId} data-assurance-case-outcome={caseRecord.outcome}>
      <div className="grid gap-5 p-[clamp(1.25rem,3vw,2rem)] md:grid-cols-[3rem_minmax(0,1fr)_auto]">
        <span className="font-mono text-xs font-bold text-accent">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <p className="font-mono text-[0.6rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Related product behavior</p>
          <h3 className="mt-2 max-w-3xl font-heading text-2xl leading-tight tracking-[-0.03em]">{caseRecord.name}</h3>
          <p className="mt-2 font-mono text-[0.62rem] text-muted-foreground">{caseRecord.caseId}</p>
        </div>
        <Badge className={assuranceOutcomeStyles[caseRecord.outcome]} variant="outline">{assuranceOutcomeLabels[caseRecord.outcome]}</Badge>
      </div>
      {caseRecord.failureSummary ? <p className="mx-[clamp(1.25rem,3vw,2rem)] mb-5 border-l-2 border-destructive pl-4 text-sm leading-6 text-destructive">{caseRecord.failureSummary}</p> : null}
      <div className="border-t border-foreground/15 bg-background/55 px-[clamp(1.25rem,3vw,2rem)] py-5">
        <p className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Assertions</p>
        {caseRecord.assertions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No assertion summary was recorded. This case is not treated as passing.</p> : <ul className="mt-3 grid gap-2">{caseRecord.assertions.map((assertion, assertionIndex) => <li className="grid gap-2 rounded-md border border-foreground/15 bg-card px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" data-assertion-passed={assertion.passed} key={`${assertion.name}:${assertionIndex}`}><span className="font-medium">{assertion.name}</span><span className="font-mono text-[0.62rem] text-muted-foreground">{assertion.severity ?? "severity not reported"}{assertion.threshold === undefined ? "" : ` · threshold ${assertion.threshold}`}{assertion.score === undefined ? "" : ` · score ${assertion.score}`}</span><strong className={assertion.passed ? "text-emerald-800" : "text-destructive"}>{assertion.passed ? "Held" : "Did not hold"}</strong></li>)}</ul>}
        <div className="mt-4 flex flex-wrap justify-between gap-3 text-xs text-muted-foreground"><span>{formatDuration(caseRecord.durationMs)} · {formatAssuranceTime(caseRecord.startedAt)}</span>{caseRecord.artifactReference ? <code className="break-all">{caseRecord.artifactReference}</code> : <span>No artifact reference</span>}</div>
      </div>
    </li>
  );
}

function Unavailable({ state }: { state: Exclude<AssuranceDetailResult["state"], "ready"> }) {
  const content = state === "missing"
    ? ["Validation run not found", "This record does not exist or its 30-day retention has elapsed."]
    : state === "baseline-invalid"
      ? ["Baseline is not compatible", "Choose an earlier run of the same suite and proof type. The comparison was not widened."]
      : state === "unauthorized"
        ? ["Assurance detail is not authorized", "Sign in with an approved operator account before reading validation metadata."]
        : state === "invalid-record"
          ? ["Validation record is corrupt", "The stored result was not rendered because it does not match the current redacted contract."]
          : ["Assurance database unavailable", "Restore database access and apply migrations before reviewing this validation run."];
  return <Card className="min-h-72 border-foreground/20 bg-card py-0" data-assurance-detail-state={state} role={state === "missing" ? "status" : "alert"}><CardContent className="grid min-h-72 content-center gap-5 p-[clamp(1.5rem,4vw,3.5rem)]"><p className="font-mono text-xs font-bold tracking-[0.1em] text-accent uppercase">Assurance unavailable</p><h2 className="font-heading text-[clamp(2.2rem,5vw,4.5rem)] leading-none tracking-[-0.055em]">{content[0]}</h2><p className="max-w-xl leading-7 text-muted-foreground">{content[1]}</p><Link className="w-fit text-sm font-bold text-accent underline underline-offset-4" href="/assurance">Return to assurance</Link></CardContent></Card>;
}

function SectionLabel({ children }: { children: string }) { return <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">{children}</p>; }
function HeroFact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-primary-foreground/55 uppercase">{label}</dt><dd className="mt-1.5 break-all text-primary-foreground/85">{value}</dd></div>; }
function SideFact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt><dd className="mt-1.5 break-all">{value}</dd></div>; }
function ComparisonFact({ label, value }: { label: string; value: string }) { return <div className="bg-card/80 p-4"><p className="font-mono text-[0.56rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>; }
