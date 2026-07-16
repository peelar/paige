import { ResultAsync } from "neverthrow";

import type { RepositoryResultAsync } from "./errors";

const sandboxQueues = new Map<string, Promise<void>>();

/**
 * Prevents repository operations that replace shared sandbox paths from
 * overlapping while preserving each caller's original Result or rejection.
 */
export function serializeSandbox<T>(
  key: string,
  task: () => RepositoryResultAsync<T>,
): RepositoryResultAsync<T> {
  const previous = sandboxQueues.get(key) ?? Promise.resolve();
  const execution = previous
    .catch(() => undefined)
    .then(async () => await task());
  const settled = execution.then(
    () => undefined,
    () => undefined,
  );
  sandboxQueues.set(key, settled);

  return new ResultAsync(
    execution.finally(() => {
      if (sandboxQueues.get(key) === settled) sandboxQueues.delete(key);
    }),
  );
}
