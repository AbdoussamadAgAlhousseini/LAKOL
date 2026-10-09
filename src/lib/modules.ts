import type { ModuleKey } from "@prisma/client";

// Modules activables d'une école. Les domaines « école », « élèves »,
// « personnel » et « tableau de bord » font partie du socle, toujours actif.

export const MODULE_KEYS = [
  "HOMEWORK",
  "ATTENDANCE",
  "GRADES",
  "FINANCE",
  "MESSAGING",
  "TIMETABLE",
  "RESOURCES",
  "CANTEEN",
  "TRANSPORT",
  "LIBRARY",
  "INFIRMARY",
  "INVENTORY",
] as const satisfies readonly ModuleKey[];

/** Module de rattachement d'une permission (voir `PERMISSIONS[...].module`). */
const PERMISSION_DOMAIN_TO_MODULE: Record<string, ModuleKey | undefined> = {
  homework: "HOMEWORK",
  attendance: "ATTENDANCE",
  grades: "GRADES",
  finance: "FINANCE",
  messaging: "MESSAGING",
  timetable: "TIMETABLE",
  resources: "RESOURCES",
  canteen: "CANTEEN",
  transport: "TRANSPORT",
  library: "LIBRARY",
  infirmary: "INFIRMARY",
  inventory: "INVENTORY",
};

export function moduleOfDomain(domain: string): ModuleKey | null {
  return PERMISSION_DOMAIN_TO_MODULE[domain] ?? null;
}

export interface ModuleSetting {
  module: ModuleKey;
  enabled: boolean;
  grantedByPlatform: boolean;
}

/**
 * Modules actifs : ceux du plan (sauf si l'école les a désactivés), plus ceux
 * accordés par la plateforme hors plan. Un réglage d'école sur un module hors
 * plan (ex. après un changement de formule) n'a aucun effet.
 */
export function effectiveModules(
  planModules: readonly ModuleKey[],
  settings: readonly ModuleSetting[],
): Set<ModuleKey> {
  const byModule = new Map(settings.map((s) => [s.module, s]));
  const active = new Set<ModuleKey>();
  for (const key of MODULE_KEYS) {
    const setting = byModule.get(key);
    const inPlan = planModules.includes(key);
    if (inPlan ? (setting?.enabled ?? true) : Boolean(setting?.enabled && setting.grantedByPlatform)) active.add(key);
  }
  return active;
}
