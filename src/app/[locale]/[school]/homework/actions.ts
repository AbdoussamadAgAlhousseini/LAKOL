"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import {
  createHomework,
  deleteHomework,
  gradeSubmission,
  markHomeworkDone,
  saveLesson,
  submitHomework,
} from "@/server/services/homework";
import { checkbox, date, file, id, optionalId, optionalText, text } from "@/lib/zod";

/** Champ « classe|matière » des formulaires du professeur. */
const assignment = z
  .string()
  .regex(/^[^|]+\|[^|]+$/)
  .transform((v) => {
    const [classId, subjectId] = v.split("|");
    return { classId, subjectId };
  });

/** Date et heure locales (<input type="datetime-local">). */
const dateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00.000Z`));

const files = z.array(file).max(5).optional();

export const createHomeworkAction = schoolAction(
  {
    permission: "homework.write",
    schema: z.object({
      assignment,
      title: text(160),
      instructions: text(4000),
      link: z.string().url().max(500).optional(),
      dueAt: dateTime,
      allowSubmission: checkbox,
      lessonId: optionalId,
      files,
    }),
  },
  async (ctx, { assignment: a, ...input }) => {
    const hw = await createHomework(ctx, { ...a, ...input });
    return { id: hw.id };
  },
);

export const deleteHomeworkAction = schoolAction(
  { permission: "homework.read", schema: z.object({ id }) },
  async (ctx, i) => deleteHomework(ctx, i.id),
);

/** Note saisie en points (ex. « 15,5 ») -> centièmes. */
const score = z
  .string()
  .regex(/^\d{1,2}([.,]\d{1,2})?$/)
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));

export const gradeSubmissionAction = schoolAction(
  {
    permission: "homework.write",
    schema: z.object({ submissionId: id, score: score.optional(), feedback: optionalText(2000) }),
  },
  async (ctx, input) => gradeSubmission(ctx, input),
);

export const markDoneAction = schoolAction(
  { permission: "homework.submit", schema: z.object({ homeworkId: id, studentId: id, done: checkbox }) },
  async (ctx, input) => {
    await markHomeworkDone(ctx, input);
  },
);

export const submitHomeworkAction = schoolAction(
  {
    permission: "homework.submit",
    schema: z.object({ homeworkId: id, studentId: id, content: optionalText(10000), files }),
  },
  async (ctx, input) => {
    if (!input.content && !input.files?.length) throw new DomainError("emptySubmission", "content");
    await submitHomework(ctx, input);
  },
);

export const saveLessonAction = schoolAction(
  {
    permission: "lesson.write",
    schema: z.object({ id: optionalId, assignment, date, title: text(160), content: text(8000) }),
  },
  async (ctx, { assignment: a, ...input }) => {
    await saveLesson(ctx, { ...a, ...input });
  },
);
