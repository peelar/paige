import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CapabilityReportResult } from "@/lib/capabilities";

export function CapabilityReport({ result }: { result: CapabilityReportResult }) {
  if (result.state !== "ready") {
    return <CapabilityFailure state={result.state} />;
  }
  return (
    <div className="grid gap-8" data-capability-projection>
      <Card className="border-accent/35 bg-[#f4ead8] py-0">
        <CardContent className="p-[clamp(1.25rem,3vw,2.25rem)]">
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Visibility is not authorization</p>
          <p className="mt-2 max-w-4xl text-sm leading-6">{result.report.summary}</p>
        </CardContent>
      </Card>
      {result.report.contexts.map((context) => (
        <section className="grid gap-4" data-capability-context={context.context} key={context.context}>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.5fr)] md:items-end">
            <div><p className="font-mono text-[0.62rem] font-bold tracking-[0.09em] text-accent uppercase">{context.principalClass}</p><h2 className="mt-2 font-heading text-[clamp(2rem,4vw,3.4rem)] leading-none tracking-[-0.045em]">{context.label}</h2></div>
            <p className="text-sm leading-6 text-muted-foreground">Verified by {context.verifiedBy}.</p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-xl border border-foreground/15 bg-foreground/15 md:grid-cols-2 xl:grid-cols-3">
            {context.capabilities.map((capability) => (
              <article className="min-h-56 bg-card p-5" data-capability-family={capability.family} data-capability-availability={capability.availability} key={capability.family}>
                <div className="flex items-start justify-between gap-3"><p className="font-mono text-[0.62rem] font-bold text-muted-foreground">{capability.family}</p><Badge variant="outline">{label(capability.availability)}</Badge></div>
                <h3 className="mt-8 font-heading text-2xl leading-none">{capability.label}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{capability.explanation}</p>
                {capability.toolNames.length ? <p className="mt-4 break-words font-mono text-[0.68rem]">Surface: {capability.toolNames.join(", ")}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CapabilityFailure({ state }: { state: "invalid-record" | "database-error" }) { return <Card className="min-h-64 border-destructive/30 bg-card py-0" role="alert"><CardContent className="grid min-h-64 content-center p-[clamp(1.5rem,4vw,3.5rem)]"><h2 className="font-heading text-[clamp(2rem,4vw,3.5rem)] leading-none">{state === "invalid-record" ? "Invalid capability projection" : "Capability data unavailable"}</h2><p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{state === "invalid-record" ? "The server projection no longer matches the current capability contract and was not partially rendered." : "Restore setup and database access before asking the resolver to explain effective authority."}</p></CardContent></Card>; }
function label(value: string): string { return value.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" "); }
