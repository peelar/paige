import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SignalDetailResult } from "@/lib/signal-detail";

export function SignalDetail({ result }: { result: SignalDetailResult }) {
  if (result.state !== "ready") return <DetailFailure state={result.state} />;
  const signal = result.signal;

  return (
    <div className="grid gap-6">
      <Link className="w-fit text-sm font-bold text-accent underline underline-offset-4" href="/signals">← Back to signals</Link>

      <Card className="overflow-hidden border-foreground/25 bg-primary py-0 text-primary-foreground">
        <CardContent className="grid gap-8 p-[clamp(1.5rem,4vw,3.5rem)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground" variant="outline">{label(signal.status)}</Badge>
              <Badge className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground" variant="outline">{label(signal.sourceKind)}</Badge>
            </div>
            <h2 className="mt-5 max-w-4xl font-heading text-[clamp(2.2rem,5vw,4.8rem)] leading-[0.95] font-medium tracking-[-0.055em]">{signal.sourceSummary}</h2>
            <p className="mt-5 font-mono text-[0.64rem] tracking-[0.08em] text-primary-foreground/60 uppercase">Signal {signal.id}</p>
          </div>
          <div className="grid grid-cols-2 gap-6 border-t border-primary-foreground/20 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <Metric label="Priority" value={String(signal.priority)} />
            <Metric label="Updated" value={formatTime(signal.updatedAt)} />
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-px overflow-hidden rounded-xl border border-foreground/20 bg-foreground/20 md:grid-cols-3" aria-label="Signal decision context">
        <ContextCard label="Uncertainty" values={signal.uncertainty === null ? [] : [signal.uncertainty]} empty="None recorded" />
        <ContextCard label="Missing evidence" values={signal.missingEvidence} empty="No missing evidence" />
        <ContextCard label="Next action" values={signal.nextActionAt === null ? [] : [formatTime(signal.nextActionAt)]} empty="Not scheduled" />
      </section>

      {signal.ownedWork ? (
        <DetailSection eyebrow="Owned work" title="One task, one durable execution">
          <Card className="overflow-hidden border-foreground/20 bg-card py-0" data-owned-work-status={signal.ownedWork.status}>
            <CardContent className="grid gap-8 p-[clamp(1.4rem,3vw,2.4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)]">
              <div>
                <div className="flex flex-wrap gap-2"><Badge variant="outline">{label(signal.ownedWork.status)}</Badge><Badge variant="outline">Revision {signal.ownedWork.revision}</Badge></div>
                <h4 className="mt-5 max-w-3xl font-heading text-[clamp(1.8rem,3vw,3rem)] leading-tight font-medium tracking-[-0.035em]">{signal.ownedWork.intendedOutcome}</h4>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">Last meaningful milestone: {label(signal.ownedWork.lastMilestone ?? "accepted")}</p>
                {signal.ownedWork.conversation.url ? <ExternalLink href={signal.ownedWork.conversation.url}>Open originating {label(signal.ownedWork.conversation.kind)}</ExternalLink> : null}
              </div>
              <dl className="grid content-start gap-4 border-t border-foreground/15 pt-6 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                <Fact label="Work item" value={signal.ownedWork.id} />
                <Fact label="Eve session" value={signal.ownedWork.sessionId} />
                <Fact label="Latest run" value={signal.ownedWork.lastRunId} />
                <Fact label="Updated" value={formatTime(signal.ownedWork.updatedAt)} />
              </dl>
            </CardContent>
          </Card>
        </DetailSection>
      ) : null}

      <DetailSection eyebrow="Evidence map" title="What the signal appears to affect">
        <div className="grid gap-px overflow-hidden rounded-xl border border-foreground/15 bg-foreground/15 md:grid-cols-2">
          <ListPanel title="Extracted claims" values={signal.extractedClaims} />
          <ListPanel title="Likely docs pages" values={signal.likelyDocsPages} />
          <ListPanel title="Likely concepts" values={signal.likelyDocsConcepts} />
          <ListPanel title="Product surfaces" values={signal.productSurfaces} />
        </div>
      </DetailSection>

      <DetailSection eyebrow="Provenance" title="Source records">
        <div className="grid gap-4">
          {signal.sources.map((source) => (
            <Card className="border-foreground/20 bg-card py-0" data-signal-source-record key={source.id}>
              <CardContent className="grid gap-6 p-[clamp(1.3rem,3vw,2rem)] lg:grid-cols-[minmax(12rem,0.35fr)_minmax(0,1fr)]">
                <div>
                  <Badge variant="outline">{label(source.kind)}</Badge>
                  <h4 className="mt-4 font-heading text-2xl font-medium">{source.title ?? "Untitled source"}</h4>
                  <dl className="mt-5 grid gap-3 text-sm text-muted-foreground">
                    <Fact label="Provider" value={source.provider ?? "Not recorded"} />
                    <Fact label="Authors" value={source.authors.join(", ") || "Not recorded"} />
                    <Fact label="Captured" value={formatTime(source.capturedAt)} />
                    <Fact label="Source updated" value={source.sourceUpdatedAt === null ? "Not recorded" : formatTime(source.sourceUpdatedAt)} />
                  </dl>
                  {source.permalink ? <ExternalLink href={source.permalink}>Open source</ExternalLink> : null}
                </div>
                <div className="grid gap-5">
                  <div>
                    <PanelLabel>Verbatim source content</PanelLabel>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-foreground/15 bg-background p-4 font-sans text-sm leading-6">{source.sourceText ?? "No source text stored."}</pre>
                  </div>
                  <Metadata value={source.metadata} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DetailSection>

      <DetailSection eyebrow="Workflow history" title="Lifecycle events">
        <ol className="grid gap-0 border-l border-foreground/25 pl-6">
          {signal.events.map((event, index) => (
            <li className="relative border-b border-foreground/15 py-6 first:pt-0 last:border-b-0" data-signal-event={event.id} key={event.id}>
              <span className="absolute top-7 -left-[1.79rem] size-3 rounded-full border-2 border-background bg-accent first:top-1" aria-hidden="true" />
              <p className="font-mono text-[0.62rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{String(index + 1).padStart(2, "0")} · {formatTime(event.createdAt)}</p>
              <h4 className="mt-2 font-heading text-2xl font-medium">{eventTitle(event.eventType, event.fromStatus, event.toStatus)}</h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{event.reason}</p>
              <p className="mt-3 text-xs">Actor: <span className="font-mono">{event.actor}</span></p>
              <Metadata value={event.metadata} />
            </li>
          ))}
        </ol>
      </DetailSection>

      <DetailSection eyebrow="Workflow output" title="Reports, checks, diffs, and handoffs">
        <div className="grid gap-4 lg:grid-cols-2">
          {signal.artifacts.map((artifact) => (
            <Card className="border-foreground/20 bg-card py-0" data-artifact-kind={artifact.kind} key={artifact.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div><PanelLabel>{label(artifact.kind)}</PanelLabel><h4 className="mt-2 font-heading text-2xl font-medium">{artifact.label ?? "Untitled artifact"}</h4></div>
                  <time className="text-xs text-muted-foreground" dateTime={artifact.createdAt}>{formatTime(artifact.createdAt)}</time>
                </div>
                {artifact.path ? <p className="mt-4 break-all font-mono text-xs">Path: {artifact.path}</p> : null}
                {artifact.url ? <ExternalLink href={artifact.url}>Open artifact</ExternalLink> : null}
                <Metadata value={artifact.metadata} />
              </CardContent>
            </Card>
          ))}
        </div>
      </DetailSection>

      {signal.links.length > 0 ? (
        <DetailSection eyebrow="References" title="Related links">
          <ul className="grid gap-2">
            {signal.links.map((link) => <li className="rounded-lg border border-foreground/15 bg-card p-4" key={link.id}>{link.url ? <ExternalLink href={link.url}>{link.label ?? label(link.kind)}</ExternalLink> : <span>{link.label ?? label(link.kind)} · unavailable or unsafe URL</span>}</li>)}
          </ul>
        </DetailSection>
      ) : null}
    </div>
  );
}

function DetailFailure({ state }: { state: Exclude<SignalDetailResult["state"], "ready"> }) {
  const copy = {
    missing: ["Signal not found", "This signal does not exist in the current workspace."],
    corrupt: ["Invalid signal record", "The persisted detail does not match the current contract and will not be partially rendered."],
    unauthorized: ["Signal access denied", "This operator context is not authorized to read the requested signal."],
    "database-error": ["Signal database unavailable", "Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate before retrying."],
  }[state];
  return <Card className="border-destructive/30 bg-card py-0" data-signal-detail-state={state} role="alert"><CardContent className="grid min-h-72 content-end p-[clamp(1.5rem,4vw,3.5rem)]"><PanelLabel>Detail unavailable</PanelLabel><h2 className="mt-3 font-heading text-[clamp(2rem,5vw,4rem)] leading-none font-medium">{copy[0]}</h2><p className="mt-5 max-w-xl leading-7 text-muted-foreground">{copy[1]}</p><Link className="mt-6 w-fit text-sm font-bold text-accent underline underline-offset-4" href="/signals">Return to signals</Link></CardContent></Card>;
}

function DetailSection({ children, eyebrow, title }: { children: React.ReactNode; eyebrow: string; title: string }) { return <section className="grid gap-5"><div><PanelLabel>{eyebrow}</PanelLabel><h3 className="mt-2 font-heading text-[clamp(2rem,4vw,3.4rem)] leading-none font-medium tracking-[-0.045em]">{title}</h3></div>{children}</section>; }
function Metric({ label: name, value }: { label: string; value: string }) { return <div><p className="font-mono text-[0.6rem] tracking-[0.08em] text-primary-foreground/55 uppercase">{name}</p><p className="mt-2 max-w-32 font-heading text-2xl leading-tight">{value}</p></div>; }
function ContextCard({ empty, label: name, values }: { empty: string; label: string; values: string[] }) { return <div className="min-h-36 bg-card p-5"><PanelLabel>{name}</PanelLabel><p className="mt-4 text-sm leading-6 text-muted-foreground">{values.join(" ") || empty}</p></div>; }
function ListPanel({ title, values }: { title: string; values: string[] }) { return <div className="min-h-40 bg-card p-5"><PanelLabel>{title}</PanelLabel>{values.length ? <ul className="mt-4 grid gap-2 text-sm leading-6">{values.map((value) => <li key={value}>— {value}</li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">None recorded</p>}</div>; }
function Fact({ label: name, value }: { label: string; value: string }) { return <div><dt className="font-mono text-[0.58rem] tracking-[0.08em] uppercase">{name}</dt><dd className="mt-1 break-all text-foreground">{value}</dd></div>; }
function PanelLabel({ children }: { children: React.ReactNode }) { return <p className="font-mono text-[0.62rem] font-bold tracking-[0.09em] text-accent uppercase">{children}</p>; }
function ExternalLink({ children, href }: { children: React.ReactNode; href: string }) { return <a className="mt-4 inline-block text-sm font-bold text-accent underline underline-offset-4" href={href} rel="noreferrer" target="_blank">{children} ↗</a>; }
function Metadata({ value }: { value: Record<string, unknown> }) { return Object.keys(value).length ? <div className="mt-5"><PanelLabel>Redacted metadata</PanelLabel><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-foreground/15 bg-background p-4 text-xs leading-5">{JSON.stringify(value, null, 2)}</pre></div> : null; }
function transition(from: string | null, to: string | null): string { return from === null ? `Created as ${label(to ?? "unknown")}` : `${label(from)} → ${label(to ?? "unknown")}`; }
function eventTitle(eventType: string, from: string | null, to: string | null): string { return from === null && to === null ? label(eventType) : transition(from, to); }
function label(value: string): string { return value.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" "); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC"; }
