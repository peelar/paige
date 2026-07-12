import type { ReadinessItem, ReadinessReport } from "@docs-agent/control-plane";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReadinessRecheckButton } from "@/components/readiness-recheck-button";
import { cn } from "@/lib/utils";

const stateStyles: Record<ReadinessItem["state"], string> = {
  verified: "border-[#718251]/35 bg-[#dce4c8] text-[#2f482f]",
  reachable: "border-[#54716a]/30 bg-[#dce8e2] text-[#24463f]",
  configured: "border-[#aa7e3d]/35 bg-[#f1dfbd] text-[#674515]",
  blocked: "border-destructive/30 bg-[#f0d1c8] text-[#762c22]",
  unknown: "border-foreground/15 bg-muted text-muted-foreground",
};

const stateMarks: Record<ReadinessItem["state"], string> = {
  verified: "●",
  reachable: "◉",
  configured: "◐",
  blocked: "×",
  unknown: "?",
};

const stageMarks = {
  verified: "●",
  "action-required": "→",
  blocked: "×",
  unknown: "?",
  "not-applicable": "—",
} as const;

export function ReadinessBoard({ report }: { report: ReadinessReport }) {
  const readyCount = report.items.filter(({ ready }) => ready).length;

  return (
    <div className="grid gap-5" data-readiness-overall={report.overall}>
      <Card className="relative overflow-hidden border-foreground/25 bg-primary py-0 text-primary-foreground shadow-[0_28px_80px_rgba(24,51,44,0.18)]">
        <div className="absolute inset-y-0 right-0 w-1/2 opacity-25 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_18px,currentColor_19px,currentColor_20px)]" aria-hidden="true" />
        <CardContent className="relative grid gap-8 p-[clamp(1.5rem,4vw,3.5rem)] md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-primary-foreground/65 uppercase">
              Workspace readiness / live report
            </p>
            <h2 className="mt-4 max-w-[13ch] font-heading text-[clamp(2.6rem,6vw,5.5rem)] leading-[0.9] font-medium tracking-[-0.055em] text-balance">
              {overallTitle(report.overall)}
            </h2>
            <p className="mt-6 max-w-2xl text-sm leading-6 text-primary-foreground/75">
              A green count means the required check passed. Configured, reachable,
              and unknown states remain explicit instead of being promoted to verified.
            </p>
          </div>
          <div className="grid min-w-36 justify-items-end border-t border-primary-foreground/20 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-8">
            <span className="font-heading text-[clamp(4rem,8vw,7rem)] leading-none tracking-[-0.08em]">
              {readyCount}
              <span className="text-2xl text-primary-foreground/45">/6</span>
            </span>
            <span className="mt-2 font-mono text-[0.64rem] font-bold tracking-[0.1em] text-primary-foreground/60 uppercase">
              checks ready
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-px overflow-hidden rounded-xl border border-foreground/20 bg-foreground/20 lg:grid-cols-2">
        {report.items.map((item, index) => (
          <ReadinessCard item={item} index={index + 1} key={item.id} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[0.66rem] leading-5 font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Last checked <time dateTime={report.checkedAt}>{formatTimestamp(report.checkedAt)}</time>
        </p>
        <ReadinessRecheckButton />
      </div>
    </div>
  );
}

function ReadinessCard({ item, index }: { item: ReadinessItem; index: number }) {
  return (
    <article
      className="group min-h-80 bg-card p-[clamp(1.3rem,3vw,2.25rem)] transition-colors hover:bg-popover"
      data-readiness-id={item.id}
      data-readiness-state={item.state}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="font-mono text-[0.66rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">
          {String(index).padStart(2, "0")}
        </span>
        <Badge className={cn("gap-2 rounded-full px-3 py-1 capitalize", stateStyles[item.state])} variant="outline">
          <span aria-hidden="true">{stateMarks[item.state]}</span>
          {item.state}
        </Badge>
      </div>

      <h3 className="mt-10 font-heading text-[clamp(1.8rem,3vw,2.6rem)] leading-none font-medium tracking-[-0.045em]">
        {item.label}
      </h3>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{item.summary}</p>

      {item.detail.length > 0 ? (
        <ul className="mt-5 grid gap-1.5 text-xs leading-5 text-foreground/75">
          {item.detail.map((detail) => <li key={detail}>— {detail}</li>)}
        </ul>
      ) : null}

      {item.stages.length > 0 ? (
        <div className="mt-7 border-y border-foreground/15" data-connector-stages={item.id}>
          {item.stages.map((stage) => (
            <div
              className="grid gap-2 border-t border-foreground/10 py-4 first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
              data-connector-stage={stage.id}
              data-connector-stage-state={stage.state}
              key={stage.id}
            >
              <p className="font-mono text-[0.61rem] leading-5 font-bold tracking-[0.08em] uppercase">
                <span className="mr-2 text-accent" aria-hidden="true">{stageMarks[stage.state]}</span>
                {stage.label}
              </p>
              <div>
                <p className="text-xs leading-5 text-foreground/75">{stage.summary}</p>
                {stage.action ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-foreground/15 bg-background/70 p-3">
                    <p className="text-xs leading-5 font-medium">{stage.action.label}</p>
                    {stage.action.command ? (
                      <pre className="overflow-x-auto rounded-md bg-primary p-3 font-mono text-[0.68rem] leading-5 text-primary-foreground"><code>{stage.action.command}</code></pre>
                    ) : null}
                    {stage.action.href ? (
                      <a
                        className="w-fit text-xs font-semibold text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent"
                        href={stage.action.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open supported management flow ↗
                      </a>
                    ) : null}
                    {stage.action.humanRequired ? (
                      <p className="text-[0.68rem] leading-5 text-muted-foreground">
                        Human action required. In a headless environment, stop here and ask a workspace admin to complete provider consent.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-8 border-t border-foreground/15 pt-4">
        <p className="font-mono text-[0.61rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Source
        </p>
        <p className="mt-1.5 text-xs leading-5 text-foreground/75">{item.source}</p>
        {item.nextAction ? (
          <div className="mt-4 border-l-2 border-accent pl-3">
            <p className="font-mono text-[0.61rem] font-bold tracking-[0.08em] text-accent uppercase">
              Next action
            </p>
            <p className="mt-1 text-xs leading-5">{item.nextAction}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function overallTitle(overall: ReadinessReport["overall"]): string {
  if (overall === "ready") return "Ready to work.";
  if (overall === "blocked") return "A known requirement is blocking work.";
  return "Some paths still need proof.";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}
