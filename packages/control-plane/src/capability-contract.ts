import { z } from "zod";

export const capabilityFamilySchema = z.enum([
  "knowledge.read",
  "repository.read",
  "docs_work.manage",
  "draft.edit",
  "follow_up.schedule",
  "provider.deliver",
  "publication.publish",
]);

export type CapabilityFamily = z.infer<typeof capabilityFamilySchema>;
