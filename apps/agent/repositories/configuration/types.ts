import type {
  DocumentationRepository,
  RepositoryConfig,
} from "../types";

export interface RepositoryConfigurationData {
  documentationRepository: DocumentationRepository;
  evidenceRepositories: RepositoryConfig[];
}

export interface ActiveRepositoryConfiguration
  extends RepositoryConfigurationData {
  workspaceId: string;
  revision: number;
  updatedAt: string;
}

export interface SaveRepositoryConfigurationInput {
  workspaceId: string;
  configuration: RepositoryConfigurationData;
  expectedRevision: number | null;
}
