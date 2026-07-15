import type { Metadata } from "next";

import { BehaviorSettingsDesk } from "@/components/behavior-settings-desk";
import { PageHeading } from "@/components/page-heading";
import { resolveBehaviorSettingsInitialState } from "@/lib/behavior-settings";

export const metadata: Metadata = { title: "Behavior settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  const initial = await resolveBehaviorSettingsInitialState(scenario);

  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="09"
        title="Behavior settings"
        summary="Tune how Paige sounds and where she participates without editing prompts, widening repository access, or weakening approval rules."
      />
      <BehaviorSettingsDesk initialError={initial.error} initialState={initial.state} />
    </div>
  );
}
