"use client";

import { Building2, FileText, LayoutDashboard, Layers } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/schools", key: "schools", icon: Building2 },
  { href: "/admin/plans", key: "plans", icon: Layers },
  { href: "/admin/invoices", key: "invoices", icon: FileText },
] as const;

export function AdminNav({ labels }: { labels: Record<(typeof ITEMS)[number]["key"], string> }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Plateforme">
      {ITEMS.map((item) => {
        const active = "exact" in item ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hover:bg-accent flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium",
              active && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Icon className="size-4" aria-hidden /> {labels[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
