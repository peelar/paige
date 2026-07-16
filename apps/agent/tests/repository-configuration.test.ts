import assert from "node:assert/strict";

import { createClient } from "@libsql/client";
import type { ToolContext } from "eve/tools";
import { describe, test } from "vitest";

import {
  normalizeGitHubRepository,
  normalizeRepositoryConfiguration,
} from "../repositories/configuration/normalize";
import {
  deferRepositoryConfiguration,
  proposeRepositoryConfiguration,
  stateForWorkspace,
} from "../repositories/configuration/draft";
import {
  LibsqlRepositoryConfigurationStore,
} from "../repositories/configuration/store";
import {
  resolveRepositoryCatalog,
} from "../repositories/configuration/resolver";

describe("repository configuration normalization", () => {
  test("normalizes GitHub URLs and removes duplicate evidence repositories", () => {
    const result = normalizeRepositoryConfiguration({
      documentationRepositoryUrl:
        "https://github.com/Example/Documentation.git/",
      evidenceRepositoryUrls: [
        "https://github.com/Example/Product",
        "https://github.com/example/product.git",
        "https://github.com/Example/Documentation",
      ],
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      documentationRepository: {
        id: "example--documentation",
        owner: "example",
        name: "documentation",
        role: "documentation",
      },
      evidenceRepositories: [
        {
          id: "example--product",
          owner: "example",
          name: "product",
          role: "evidence",
        },
      ],
    });
  });

  test("accepts no evidence repositories", () => {
    const result = normalizeRepositoryConfiguration({
      documentationRepositoryUrl: "https://github.com/example/docs",
    });

    assert(result.isOk());
    assert.deepEqual(result.value.evidenceRepositories, []);
  });

  test("rejects non-GitHub and non-repository URLs", () => {
    for (
      const value of [
        "https://gitlab.com/example/docs",
        "http://github.com/example/docs",
        "https://github.com/example",
        "https://github.com/example/docs/issues",
        "git@github.com:example/docs.git",
      ]
    ) {
      const result = normalizeGitHubRepository(value, "documentation");
      assert(result.isErr(), value);
      assert.equal(result.error.code, "REPOSITORY_INVALID_INPUT");
      assert.match(result.error.message, /GitHub repository URL/);
    }
  });
});

describe("repository configuration store", () => {
  test("isolates Slack workspaces and returns missing setup explicitly", async () => {
    const store = createStore();
    const missing = await store.get("T-missing");
    assert(missing.isOk());
    assert.equal(missing.value, undefined);

    const saved = await store.save({
      workspaceId: "T-one",
      configuration: configuration("one"),
      expectedRevision: null,
    });
    assert(saved.isOk());

    const otherWorkspace = await store.get("T-two");
    assert(otherWorkspace.isOk());
    assert.equal(otherWorkspace.value, undefined);

    const firstWorkspace = await store.get("T-one");
    assert(firstWorkspace.isOk());
    assert.equal(
      firstWorkspace.value?.documentationRepository.name,
      "docs-one",
    );
  });

  test("activates a setup only when save is called", async () => {
    const store = createStore();
    const proposed = configuration("proposed");

    const beforeConfirmation = await store.get("T-team");
    assert(beforeConfirmation.isOk());
    assert.equal(beforeConfirmation.value, undefined);

    const confirmed = await store.save({
      workspaceId: "T-team",
      configuration: proposed,
      expectedRevision: null,
    });
    assert(confirmed.isOk());
    assert.equal(confirmed.value.revision, 1);
  });

  test("rejects concurrent first setup attempts", async () => {
    const store = createStore();
    const [first, second] = await Promise.all([
      store.save({
        workspaceId: "T-team",
        configuration: configuration("first"),
        expectedRevision: null,
      }),
      store.save({
        workspaceId: "T-team",
        configuration: configuration("second"),
        expectedRevision: null,
      }),
    ]);

    assert.equal([first, second].filter((result) => result.isOk()).length, 1);
    const conflict = [first, second].find((result) => result.isErr());
    assert(conflict?.isErr());
    assert.equal(conflict.error.code, "REPOSITORY_CONFLICT");
  });

  test("uses revisions to reject stale repository changes", async () => {
    const store = createStore();
    const initial = await store.save({
      workspaceId: "T-team",
      configuration: configuration("initial"),
      expectedRevision: null,
    });
    assert(initial.isOk());

    const updated = await store.save({
      workspaceId: "T-team",
      configuration: configuration("updated"),
      expectedRevision: initial.value.revision,
    });
    assert(updated.isOk());
    assert.equal(updated.value.revision, 2);

    const stale = await store.save({
      workspaceId: "T-team",
      configuration: configuration("stale"),
      expectedRevision: initial.value.revision,
    });
    assert(stale.isErr());
    assert.equal(stale.error.code, "REPOSITORY_CONFLICT");
  });
});

describe("conversation-scoped repository setup", () => {
  test("records deferral without carrying it into another Slack workspace", () => {
    const deferred = deferRepositoryConfiguration("T-one");
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.proposal, undefined);

    assert.deepEqual(stateForWorkspace(deferred, "T-two"), {
      workspaceId: "T-two",
      deferred: false,
    });
  });

  test("replaces the complete proposal when the user makes a correction", () => {
    const first = proposeRepositoryConfiguration(
      "T-team",
      null,
      configuration("first"),
    );
    const corrected = proposeRepositoryConfiguration(
      "T-team",
      first.proposal?.baseRevision ?? null,
      configuration("corrected"),
    );

    assert.equal(
      corrected.proposal?.configuration.documentationRepository.name,
      "docs-corrected",
    );
    assert.equal(corrected.deferred, false);
  });
});

describe("active repository resolution", () => {
  test("keeps missing configuration explicit", async () => {
    const result = await resolveRepositoryCatalog(
      slackContext("T-missing", "U-one"),
      createStore(),
    );

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_NOT_CONFIGURED");
  });

  test("shares the active setup with teammates in the same Slack workspace", async () => {
    const store = createStore();
    const saved = await store.save({
      workspaceId: "T-team",
      configuration: configuration("shared"),
      expectedRevision: null,
    });
    assert(saved.isOk());

    const firstTeammate = await resolveRepositoryCatalog(
      slackContext("T-team", "U-one"),
      store,
    );
    const secondTeammate = await resolveRepositoryCatalog(
      slackContext("T-team", "U-two"),
      store,
    );

    assert(firstTeammate.isOk());
    assert(secondTeammate.isOk());
    assert.deepEqual(secondTeammate.value, firstTeammate.value);
    assert.deepEqual(
      secondTeammate.value.map((repository) => repository.name),
      ["product-shared", "docs-shared"],
    );
  });
});

function createStore(): LibsqlRepositoryConfigurationStore {
  return new LibsqlRepositoryConfigurationStore(
    createClient({ url: ":memory:" }),
  );
}

function configuration(suffix: string) {
  const result = normalizeRepositoryConfiguration({
    documentationRepositoryUrl:
      `https://github.com/example/docs-${suffix}`,
    evidenceRepositoryUrls: [
      `https://github.com/example/product-${suffix}`,
    ],
  });
  assert(result.isOk());
  return result.value;
}

function slackContext(
  workspaceId: string,
  userId: string,
): ToolContext {
  return {
    session: {
      auth: {
        current: {
          authenticator: "slack",
          principalType: "user",
          principalId: userId,
          attributes: { slackWorkspaceId: workspaceId },
        },
        initiator: null,
      },
    },
  } as unknown as ToolContext;
}
