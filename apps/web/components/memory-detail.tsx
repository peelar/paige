import type { OperatorMemoryDetail } from "@docs-agent/control-plane";
import Link from "next/link";

import { MemoryLifecycleActions } from "@/components/memory-lifecycle-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MemoryDetailResult } from "@/lib/memory-review";
import {
  formatMemoryKind,
  formatMemoryTimestamp,
  memoryDisplayLabels,
  memoryDisplayStyles,
} from "@/lib/memory-display";
import { cn } from "@/lib/utils";

export function MemoryDetail({ result }: { result: MemoryDetailResult }) {
  if (result.state !== "ready") {
    const content = result.state === "missing"
      ? ["Memory not found", "This workspace memory does not exist or is no longer available."]
      : result.state === "invalid-record"
        ? ["Memory record is invalid", "The persisted record was not rendered because it does not match the current contract."]
        : ["Memory database unavailable", "Restore database access and apply migrations before reviewing this record."];
    return (
      <Card className="min-h-72 border-foreground/20 bg-card py-0" data-memory-detail-state={result.state} role={result.state === "missing" ? "status" : "alert"}>
        <CardContent className="grid min-h-72 content-center gap-5 p-[clamp(1.5rem,4vw,3.5rem)]">
          <p className="font-mono text-xs font-bold tracking-[0.1em] text-accent uppercase">Review unavailable</p>
          <h2 className="font-heading text-[clamp(2.2rem,5vw,4.5rem)] leading-none tracking-[-0.055em]">{content[0]}</h2>
          <p className="max-w-xl leading-7 text-muted-foreground">{content[1]}</p>
          <Link className="w-fit text-sm font-bold text-accent underline underline-offset-4" href="/memories">Return to memories</Link>
        </CardContent>
      </Card>
    );
  }

  const memory = result.memory;
  return (
    <div className="grid gap-6" data-memory-detail-state="ready" data-memory-id={memory.id}>
      <Link className="w-fit text-sm font-bold text-accent underline decoration-accent/30 underline-offset-4" href="/memories">← Back to workspace memories</Link>

      <Card className="overflow-hidden border-foreground/25 bg-primary py-0 text-primary-foreground">
        <CardContent className="grid gap-8 p-[clamp(1.5rem,5vw,4rem)] lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-3">
              <Badge className={cn(memoryDisplayStyles[memory.displayState])} variant="outline">{memoryDisplayLabels[memory.displayState]}</Badge>
              <Badge className="border-primary-foreground/25 text-primary-foreground" variant="outline">{formatMemoryKind(memory.kind)}</Badge>
            </div>
            <p className="mt-10 font-mono text-[0.64rem] font-bold tracking-[0.1em] text-primary-foreground/55 uppercase">Model-generated memory text</p>
            <h2 className="mt-4 max-w-[25ch] font-heading text-[clamp(2.3rem,5vw,5rem)] leading-[0.94] font-medium tracking-[-0.055em]">{memory.statement}</h2>
          </div>
          <dl className="grid gap-4 border-t border-primary-foreground/20 pt-5 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <Fact label="Confidence" value={memory.confidence} />
            <Fact label="Scope" value={memory.scope ?? "Not set"} />
            <Fact label="Fresh until" value={formatMemoryTimestamp(memory.freshUntil)} />
            <Fact label="Last validated" value={formatMemoryTimestamp(memory.lastValidatedAt)} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          <Card className="border-foreground/20 bg-card py-0">
            <CardContent className="p-[clamp(1.5rem,4vw,3rem)]">
              <SectionLabel>Memory interpretation</SectionLabel>
              <p className="mt-5 max-w-3xl text-lg leading-8">{memory.summary ?? "No separate summary was recorded."}</p>
              <div className="mt-6 flex flex-wrap gap-2">{memory.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div>
              {memory.staleReason ? <div className="mt-7 border-l-2 border-destructive pl-4"><p className="font-mono text-xs font-bold tracking-[0.08em] text-destructive uppercase">Why it is stale</p><p className="mt-2 leading-7">{memory.staleReason}</p></div> : null}
            </CardContent>
          </Card>

          <section className="grid gap-4" aria-labelledby="memory-provenance-title">
            <div>
              <SectionLabel>Provenance · separate from memory text</SectionLabel>
              <h2 className="mt-2 font-heading text-[clamp(2rem,4vw,3.4rem)] leading-none tracking-[-0.05em]" id="memory-provenance-title">What this memory came from</h2>
            </div>
            {memory.sources.map((source) => (
              <Card className="border-foreground/20 bg-card py-0" data-memory-source key={source.id}>
                <CardContent className="grid gap-5 p-[clamp(1.3rem,3vw,2.25rem)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">{formatMemoryKind(source.kind)}</p>
                    {source.url ? <a className="text-sm font-bold text-accent underline underline-offset-4" href={source.url} rel="noreferrer" target="_blank">Open source ↗</a> : null}
                  </div>
                  <h3 className="font-heading text-2xl tracking-[-0.035em]">{source.label ?? "Unlabelled source"}</h3>
                  {source.sourceText ? <blockquote className="whitespace-pre-wrap border-l-2 border-accent/50 pl-4 text-sm leading-7 text-foreground/75">{source.sourceText}</blockquote> : <p className="text-sm text-muted-foreground">No verbatim source text was retained.</p>}
                  <p className="text-xs text-muted-foreground">Captured {formatMemoryTimestamp(source.createdAt)} UTC</p>
                </CardContent>
              </Card>
            ))}
            <p className="rounded-lg border border-accent/30 bg-[#f4ead8] p-4 text-sm leading-6">
              Provenance explains why the memory exists. It still is not proof for a public documentation claim until the source and current docs are verified.
            </p>
          </section>

          <section className="grid gap-4" aria-labelledby="memory-history-title">
            <div><SectionLabel>Append-only audit</SectionLabel><h2 className="mt-2 font-heading text-[clamp(2rem,4vw,3.4rem)] leading-none tracking-[-0.05em]" id="memory-history-title">Lifecycle history</h2></div>
            <ol className="grid gap-px overflow-hidden rounded-xl border border-foreground/20 bg-foreground/15">
              {memory.events.map((event, index) => (
                <li className="grid gap-4 bg-card p-[clamp(1.25rem,3vw,2rem)] md:grid-cols-[3rem_minmax(0,1fr)_auto]" data-memory-event key={event.id}>
                  <span className="font-mono text-xs font-bold text-accent">{String(index + 1).padStart(2, "0")}</span>
                  <div><h3 className="font-heading text-xl capitalize">{event.eventType.replaceAll("-", " ")}</h3><p className="mt-1 font-mono text-[0.62rem] font-bold tracking-[0.06em] text-accent uppercase">{event.fromStatus === null ? `Created as ${event.toStatus ?? "recorded"}` : `${event.fromStatus} → ${event.toStatus ?? "recorded"}`}</p><p className="mt-2 text-sm leading-6 text-foreground/75">{event.reason}</p><p className="mt-3 font-mono text-[0.62rem] text-muted-foreground">Actor · {event.actor}</p></div>
                  <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{formatMemoryTimestamp(event.createdAt)}</time>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="h-fit rounded-xl border border-foreground/20 bg-card p-[clamp(1.25rem,3vw,2rem)] xl:sticky xl:top-6">
          <SectionLabel>Lifecycle decision</SectionLabel>
          <h2 className="mt-3 font-heading text-3xl leading-none tracking-[-0.04em]">Review without rewriting.</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">Promote confirmed proposals. Mark active context stale when it needs revalidation, or retire context that should no longer route work.</p>
          <div className="mt-6 border-t border-foreground/15 pt-6"><MemoryLifecycleActions memory={memory} /></div>
        </aside>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">{children}</p>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-primary-foreground/55 uppercase">{label}</dt><dd className="mt-1.5 capitalize text-primary-foreground/85">{value}</dd></div>;
}
