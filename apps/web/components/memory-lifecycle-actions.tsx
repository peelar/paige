"use client";

import type { OperatorMemoryDetail } from "@docs-agent/control-plane";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type MemoryAction = "promote" | "mark-stale" | "retire";

export function MemoryLifecycleActions({ memory }: { memory: OperatorMemoryDetail }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const actions = availableActions(memory.status);

  if (actions.length === 0) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        This memory is retired. Its text and provenance remain available for audit, but no further operator transition is offered.
      </p>
    );
  }

  function submit(action: MemoryAction) {
    setError(undefined);
    setMessage(undefined);
    if (reason.trim() === "") {
      setError("Add a reason before changing this memory.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/operator/memories/${encodeURIComponent(memory.id)}/lifecycle`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, reason }),
          },
        );
        const body = await response.json() as {
          error?: string;
          memory?: OperatorMemoryDetail;
        };
        if (!response.ok || body.memory === undefined) {
          setError(body.error ?? "The memory lifecycle change was rejected.");
          return;
        }
        setReason("");
        setMessage(`Memory is now ${body.memory.status}. Refreshing the audit record…`);
        router.refresh();
      } catch {
        setError("The memory lifecycle request could not reach the server.");
      }
    });
  }

  return (
    <div className="grid gap-4" data-memory-lifecycle-actions>
      <label className="grid gap-2 text-sm font-medium">
        Reason for this lifecycle decision
        <textarea
          className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
          maxLength={1_000}
          name="reason"
          onChange={(event) => setReason(event.target.value)}
          placeholder="What did the maintainer verify or what changed?"
          value={reason}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            disabled={pending}
            key={action}
            onClick={() => submit(action)}
            type="button"
            variant={action === "retire" ? "destructive" : action === "mark-stale" ? "outline" : "default"}
          >
            {pending ? "Saving…" : actionLabel(action)}
          </Button>
        ))}
      </div>
      {message ? <p className="text-sm leading-6 text-[#45613f]" role="status">{message}</p> : null}
      {error ? <p className="text-sm leading-6 text-destructive" role="alert">{error}</p> : null}
      <p className="text-xs leading-5 text-muted-foreground">
        Your authenticated operator id and reason are appended to lifecycle history. Memory text is never edited by this control.
      </p>
    </div>
  );
}

function availableActions(status: OperatorMemoryDetail["status"]): MemoryAction[] {
  if (status === "proposed") return ["promote"];
  if (status === "active") return ["mark-stale", "retire"];
  if (status === "stale") return ["retire"];
  return [];
}

function actionLabel(action: MemoryAction): string {
  if (action === "promote") return "Promote to active";
  if (action === "mark-stale") return "Mark stale";
  return "Retire memory";
}
