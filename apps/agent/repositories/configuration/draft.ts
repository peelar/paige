import { defineState } from "eve/context";

import type { RepositoryConfigurationData } from "./types";

interface RepositoryConfigurationProposal {
  baseRevision: number | null;
  configuration: RepositoryConfigurationData;
}

export interface RepositoryConfigurationSessionState {
  deferred: boolean;
  proposal?: RepositoryConfigurationProposal;
}

export const repositoryConfigurationSessionState =
  defineState<RepositoryConfigurationSessionState>(
    "paige.repository-configuration",
    () => ({ deferred: false }),
  );

export function proposeRepositoryConfiguration(
  baseRevision: number | null,
  configuration: RepositoryConfigurationData,
): RepositoryConfigurationSessionState {
  return {
    deferred: false,
    proposal: {
      baseRevision,
      configuration,
    },
  };
}

export function clearRepositoryConfigurationProposal():
  RepositoryConfigurationSessionState {
  return { deferred: false };
}

export function deferRepositoryConfiguration():
  RepositoryConfigurationSessionState {
  return { deferred: true };
}
