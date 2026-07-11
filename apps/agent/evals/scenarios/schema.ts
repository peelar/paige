import { z } from "zod";

import { repositoryInputSchema } from "../../agent/lib/repository-contract.js";

export const userTestScenarioOutcomeSchema = z.enum(["docs-patch", "no-docs-change"]);

export const userTestCheckSchema = z.object({
  command: z.string().trim().min(1),
  required: z.boolean(),
  rationale: z.string().trim().min(1),
});

export const userTestScenarioSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1),
  repositoryInput: repositoryInputSchema,
  expected: z.object({
    outcome: userTestScenarioOutcomeSchema,
    impactReportMustInclude: z.array(z.string().trim().min(1)).nonempty(),
    expectedTouchedFiles: z.array(z.string().trim().min(1)),
    forbiddenTouchedFiles: z.array(z.string().trim().min(1)).default([]),
    expectedPatchHints: z.array(z.string().trim().min(1)).default([]),
    mustNotDo: z.array(z.string().trim().min(1)).nonempty(),
    checks: z.array(userTestCheckSchema).default([]),
  }),
});

export type UserTestScenario = z.infer<typeof userTestScenarioSchema>;
