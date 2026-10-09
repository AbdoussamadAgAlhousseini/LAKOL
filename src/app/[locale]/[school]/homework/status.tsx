import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

const VARIANTS = { TODO: "warning", DONE: "secondary", SUBMITTED: "success", GRADED: "success" } as const;

export function HomeworkStatus({ status }: { status: keyof typeof VARIANTS }) {
  const t = useTranslations("homework.status");
  return <Badge variant={VARIANTS[status]}>{t(status)}</Badge>;
}
