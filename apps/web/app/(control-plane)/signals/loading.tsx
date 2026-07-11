import { PageHeading } from "../../../components/page-heading";
import { LoadingState } from "../../../components/state-panel";

export default function SignalsLoading() {
  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="02"
        title="Signals"
        summary="The durable work queue for evidence, documentation impact, and the next careful action."
      />
      <LoadingState />
    </div>
  );
}
