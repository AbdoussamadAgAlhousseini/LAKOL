"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import {
  createAssessment,
  deleteAssessment,
  importGrades,
  saveGrades,
  unlockClassTerm,
  validateClassTerm,
} from "@/server/services/assessments";
import { saveAppraisal, saveCouncilDecision } from "@/server/services/report-cards";
import { date, file, id, int, optionalId, text } from "@/lib/zod";

const assignment = z
  .string()
  .regex(/^[^|]+\|[^|]+$/)
  .transform((v) => {
    const [classId, subjectId] = v.split("|");
    return { classId, subjectId };
  });

export const createAssessmentAction = schoolAction(
  {
    permission: "grade.write",
    schema: z.object({
      assignment,
      termId: id,
      type: z.enum(["QUIZ", "HOMEWORK", "COMPOSITION", "MOCK_EXAM"]),
      title: text(120),
      date,
      outOf: z.coerce.number().pipe(z.union([z.literal(10), z.literal(20)])),
      weight: int(1, 10),
    }),
  },
  async (ctx, { assignment: a, ...input }) => ({ id: (await createAssessment(ctx, { ...a, ...input })).id }),
);

export const deleteAssessmentAction = schoolAction(
  { permission: "grade.write", schema: z.object({ id }) },
  async (ctx, i) => deleteAssessment(ctx, i.id),
);

/** Grille : un champ « grade_<élève> » par ligne (valeur « 13,5 », « abs » ou vide). */
export const saveGradesAction = schoolAction(
  { permission: "grade.write", schema: z.object({ assessmentId: id }).catchall(z.string().max(10)) },
  async (ctx, input) => {
    const entries = Object.keys(input)
      .filter((k) => k.startsWith("grade_"))
      .map((k) => ({ studentId: k.slice(6), value: input[k] }));
    // Les champs vidés sont absents du formulaire : on les signale explicitement.
    const cleared = ((input.cleared as string | undefined) ?? "").split(",").filter(Boolean);
    for (const studentId of cleared)
      if (!entries.some((e) => e.studentId === studentId)) entries.push({ studentId, value: "" });
    return saveGrades(ctx, { assessmentId: input.assessmentId, entries });
  },
);

export const importGradesAction = schoolAction(
  { permission: "grade.write", schema: z.object({ assessmentId: id, file }) },
  async (ctx, input) => importGrades(ctx, input),
);

export const validateClassTermAction = schoolAction(
  { permission: "grade.validate", schema: z.object({ classId: id, termId: id }) },
  async (ctx, input) => {
    await validateClassTerm(ctx, input);
  },
);

export const unlockClassTermAction = schoolAction(
  { permission: "grade.unlock", schema: z.object({ classId: id, termId: id }) },
  async (ctx, input) => unlockClassTerm(ctx, input),
);

/** Appréciations en lot : « appr_<élève> » ; subjectId absent = appréciation générale. */
export const saveAppraisalsAction = schoolAction(
  { permission: "grade.read", schema: z.object({ termId: id, subjectId: optionalId }).catchall(z.string().max(500)) },
  async (ctx, input) => {
    const ids = ((input.students as string | undefined) ?? "").split(",").filter(Boolean);
    for (const studentId of ids) {
      await saveAppraisal(ctx, {
        termId: input.termId,
        studentId,
        subjectId: input.subjectId ?? null,
        comment: (input[`appr_${studentId}`] as string | undefined) ?? "",
      });
    }
  },
);

const decision = z.enum(["PROMOTED", "REPEAT", "EXPELLED", "CONDITIONAL"]);
const distinction = z.enum(["CONGRATULATIONS", "HONOR_ROLL", "ENCOURAGEMENT", "WORK_WARNING", "CONDUCT_WARNING"]);

/** Décisions du conseil en lot : « decision_<élève> », « distinction_<élève> ». */
export const saveCouncilAction = schoolAction(
  { permission: "council.manage", schema: z.object({ termId: id }).catchall(z.string().max(40)) },
  async (ctx, input) => {
    const ids = ((input.students as string | undefined) ?? "").split(",").filter(Boolean);
    for (const studentId of ids) {
      const d = decision.safeParse(input[`decision_${studentId}`]);
      const x = distinction.safeParse(input[`distinction_${studentId}`]);
      await saveCouncilDecision(ctx, {
        termId: input.termId,
        studentId,
        decision: d.success ? d.data : null,
        distinction: x.success ? x.data : null,
      });
    }
  },
);
