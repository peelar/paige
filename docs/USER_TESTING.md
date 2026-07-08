# User Testing

The first user tests validate the sandboxed GitHub working-repository loop with
one public docs repository:

```text
https://github.com/peelar/saleor-docs.git
```

The canonical fixtures live in
`evals/scenarios/saleor-docs-user-test-scenarios.ts`. Copy-paste prompt files
for manual `/goal` runs live in `evals/scenarios/manual/`. Each fixture contains
the user prompt, working documentation repository input, attached issue/thread
context, expected outcome, expected touched files, forbidden touched files, and
checks.

## Scenarios

### Correct: Private Metadata Filtering

The user prompt suggests that Saleor now supports filtering by private metadata.
The attached issue, discussion, and release note confirm a public API behavior
change for authenticated staff users and apps with permission to access private
metadata.

Expected result:

- Clone or materialize `peelar/saleor-docs` into `/workspace/working-docs`.
- Inspect `docs/api-usage/metadata.mdx`.
- Update only the existing "Filtering by metadata" section.
- Mention that public metadata filtering remains unchanged.
- Mention that private metadata filtering is permission-bound.
- Leave generated API reference files untouched.
- Run dependency install and docs checks in the sandbox before exporting a diff.

### Incorrect: Sandbox Rate Limit False Alarm

The user prompt lightly suggests that Saleor Cloud sandbox rate limits changed
from 120 to 180 requests per minute. The attached issue and discussion say the
180 rpm value was internal-only and customer-facing sandbox limits remain 120
requests per minute.

Expected result:

- Clone or materialize `peelar/saleor-docs` into `/workspace/working-docs`.
- Inspect `docs/api-usage/usage-limits.mdx`.
- Report that the current docs already say 120 requests/minute.
- Produce no patch and no diff.
- Do not push or open a draft PR.

## Manual `/goal` Loop

Use the scenario's rendered prompt as the `/goal` objective. The prompt sent to
the agent under test should include only:

- the user prompt;
- the working documentation repository URL, ref, docs root, sandbox path, and
  allowed actions;
- the attached context.

Do not include the expected outcome in the agent-under-test prompt. Use the
expected outcome only as the human review guide after the run completes.

Manual prompt files:

- `evals/scenarios/manual/saleor-docs-private-metadata-filtering.goal.md`
- `evals/scenarios/manual/saleor-docs-sandbox-rate-limit-false-alarm.goal.md`

For a passing run, the transcript should show:

- `configure_working_repository` called before docs maintenance starts;
- repository work happening inside `/workspace/working-docs`;
- an impact report before any patch;
- evidence citations back to attached context and inspected docs pages;
- either a minimal diff for the correct scenario or an explicit no-change
  decision for the false alarm;
- check results or a visible check failure;
- no writeback without explicit approval.

## Eve Evals

`evals/saleor-docs-user-tests.eval.ts` registers both scenarios with hard
assertions for the live agent behavior and repository workflow.

```sh
pnpm eval saleor-docs-user-tests --skip-report --verbose
```

That command validates:

- configure the working repository before running docs maintenance;
- clone or materialize the GitHub working repository;
- the model chooses the authored repository workflow tool;
- enforce repository allowed actions;
- inspect and patch files inside the sandbox;
- run checks inside the sandbox;
- export diffs;
- keep raw Eve sandbox/file tools disabled for the workflow.

By default, evals use the Vercel AI Gateway model configured in
`EVE_GATEWAY_MODEL`, or `zai/glm-5.2` when unset. To test another Gateway model,
set `EVE_GATEWAY_MODEL` to any model id available in the Vercel AI Gateway
catalog:

```sh
EVE_GATEWAY_MODEL=anthropic/claude-sonnet-5 \
pnpm eval saleor-docs-user-tests --skip-report --verbose
```

List the scenarios with:

```sh
pnpm eval --list
```
