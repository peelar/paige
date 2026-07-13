import {
  DEFAULT_WORKSPACE_ID,
  resolveActiveWatchEventAdmissions,
  WATCH_CAPABILITY_REGISTRY_VERSION,
  type WatchCapabilityRegistry,
  type WatchEventAdmission,
} from "@docs-agent/control-plane/agent";

import type { SlackWatchEventScope } from "./subscription-filtered-slack-adapter";

export const PAIGE_WATCH_CAPABILITY_REGISTRY: WatchCapabilityRegistry = {
  version: WATCH_CAPABILITY_REGISTRY_VERSION,
  status: "ready",
  availableCapabilities: [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
  ],
};

/**
 * This resolver is installed only inside the verified Slack webhook adapter.
 * The provider identity therefore comes from a signature-checked request, not
 * from a model, browser, or independently accepted body field.
 */
export function resolveSlackWatchEventAdmissions(
  scope: SlackWatchEventScope,
): Promise<WatchEventAdmission[]> {
  return resolveActiveWatchEventAdmissions({
    workspaceId: DEFAULT_WORKSPACE_ID,
    providerWorkspaceId: scope.providerWorkspaceId,
    source: {
      provider: "slack",
      resource: scope.resource,
    },
    eventType: scope.eventType,
  }, {
    capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
    providerAuthorization: {
      provider: "slack",
      providerWorkspaceId: scope.providerWorkspaceId,
      verification: "verified-webhook",
    },
  });
}
