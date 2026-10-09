import "server-only";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { MALI_SUBJECTS, MALI_TEMPLATE, MALI_TRACKS, type CycleKey } from "@/lib/school-templates";
import { actor, type ServiceContext } from "./context";
import { activateYear, createYear, getActiveYear } from "./structure";

export type OnboardingStep = "school" | "year" | "classes" | "students" | "teachers";

/**
 * État de l'assistant de démarrage, déduit des données (rien à synchroniser) :
 * une étape est faite dès que l'école a rempli ce qu'elle demande.
 */
export async function onboardingState(ctx: ServiceContext) {
  const year = await getActiveYear(ctx);
  const [classes, subjects, students, staff] = await Promise.all([
    year ? ctx.db.class.count({ where: { academicYearId: year.id } }) : 0,
    ctx.db.subject.count(),
    year ? ctx.db.enrollment.count({ where: { academicYearId: year.id, status: "ACTIVE", deletedAt: null } }) : 0,
    ctx.db.staff.count({ where: { deletedAt: null, isActive: true } }),
  ]);
  const done: Record<OnboardingStep, boolean> = {
    school: Boolean(ctx.school.phone && ctx.school.city),
    year: Boolean(year),
    classes: classes > 0 && subjects > 0,
    students: students > 0,
    teachers: staff > 0,
  };
  const steps = (Object.keys(done) as OnboardingStep[]).map((key) => ({ key, done: done[key] }));
  const completed = steps.filter((s) => s.done).length;
  return {
    steps,
    completed,
    total: steps.length,
    year,
    finished: Boolean(ctx.school.onboardingDoneAt) || completed === steps.length,
    dismissed: Boolean(ctx.school.onboardingDoneAt),
  };
}

function requireStructureManager(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "school.structure.manage")) throw new ForbiddenError();
}

/** Crée et active l'année scolaire (périodes découpées selon trimestres/semestres). */
export async function startSchoolYear(ctx: ServiceContext, input: { name: string; startDate: Date; endDate: Date }) {
  requireStructureManager(ctx);
  if (await getActiveYear(ctx)) throw new DomainError("yearAlreadyActive");
  const year = await createYear(ctx, input);
  await activateYear(ctx, year.id);
  return year;
}

/**
 * Applique le modèle malien aux cycles choisis : cycles, niveaux, séries,
 * matières et coefficients, et une classe « A » par niveau (par série au
 * lycée). Ce qui existe déjà (même nom ou même code) est conservé.
 */
export async function applyMaliTemplate(ctx: ServiceContext, input: { cycles: CycleKey[] }) {
  requireStructureManager(ctx);
  if (input.cycles.length === 0) throw new DomainError("cyclesRequired", "cycles");
  const year = await getActiveYear(ctx);
  if (!year) throw new DomainError("noActiveYear");
  const schoolId = ctx.school.id;
  const created = { levels: 0, classes: 0, subjects: 0 };

  const subjects = new Map((await ctx.db.subject.findMany()).map((s) => [s.code, s]));
  const tracks = new Map((await ctx.db.track.findMany()).map((t) => [t.code, t]));
  const needsSubject = (code: string) => !subjects.has(code);

  for (const cycleDef of MALI_TEMPLATE.filter((c) => input.cycles.includes(c.key))) {
    const cycle =
      (await ctx.db.cycle.findFirst({ where: { name: cycleDef.name } })) ??
      (await ctx.db.cycle.create({ data: { schoolId, name: cycleDef.name, order: cycleDef.order } }));
    for (const lv of cycleDef.levels) {
      let level = await ctx.db.level.findFirst({ where: { name: lv.name } });
      if (!level) {
        level = await ctx.db.level.create({
          data: {
            schoolId,
            cycleId: cycle.id,
            name: lv.name,
            order: lv.order,
            nationalExam: lv.nationalExam ?? null,
            studentAccounts: lv.studentAccounts,
          },
        });
        created.levels++;
      }
      for (const code of Object.keys(lv.coefficients).filter(needsSubject)) {
        const def = MALI_SUBJECTS.find((s) => s.code === code)!;
        subjects.set(code, await ctx.db.subject.create({ data: { schoolId, ...def } }));
        created.subjects++;
      }
      const trackIds: (string | null)[] = [];
      for (const code of lv.tracks ?? []) {
        if (!tracks.has(code)) {
          const def = MALI_TRACKS.find((t) => t.code === code)!;
          tracks.set(code, await ctx.db.track.create({ data: { schoolId, ...def } }));
        }
        trackIds.push(tracks.get(code)!.id);
      }
      if (trackIds.length === 0) trackIds.push(null);

      for (const trackId of trackIds) {
        for (const [code, coefficient] of Object.entries(lv.coefficients)) {
          const subjectId = subjects.get(code)!.id;
          const exists = await ctx.db.subjectCoefficient.findFirst({
            where: { levelId: level.id, subjectId, trackId },
          });
          if (!exists) {
            await ctx.db.subjectCoefficient.create({
              data: { schoolId, levelId: level.id, subjectId, trackId, coefficient, weeklyMinutes: coefficient * 60 },
            });
          }
        }
        const trackCode = trackId ? [...tracks.values()].find((t) => t.id === trackId)!.code : null;
        const name = trackCode ? `${lv.name} ${trackCode}` : `${lv.name} A`;
        if (!(await ctx.db.class.findFirst({ where: { academicYearId: year.id, name } }))) {
          await ctx.db.class.create({
            data: { schoolId, academicYearId: year.id, levelId: level.id, trackId, name },
          });
          created.classes++;
        }
      }
    }
  }
  await audit(ctx.db, actor(ctx), {
    action: "school.template",
    entityType: "School",
    entityId: schoolId,
    after: { cycles: input.cycles, ...created },
  });
  return created;
}

/** Termine (ou masque) l'assistant de démarrage. */
export async function finishOnboarding(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "school.settings.manage")) throw new ForbiddenError();
  await ctx.db.school.update({ where: { id: ctx.school.id }, data: { onboardingDoneAt: new Date() } });
}

/** Étape 1 : coordonnées de l'école (en-tête des bulletins, reçus, messages). */
export async function updateSchoolBasics(
  ctx: ServiceContext,
  input: { name: string; city: string; phone: string; address?: string | null; email?: string | null },
) {
  if (!canAll(ctx.scope, "school.settings.manage")) throw new ForbiddenError();
  const before = { name: ctx.school.name, city: ctx.school.city, phone: ctx.school.phone };
  await ctx.db.school.update({
    where: { id: ctx.school.id },
    data: {
      name: input.name,
      city: input.city,
      phone: input.phone,
      address: input.address ?? null,
      email: input.email ?? null,
    },
  });
  await audit(ctx.db, actor(ctx), {
    action: "school.settings",
    entityType: "School",
    entityId: ctx.school.id,
    before,
    after: input,
  });
}
