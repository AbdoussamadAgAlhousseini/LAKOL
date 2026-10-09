"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileText,
  GraduationCap,
  History,
  Home,
  Library,
  Megaphone,
  MessageCircle,
  NotebookPen,
  School,
  Settings,
  Shapes,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Les icônes ne traversent pas la frontière serveur/client : on les résout ici.
const ICONS: Record<string, LucideIcon> = {
  dashboard: Home,
  students: GraduationCap,
  classes: School,
  staff: Users,
  structure: Shapes,
  timetable: CalendarDays,
  homework: NotebookPen,
  attendance: ClipboardCheck,
  discipline: ShieldAlert,
  grades: BookOpen,
  reportCards: FileText,
  finance: Wallet,
  messages: MessageCircle,
  announcements: Megaphone,
  meetings: CalendarClock,
  resources: Library,
  audit: History,
  settings: Settings,
  subscription: CreditCard,
};

export function NavLinks({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? Home;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "hover:bg-accent flex h-12 items-center gap-3 rounded-md px-3 text-base font-medium",
                active && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
