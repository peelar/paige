"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

export function ReadinessRecheckButton() {
  const router = useRouter();
  const [rechecking, startRecheck] = useTransition();

  return (
    <Button
      disabled={rechecking}
      onClick={() => startRecheck(() => router.refresh())}
      type="button"
      variant="outline"
    >
      {rechecking ? "Rechecking…" : "Recheck installation"}
    </Button>
  );
}
