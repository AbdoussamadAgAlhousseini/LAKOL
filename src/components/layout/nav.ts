import type { Permission } from "@/server/rbac/permissions";
import type { AccessScope } from "@/server/rbac/policies";

export interface NavItem {
  key: string; // clé i18n dans "nav"
  segment: string; // chemin sous /[locale]/[school]/
  /** Visible si l'utilisateur possède exactement l'une de ces permissions. */
  anyOf: Permission[];
  /** Phase de livraison du module (affichée tant qu'il n'est pas prêt). */
  phase: number;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", segment: "dashboard", anyOf: [], phase: 1 },
  { key: "students", segment: "students", anyOf: ["student.read"], phase: 2 },
  // « lesson.write:own » identifie les professeurs : ils voient leurs classes.
  { key: "classes", segment: "classes", anyOf: ["student.read", "lesson.write:own"], phase: 2 },
  { key: "staff", segment: "staff", anyOf: ["staff.read"], phase: 2 },
  { key: "structure", segment: "structure", anyOf: ["school.structure.manage"], phase: 2 },
  { key: "timetable", segment: "timetable", anyOf: ["timetable.read"], phase: 3 },
  { key: "homework", segment: "homework", anyOf: ["homework.read", "homework.read:own"], phase: 3 },
  { key: "attendance", segment: "attendance", anyOf: ["attendance.read", "attendance.read:own"], phase: 3 },
  { key: "discipline", segment: "discipline", anyOf: ["discipline.read"], phase: 3 },
  { key: "grades", segment: "grades", anyOf: ["grade.read", "grade.read:own"], phase: 4 },
  {
    key: "reportCards",
    segment: "report-cards",
    anyOf: ["reportcard.publish", "grade.read", "grade.read:own"],
    phase: 4,
  },
  { key: "finance", segment: "finance", anyOf: ["finance.read", "finance.read:own"], phase: 5 },
  { key: "messages", segment: "messages", anyOf: ["message.send"], phase: 6 },
  { key: "announcements", segment: "announcements", anyOf: ["announcement.publish"], phase: 6 },
  { key: "resources", segment: "resources", anyOf: ["resource.read"], phase: 8 },
  { key: "audit", segment: "audit", anyOf: ["audit.read"], phase: 2 },
  { key: "settings", segment: "settings", anyOf: ["school.settings.manage"], phase: 2 },
];

export function visibleNav(scope: AccessScope): NavItem[] {
  return NAV_ITEMS.filter((item) => item.anyOf.length === 0 || item.anyOf.some((p) => scope.permissions.has(p)));
}
