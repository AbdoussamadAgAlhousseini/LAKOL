import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { SchoolContext } from "@/server/context";
import { canAll } from "@/server/rbac/policies";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "dashboard", path: "", perm: "finance.read" },
  { key: "accounts", path: "/accounts", perm: "finance.read" },
  { key: "unpaid", path: "/unpaid", perm: "finance.read" },
  { key: "cash", path: "/cash", perm: "finance.read" },
  { key: "expenses", path: "/expenses", perm: "finance.read" },
  { key: "fees", path: "/fees", perm: "fee.manage" },
  { key: "payroll", path: "/payroll", perm: "payroll.manage" },
] as const;

/** Onglets du module finances, selon les droits. */
export async function FinanceNav({
  ctx,
  school,
  active,
}: {
  ctx: SchoolContext;
  school: string;
  active: (typeof TABS)[number]["key"];
}) {
  const t = await getTranslations("finance.tabs");
  return (
    <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label={t("label")}>
      {TABS.filter((tab) => canAll(ctx.scope, tab.perm)).map((tab) => (
        <Link
          key={tab.key}
          href={`/${school}/finance${tab.path}`}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full border px-4 py-2 text-sm",
            tab.key === active && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
