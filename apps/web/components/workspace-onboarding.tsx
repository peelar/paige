"use client";

import type {
  WorkspaceOnboardingDraft,
  WorkspaceOnboardingInput,
  WorkspaceOnboardingValidation,
} from "@docs-agent/control-plane";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WorkspaceOnboarding({
  initialDraft,
  initialLoadError,
}: {
  initialDraft: WorkspaceOnboardingDraft;
  initialLoadError: string | null;
}) {
  const router = useRouter();
  const existingWatched = useMemo(
    () => new Map(
      initialDraft.watchedRepositories.map((repository) => [
        normalizeUrl(repository.repositoryUrl),
        repository,
      ]),
    ),
    [initialDraft.watchedRepositories],
  );
  const existingContext = useMemo(
    () => new Map(
      initialDraft.contextRepositories.map((repository) => [
        normalizeUrl(repository.repositoryUrl),
        repository,
      ]),
    ),
    [initialDraft.contextRepositories],
  );
  const [repositoryUrl, setRepositoryUrl] = useState(initialDraft.repositoryUrl);
  const [ref, setRef] = useState(initialDraft.ref);
  const [docsRoot, setDocsRoot] = useState(initialDraft.docsRoot ?? "");
  const [githubConnector, setGitHubConnector] = useState(
    initialDraft.githubConnector ?? "",
  );
  const [watchedRepositoryUrls, setWatchedRepositoryUrls] = useState(
    initialDraft.watchedRepositories.map(({ repositoryUrl: url }) => url).join("\n"),
  );
  const [contextRepositoryUrls, setContextRepositoryUrls] = useState(
    initialDraft.contextRepositories.map(({ repositoryUrl: url }) => url).join("\n"),
  );
  const [validation, setValidation] = useState<WorkspaceOnboardingValidation>();
  const [pending, setPending] = useState<"validate" | "save">();
  const [message, setMessage] = useState<string | null>(initialLoadError);
  const [saved, setSaved] = useState(false);

  function changed() {
    setValidation(undefined);
    setMessage(null);
    setSaved(false);
  }

  function payload(): WorkspaceOnboardingInput {
    const watchedRepositories = watchedRepositoryUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => existingWatched.get(normalizeUrl(url)) ?? {
        repositoryUrl: url,
        importance: "medium" as const,
        defaultRef: "main",
        pathFilters: [],
        signals: ["releases" as const],
      });
    const contextRepositories = contextRepositoryUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => existingContext.get(normalizeUrl(url)) ?? {
        repositoryUrl: url,
        ref: "main",
        pathFilters: [],
        evidenceClass: "source-code-or-merged-change" as const,
        canSupportPublicDocsClaim: true,
      });
    return {
      repositoryUrl,
      ref: ref.trim() || "main",
      docsRoot: docsRoot.trim() || undefined,
      githubConnector: githubConnector.trim() || undefined,
      watchedRepositories,
      contextRepositories,
    };
  }

  async function validate() {
    setPending("validate");
    setMessage(null);
    setSaved(false);
    try {
      const response = await fetch("/api/operator/workspace-setup/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const body = await response.json() as {
        error?: string;
        validation?: WorkspaceOnboardingValidation;
      };
      if (!response.ok || body.validation === undefined) {
        setValidation(undefined);
        setMessage(body.error ?? "Workspace validation failed.");
        return;
      }
      setValidation(body.validation);
      setMessage(
        body.validation.readyForPersistence
          ? "All checks passed. Review the result, then save this workspace setup."
          : "Nothing was saved. Resolve the blocked checks and validate again.",
      );
    } catch {
      setValidation(undefined);
      setMessage("Workspace validation could not reach the server.");
    } finally {
      setPending(undefined);
    }
  }

  async function save() {
    if (validation?.readyForPersistence !== true) {
      setMessage("Validate the current setup before saving it.");
      return;
    }
    const validatedInput = validation.input;
    setPending("save");
    setMessage(null);
    try {
      const response = await fetch("/api/operator/workspace-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validatedInput),
      });
      const body = await response.json() as {
        error?: string;
        validation?: WorkspaceOnboardingValidation;
      };
      if (!response.ok) {
        setValidation(body.validation);
        setMessage(body.error ?? "Workspace setup could not be saved.");
        return;
      }
      setValidation(body.validation);
      setSaved(true);
      setMessage("Workspace setup saved with your operator identity. Refreshing readiness…");
      router.refresh();
    } catch {
      setMessage("Workspace setup could not reach the server and was not saved.");
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section
      aria-labelledby="workspace-onboarding-title"
      className="overflow-hidden rounded-xl border border-foreground/25 bg-card shadow-[0_24px_70px_rgba(24,51,44,0.08)]"
      data-workspace-onboarding
    >
      <div className="grid gap-8 bg-primary px-[clamp(1.5rem,4vw,3.5rem)] py-[clamp(1.8rem,5vw,4rem)] text-primary-foreground lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div>
          <p className="font-mono text-[0.66rem] font-bold tracking-[0.12em] text-primary-foreground/60 uppercase">
            Workspace onboarding / controlled mutation
          </p>
          <h2
            className="mt-4 max-w-[14ch] font-heading text-[clamp(2.7rem,6vw,5.4rem)] leading-[0.9] font-medium tracking-[-0.055em]"
            id="workspace-onboarding-title"
          >
            Point Paige at the right truth.
          </h2>
        </div>
        <p className="border-t border-primary-foreground/20 pt-5 text-sm leading-6 text-primary-foreground/70 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          Validate repository access, the requested ref, an optional docs root,
          and GitHub writeback before anything is persisted.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
        <form
          className="grid gap-7 p-[clamp(1.5rem,4vw,3.5rem)]"
          onSubmit={(event) => {
            event.preventDefault();
            void validate();
          }}
        >
          <Field
            help="Required. Use the GitHub repository that Paige is allowed to patch and publish to."
            label="Working documentation repository"
          >
            <input
              autoComplete="url"
              className={inputClassName}
              name="repositoryUrl"
              onChange={(event) => {
                setRepositoryUrl(event.target.value);
                changed();
              }}
              placeholder="https://github.com/owner/docs"
              required
              type="url"
              value={repositoryUrl}
            />
          </Field>

          <div className="grid gap-6 md:grid-cols-2">
            <Field help="Defaults to main when left empty." label="Ref">
              <input
                className={inputClassName}
                name="ref"
                onChange={(event) => {
                  setRef(event.target.value);
                  changed();
                }}
                placeholder="main"
                value={ref}
              />
            </Field>
            <Field
              help="Optional. Leave empty so Paige can infer it after checkout."
              label="Docs root"
            >
              <input
                className={inputClassName}
                name="docsRoot"
                onChange={(event) => {
                  setDocsRoot(event.target.value);
                  changed();
                }}
                placeholder="docs or ."
                value={docsRoot}
              />
            </Field>
          </div>

          <Field
            help="Uses the existing repository-targeted Vercel Connect preflight. Provider installation remains a separate human step."
            label="GitHub writeback connector"
          >
            <input
              className={inputClassName}
              name="githubConnector"
              onChange={(event) => {
                setGitHubConnector(event.target.value);
                changed();
              }}
              placeholder="github/docs-agent"
              value={githubConnector}
            />
          </Field>

          <Field
            help="Optional, one GitHub URL per line. These sources are always rebuilt with sandbox-read access and read-only actions."
            label="Watched repositories"
          >
            <textarea
              className={cn(inputClassName, "min-h-32 resize-y py-3")}
              name="watchedRepositories"
              onChange={(event) => {
                setWatchedRepositoryUrls(event.target.value);
                changed();
              }}
              placeholder={"https://github.com/owner/product\nhttps://github.com/owner/sdk"}
              value={watchedRepositoryUrls}
            />
          </Field>

          <Field
            help="Optional, one GitHub URL per line. Context sources keep stable provenance and can never receive patches or writeback."
            label="Context repositories"
          >
            <textarea
              className={cn(inputClassName, "min-h-32 resize-y py-3")}
              name="contextRepositories"
              onChange={(event) => {
                setContextRepositoryUrls(event.target.value);
                changed();
              }}
              placeholder={"https://github.com/owner/architecture\nhttps://github.com/owner/decisions"}
              value={contextRepositoryUrls}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 border-t border-foreground/15 pt-6">
            <Button disabled={pending !== undefined} type="submit">
              {pending === "validate" ? "Validating…" : "Validate setup"}
            </Button>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              Validation is read-only. Save appears only after every required check passes.
            </p>
          </div>
        </form>

        <aside className="border-t border-foreground/20 bg-muted/45 p-[clamp(1.5rem,4vw,3rem)] lg:border-t-0 lg:border-l">
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.11em] text-muted-foreground uppercase">
            Preflight ledger
          </p>
          {validation === undefined ? (
            <div className="mt-8 border-l-2 border-foreground/20 pl-4">
              <p className="font-heading text-2xl font-medium">No current result.</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Change a field, validate, and read the repository and permission checks here before saving.
              </p>
            </div>
          ) : (
            <ol className="mt-7 grid gap-3">
              {validation.checks.map((check, index) => (
                <li
                  className={cn(
                    "rounded-lg border p-4",
                    check.status === "passed"
                      ? "border-[#718251]/35 bg-[#dce4c8] text-[#2f482f]"
                      : "border-destructive/30 bg-[#f0d1c8] text-[#762c22]",
                  )}
                  data-onboarding-check={check.id}
                  data-onboarding-status={check.status}
                  key={check.id}
                >
                  <p className="font-mono text-[0.6rem] font-bold tracking-[0.1em] uppercase">
                    {String(index + 1).padStart(2, "0")} / {check.status}
                  </p>
                  <p className="mt-2 text-sm leading-5">{check.message}</p>
                </li>
              ))}
            </ol>
          )}

          <div aria-live="polite" className="mt-6 min-h-14 text-sm leading-6">
            {message ? <p>{message}</p> : null}
          </div>

          {validation?.readyForPersistence ? (
            <Button
              className="mt-3 w-full"
              disabled={pending !== undefined || saved}
              onClick={() => void save()}
              type="button"
              variant="outline"
            >
              {pending === "save" ? "Saving…" : saved ? "Setup saved" : "Save validated setup"}
            </Button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function Field({
  children,
  help,
  label,
}: {
  children: React.ReactNode;
  help: string;
  label: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="font-heading text-lg font-semibold">{label}</span>
      {children}
      <span className="text-xs leading-5 text-muted-foreground">{help}</span>
    </label>
  );
}

const inputClassName =
  "h-12 w-full rounded-md border border-foreground/25 bg-background px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/65 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20";

function normalizeUrl(value: string): string {
  return value.trim().replace(/\.git$/u, "").replace(/\/$/u, "").toLowerCase();
}
