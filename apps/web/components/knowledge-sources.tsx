import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { KnowledgeSourcesResult } from "@/lib/knowledge-sources";

export function KnowledgeSources({ result }: { result: KnowledgeSourcesResult }) {
  if (result.state !== "ready") {
    return <ProjectionFailure kind="source" state={result.state} />;
  }
  if (result.report.state === "unconfigured") {
    return <ProjectionState title="No sources configured" body={result.report.summary} />;
  }
  return (
    <div className="grid gap-6" data-source-projection-state={result.report.state}>
      <p className="max-w-4xl leading-7 text-muted-foreground">{result.report.summary}</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {result.report.sources.map((source) => (
          <Card className="border-foreground/20 bg-card py-0" data-source-id={source.sourceId} key={source.sourceId}>
            <CardContent className="grid gap-6 p-[clamp(1.3rem,3vw,2.2rem)]">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{label(source.kind)}</Badge>
                  <Badge variant="outline">{label(source.readiness.status)}</Badge>
                  <Badge variant="outline">{source.authority.draftMutation === "none" ? "Read only" : "Draft target"}</Badge>
                </div>
                <h2 className="mt-5 font-heading text-[clamp(1.8rem,3vw,2.8rem)] leading-none tracking-[-0.04em]">{source.displayName}</h2>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{source.description}</p>
              </div>
              <dl className="grid gap-4 border-t border-foreground/15 pt-5 text-sm sm:grid-cols-2">
                <Fact name="Evidence class" value={label(source.evidenceClass)} />
                <Fact name="Access" value={label(source.readiness.access)} />
                <Fact name="Requested ref" value={source.repository.requestedRef} />
                <Fact name="Resolved revision" value={source.repository.resolvedRevision ?? "Pending verified read"} />
                <Fact name="Freshness" value={source.repository.observedAt ? formatTime(source.repository.observedAt) : "Not observed yet"} />
                <Fact name="Public claim" value={source.canSupportPublicDocsClaim ? "Eligible with verification" : "Cannot prove independently"} />
              </dl>
              <div className="rounded-lg border border-foreground/15 bg-background p-4 text-sm leading-6">
                <p className="font-mono text-[0.6rem] font-bold tracking-[0.08em] text-accent uppercase">Authority boundary</p>
                <p className="mt-2">{source.authority.explanation}</p>
                <p className="mt-2 text-muted-foreground">Reads: {source.authority.readActions.join(", ")}. Source content is {source.contentTrust.replace("-", " ")}.</p>
              </div>
              <a className="w-fit text-sm font-bold text-accent underline underline-offset-4" href={source.repository.url} rel="noreferrer" target="_blank">Open repository ↗</a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProjectionFailure({ kind, state }: { kind: string; state: "invalid-record" | "database-error" }) {
  return <ProjectionState error title={state === "invalid-record" ? `Invalid ${kind} projection` : `${label(kind)} data unavailable`} body={state === "invalid-record" ? "Stored setup no longer matches the typed operator contract and was not partially rendered." : "Restore the app-owned database and apply committed migrations before retrying."} />;
}
function ProjectionState({ body, error = false, title }: { body: string; error?: boolean; title: string }) { return <Card className="min-h-64 border-foreground/20 bg-card py-0" role={error ? "alert" : "status"}><CardContent className="grid min-h-64 content-center p-[clamp(1.5rem,4vw,3.5rem)]"><h2 className="font-heading text-[clamp(2rem,4vw,3.5rem)] leading-none">{title}</h2><p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{body}</p></CardContent></Card>; }
function Fact({ name, value }: { name: string; value: string }) { return <div><dt className="font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">{name}</dt><dd className="mt-1.5 break-all">{value}</dd></div>; }
function label(value: string): string { return value.split(/[-.]/u).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" "); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC"; }
