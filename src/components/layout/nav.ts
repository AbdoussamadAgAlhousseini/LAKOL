import { can, type AccessScope } from "@/server/rbac/policies";

type Base = Parameters<typeof can>[1];

export interface NavItem {
  key: string; // clé i18n dans "nav"
  segment: string; // chemin sous /[locale]/[school]/
  /** Visible si l'utilisateur possède l'une de ces permissions. */
  anyOf: Base[];
  /** Phase de livraison du module (affichée tant qu'il n'est pas prêt). */
  phase: number;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", segment: "dashboard", anyOf: [], phase: 1 },
  { key: "students", segment: "students", anyOf: ["student.read"], phase: 2 },
  { key: "staff", segment: "staff", anyOf: ["staff.read"], phase: 2 },
  { key: "structure", segment: "structure", anyOf: ["school.structure.manage"], phase: 2 },
  { key: "timetable", segment: "timetable", anyOf: ["timetable.read"], phase: 3 },
  { key: "homework", segment: "homework", anyOf: ["homework.read"], phase: 3 },
  { key: "attendance", segment: "attendance", anyOf: ["attendance.read"], phase: 3 },
  { key: "discipline", segment: "discipline", anyOf: ["discipline.read"], phase: 3 },
  { key: "grades", segment: "grades", anyOf: ["grade.read"], phase: 4 },
  { key: "reportCards", segment: "report-cards", anyOf: ["reportcard.publish", "grade.read"], phase: 4 },
  { key: "finance", segment: "finance", anyOf: ["finance.read"], phase: 5 },
  { key: "messages", segment: "messages", anyOf: ["message.send"], phase: 6 },
  { key: "announcements", segment: "announcements", anyOf: ["announcement.publish"], phase: 6 },
  { key: "resources", segment: "resources", anyOf: ["resource.read"], phase: 8 },
  { key: "audit", segment: "audit", anyOf: ["audit.read"], phase: 2 },
  { key: "settings", segment: "settings", anyOf: ["school.settings.manage"], phase: 2 },
];

export function visibleNav(scope: AccessScope): NavItem[] {
  return NAV_ITEMS.filter((item) => item.anyOf.length === 0 || item.anyOf.some((p) => can(scope, p)));
}
