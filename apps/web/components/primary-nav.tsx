"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Brain, ChartNoAxesCombined, CircleGauge, Inbox, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

const navigation = [
  { href: "/status", label: "Status", icon: CircleGauge },
  { href: "/signals", label: "Signals", icon: Inbox },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/assurance", label: "Assurance", icon: ChartNoAxesCombined },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
] as const;

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav
      className="ml-auto flex gap-1 lg:mt-12 lg:ml-0 lg:grid"
      aria-label="Primary"
      data-shell-nav
    >
      <p className="mb-2 ml-3 hidden font-mono text-[0.64rem] font-bold tracking-[0.12em] text-muted-foreground uppercase lg:block">
        Workspace
      </p>
      {navigation.map((item) => {
        const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground",
              isCurrent && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            key={item.href}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
