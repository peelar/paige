import { OperatorShell } from "@/components/operator-shell";
import { RepositoryManager } from "./repository-manager";

export default function Home() {
  return (
    <OperatorShell>
      <RepositoryManager />
    </OperatorShell>
  );
}
