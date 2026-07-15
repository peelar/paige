import { PageHeading } from "../../../../components/page-heading";
import { LoadingState } from "../../../../components/state-panel";

export default function SignalDetailLoading() { return <div className="grid gap-[clamp(2rem,6vw,5rem)]"><PageHeading index="04 / detail" title="Signal record" summary="The evidence, decisions, workflow history, and artifacts behind one durable docs signal." /><LoadingState /></div>; }
