import { defineState } from "eve/context";

import type { RepositoryConfigurationData } from "./types";

interface RepositoryConfigurationProposal {
  workspaceId: string;
  baseRevision: number | null;
  configuration: RepositoryConfigurationData;
}

export interface RepositoryConfigurationSessionState {
  workspaceId?: string;
  deferred: boolean;
  proposal?: RepositoryConfigurationProposal;
}

export const repositoryConfigurationSessionState =
  defineState<RepositoryConfigurationSessionState>(
    "paige.repository-configuration",
    () => ({ deferred: false }),
  );

export function stateForWorkspace(
  state: RepositoryConfigurationSessionState,
  workspaceId: string,
): RepositoryConfigurationSessionState {
  return state.workspaceId === workspaceId
    ? state
    : { workspaceId, deferred: false };
}

export function proposeRepositoryConfiguration(
  workspaceId: string,
  baseRevision: number | null,
  configuration: RepositoryConfigurationData,
): RepositoryConfigurationSessionState {
  return {
    workspaceId,
    deferred: false,
    proposal: {
      workspaceId,
      baseRevision,
      configuration,
    },
  };
}

export function clearRepositoryConfigurationProposal(
  workspaceId: string,
): RepositoryConfigurationSessionState {
  return { workspaceId, deferred: false };
}

export function deferRepositoryConfiguration(
  workspaceId: string,
): RepositoryConfigurationSessionState {
  return { workspaceId, deferred: true };
}
