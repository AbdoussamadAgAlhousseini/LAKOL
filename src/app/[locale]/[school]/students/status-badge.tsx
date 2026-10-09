import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  ACTIVE: "success",
  PRE_REGISTERED: "warning",
  TRANSFERRED: "secondary",
  DROPPED: "secondary",
  EXPELLED: "destructive",
  GRADUATED: "secondary",
} as const;

export function StatusBadge({ status }: { status: keyof typeof VARIANTS }) {
  const t = useTranslations("enums.studentStatus");
  return <Badge variant={VARIANTS[status]}>{t(status)}</Badge>;
}
