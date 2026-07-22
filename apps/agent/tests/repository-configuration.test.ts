import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import {
  normalizeGitHubRepository,
  normalizeRepositoryConfiguration,
} from "@paige/repositories/configuration/normalize";
import {
  deferRepositoryConfiguration,
  proposeRepositoryConfiguration,
} from "../repositories/configuration/draft";
import {
  resolveRepositoryConfigurationStore,
} from "@paige/repositories/configuration/database";
import {
  LibsqlRepositoryConfigurationStore,
} from "@paige/repositories/configuration/store";
import {
  resolveRepositoryCatalog,
} from "@paige/repositories/configuration/resolver";
import { RepositoryConfigurationService } from "@paige/repositories/configuration/service";
import { migrateTestDatabase } from "./database";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository configuration database", () => {
  test("returns a typed error when storage is not configured", () => {
    const previousUrl = process.env.PAIGE_DATABASE_URL;
    delete process.env.PAIGE_DATABASE_URL;

    try {
      const result = resolveRepositoryConfigurationStore();

      assert(result.isErr());
      assert.equal(result.error.code, "REPOSITORY_CONFIGURATION_FAILED");
      assert.equal(
        result.error.message,
        "Repository setup storage is not configured.",
      );
    } finally {
      if (previousUrl === undefined) {
        delete process.env.PAIGE_DATABASE_URL;
      } else {
        process.env.PAIGE_DATABASE_URL = previousUrl;
      }
    }
  });
});

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

describe("repository configuration access validation", () => {
  test("connects public evidence without requesting an installation token", async () => {
    const tokenRequests: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      const headers = init?.headers as Record<string, string>;
      if (url.includes("/repos/example/docs")) {
        assert.equal(headers.authorization, "Bearer docs-token");
        return url.endsWith("/repos/example/docs")
          ? jsonResponse({ default_branch: "main", private: true })
          : jsonResponse({ sha: "docs-commit" });
      }
      assert.match(url, /\/repos\/saleor\/saleor/);
      assert.equal(headers.authorization, undefined);
      return url.endsWith("/repos/saleor/saleor")
        ? jsonResponse({ default_branch: "main", private: false })
        : jsonResponse({ sha: "saleor-commit" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new RepositoryConfigurationService(
      { abortSignal: new AbortController().signal },
      await createStore(),
      {
        getGitHubToken: (repository) => {
          tokenRequests.push(`${repository.owner}/${repository.name}`);
          return ResultAsync.fromSafePromise(Promise.resolve("docs-token"));
        },
      },
    );

    const result = await service.propose({
      documentationRepositoryUrl: "https://github.com/example/docs",
      evidenceRepositoryUrls: ["https://github.com/saleor/saleor"],
    });

    assert(result.isOk());
    assert.equal(result.value.documentationRepository.access, "installation");
    assert.equal(result.value.evidenceRepositories[0].access, "public");
    assert.deepEqual(tokenRequests, ["example/docs"]);
  });

  test("does not present a public GitHub rate limit as missing access", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      if (url.includes("/repos/example/docs")) {
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.authorization, "Bearer docs-token");
        return url.endsWith("/repos/example/docs")
          ? jsonResponse({ default_branch: "main", private: true })
          : jsonResponse({ sha: "docs-commit" });
      }
      return new Response(null, {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "2000000000",
        },
      });
    }));
    const service = new RepositoryConfigurationService(
      { abortSignal: new AbortController().signal },
      await createStore(),
      {
        getGitHubToken: () =>
          ResultAsync.fromSafePromise(Promise.resolve("docs-token")),
      },
    );

    const result = await service.propose({
      documentationRepositoryUrl: "https://github.com/example/docs",
      evidenceRepositoryUrls: ["https://github.com/saleor/saleor"],
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_GITHUB_RATE_LIMITED");
    assert.match(result.error.message, /Try again after/);
    assert.doesNotMatch(result.error.message, /couldn't access/);
  });
});

describe("repository configuration store", () => {
  test("requires the database migration before reading setup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paige-unmigrated-"));
    const client = createClient({ url: `file:${join(directory, "state.db")}` });
    const store = new LibsqlRepositoryConfigurationStore(client);

    try {
      const result = await store.get();

      assert(result.isErr());
      assert.equal(result.error.code, "REPOSITORY_CONFIGURATION_FAILED");
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("stores one repository setup for the agent", async () => {
    const store = await createStore();
    const missing = await store.get();
    assert(missing.isOk());
    assert.equal(missing.value, undefined);

    const saved = await store.save({
      configuration: configuration("one"),
      expectedRevision: null,
    });
    assert(saved.isOk());

    const active = await store.get();
    assert(active.isOk());
    assert.equal(
      active.value?.documentationRepository.name,
      "docs-one",
    );
  });

  test("activates a setup only when save is called", async () => {
    const store = await createStore();
    const proposed = configuration("proposed");

    const beforeConfirmation = await store.get();
    assert(beforeConfirmation.isOk());
    assert.equal(beforeConfirmation.value, undefined);

    const confirmed = await store.save({
      configuration: proposed,
      expectedRevision: null,
    });
    assert(confirmed.isOk());
    assert.equal(confirmed.value.revision, 1);
  });

  test("rejects concurrent first setup attempts", async () => {
    const store = await createStore();
    const [first, second] = await Promise.all([
      store.save({
        configuration: configuration("first"),
        expectedRevision: null,
      }),
      store.save({
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
    const store = await createStore();
    const initial = await store.save({
      configuration: configuration("initial"),
      expectedRevision: null,
    });
    assert(initial.isOk());

    const updated = await store.save({
      configuration: configuration("updated"),
      expectedRevision: initial.value.revision,
    });
    assert(updated.isOk());
    assert.equal(updated.value.revision, 2);

    const stale = await store.save({
      configuration: configuration("stale"),
      expectedRevision: initial.value.revision,
    });
    assert(stale.isErr());
    assert.equal(stale.error.code, "REPOSITORY_CONFLICT");
  });
});

describe("conversation-scoped repository setup", () => {
  test("records deferral in the current conversation", () => {
    const deferred = deferRepositoryConfiguration();
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.proposal, undefined);
  });

  test("replaces the complete proposal when the user makes a correction", () => {
    const first = proposeRepositoryConfiguration(
      null,
      configuration("first"),
    );
    const corrected = proposeRepositoryConfiguration(
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
      await createStore(),
    );

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_NOT_CONFIGURED");
  });

  test("shares the active setup across channel identities", async () => {
    const store = await createStore();
    const saved = await store.save({
      configuration: configuration("shared"),
      expectedRevision: null,
    });
    assert(saved.isOk());

    const firstChannel = await resolveRepositoryCatalog(store);
    const secondChannel = await resolveRepositoryCatalog(store);

    assert(firstChannel.isOk());
    assert(secondChannel.isOk());
    assert.deepEqual(secondChannel.value, firstChannel.value);
    assert.deepEqual(
      secondChannel.value.map((repository) => repository.name),
      ["product-shared", "docs-shared"],
    );
  });
});

async function createStore(): Promise<LibsqlRepositoryConfigurationStore> {
  const client = createClient({ url: ":memory:" });
  await migrateTestDatabase(client);
  return new LibsqlRepositoryConfigurationStore(
    client,
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
