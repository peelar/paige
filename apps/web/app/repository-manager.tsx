"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  GitBranchIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface RepositoryState {
  configured: boolean;
  repository?: string;
  updatedAt?: string;
}

export function RepositoryManager() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repository, setRepository] = useState<RepositoryState | null>(null);
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [message, setMessage] = useState("Checking the current connection…");

  useEffect(() => {
    let active = true;

    void fetch("/api/repository", { cache: "no-store" })
      .then(async (response) => {
        const payload = await readResponse(response);
        if (!response.ok) throw new Error(payload.error);
        if (!active) return;

        setRepository(payload);
        setStatus("idle");
        setMessage(
          payload.configured
            ? "Paige can read, edit, and prepare documentation changes here."
            : "Connect the documentation repository Paige should maintain.",
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus("error");
        setMessage(errorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("Checking access and connecting the repository…");

    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryUrl }),
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error);

      setRepository(payload);
      setRepositoryUrl("");
      setStatus("saved");
      setMessage("Repository connected. Paige will use it on the next request.");
    } catch (error) {
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }

  const isBusy = status === "loading" || status === "saving";
  const buttonLabel = status === "saving"
    ? "Connecting…"
    : repository?.configured
    ? "Change repository"
    : "Connect repository";

  return (
    <section className="min-h-svh bg-[#fafafa]" aria-labelledby="repository-title">
      <div className="border-b bg-background px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-sm font-medium">Repository</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configure the source Paige maintains.
            </p>
          </div>
          <span className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Local operator
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="max-w-2xl">
          <div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
            <GitBranchIcon className="size-5" />
          </div>
          <h1 id="repository-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Connect a GitHub repository
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Paste the repository Paige should maintain. Access is checked before
            this workspace configuration is updated.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-xl border bg-background shadow-xs">
          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">Documentation repository</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  One writable GitHub repository for documentation work.
                </p>
              </div>
              {repository?.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Connected
                </span>
              ) : null}
            </div>
          </div>

          {repository?.configured ? (
            <>
              <Separator />
              <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
                <div className="flex size-8 items-center justify-center rounded-md border bg-[#fafafa]">
                  <GitBranchIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{repository.repository}</p>
                  <p className="text-xs text-muted-foreground">Current repository</p>
                </div>
              </div>
            </>
          ) : null}

          <Separator />
          <form className="px-5 py-5 sm:px-6" onSubmit={submit}>
            <label className="text-sm font-medium" htmlFor="repository-url">
              GitHub URL
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                autoComplete="url"
                className="h-9 flex-1 bg-background"
                disabled={isBusy}
                id="repository-url"
                name="repositoryUrl"
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                required
                spellCheck={false}
                type="url"
                value={repositoryUrl}
              />
              <Button className="h-9 px-3" disabled={isBusy} type="submit">
                {status === "saving" ? (
                  <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                ) : null}
                <span>{buttonLabel}</span>
                {status !== "saving" ? (
                  <ArrowRightIcon data-icon="inline-end" />
                ) : null}
              </Button>
            </div>

            <div
              className={`mt-3 flex min-h-5 items-start gap-2 text-xs ${statusColor(status)}`}
              role="status"
            >
              <StatusIcon status={status} />
              <p className="leading-5">{message}</p>
            </div>
          </form>
        </div>

        <p className="mt-5 max-w-2xl text-xs leading-5 text-muted-foreground">
          Evidence repositories are preserved when this repository changes.
          Publishing remains a separate, explicit approval step.
        </p>
      </div>
    </section>
  );
}

async function readResponse(
  response: Response,
): Promise<RepositoryState & { error: string }> {
  return await response.json() as RepositoryState & { error: string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Repository setup failed.";
}

function statusColor(status: "loading" | "idle" | "saving" | "saved" | "error") {
  if (status === "error") return "text-destructive";
  if (status === "saved") return "text-emerald-700";
  return "text-muted-foreground";
}

function StatusIcon({
  status,
}: {
  status: "loading" | "idle" | "saving" | "saved" | "error";
}) {
  if (status === "error") return <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />;
  if (status === "saved") return <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />;
  if (status === "loading" || status === "saving") {
    return <LoaderCircleIcon className="mt-0.5 size-3.5 shrink-0 animate-spin" />;
  }
  return <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" />;
}
