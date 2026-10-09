"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import {
  activateYear,
  addAssignment,
  archiveYear,
  createCycle,
  createTrack,
  createYear,
  deleteClass,
  deleteLevel,
  deleteRoom,
  deleteSubject,
  removeAssignment,
  saveClass,
  saveLevel,
  saveRoom,
  saveSubject,
  setCoefficients,
  updateTerm,
} from "@/server/services/structure";
import { checkbox, color, date, id, int, optionalId, optionalInt, optionalText, text } from "@/lib/zod";

const manage = "school.structure.manage" as const;

export const createYearAction = schoolAction(
  { permission: manage, schema: z.object({ name: text(20), startDate: date, endDate: date }) },
  async (ctx, input) => ({ id: (await createYear(ctx, input)).id }),
);
export const activateYearAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  activateYear(ctx, i.id),
);
export const archiveYearAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  archiveYear(ctx, i.id),
);
export const updateTermAction = schoolAction(
  { permission: manage, schema: z.object({ id, name: text(60), startDate: date, endDate: date }) },
  async (ctx, input) => updateTerm(ctx, input),
);

export const createCycleAction = schoolAction(
  { permission: manage, schema: z.object({ name: text(80), order: int(0, 99) }) },
  async (ctx, input) => {
    await createCycle(ctx, input);
  },
);
export const saveLevelAction = schoolAction(
  {
    permission: manage,
    schema: z.object({
      id: optionalId,
      name: text(60),
      cycleId: id,
      order: int(0, 99),
      nationalExam: optionalText(20),
      studentAccounts: checkbox,
    }),
  },
  async (ctx, input) => {
    await saveLevel(ctx, input);
  },
);
export const deleteLevelAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  deleteLevel(ctx, i.id),
);
export const createTrackAction = schoolAction(
  { permission: manage, schema: z.object({ code: text(10), name: text(80) }) },
  async (ctx, input) => {
    await createTrack(ctx, input);
  },
);

export const saveRoomAction = schoolAction(
  { permission: manage, schema: z.object({ id: optionalId, name: text(60), capacity: optionalInt(1, 1000) }) },
  async (ctx, input) => {
    await saveRoom(ctx, input);
  },
);
export const deleteRoomAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  deleteRoom(ctx, i.id),
);

export const saveSubjectAction = schoolAction(
  { permission: manage, schema: z.object({ id: optionalId, code: text(10), name: text(80), color: color.optional() }) },
  async (ctx, input) => {
    await saveSubject(ctx, input);
  },
);
export const deleteSubjectAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  deleteSubject(ctx, i.id),
);

/** Grille de coefficients : champs « coef_<subjectId> » et « hours_<subjectId> ». */
export const setCoefficientsAction = schoolAction(
  {
    permission: manage,
    schema: z.object({ levelId: id, trackId: optionalId }).catchall(z.string().regex(/^\d{1,2}$/)),
  },
  async (ctx, input) => {
    const entries = Object.keys(input)
      .filter((k) => k.startsWith("coef_"))
      .map((k) => {
        const subjectId = k.slice(5);
        const hours = input[`hours_${subjectId}`];
        return {
          subjectId,
          coefficient: Number(input[k]),
          weeklyMinutes: hours ? Number(hours) * 60 : null,
        };
      });
    await setCoefficients(ctx, { levelId: input.levelId, trackId: input.trackId ?? null, entries });
  },
);

export const saveClassAction = schoolAction(
  {
    permission: manage,
    schema: z.object({
      id: optionalId,
      name: text(40),
      levelId: id,
      trackId: optionalId,
      roomId: optionalId,
      headTeacherId: optionalId,
      capacity: optionalInt(1, 500),
    }),
  },
  async (ctx, input) => ({ id: (await saveClass(ctx, input)).id }),
);
export const deleteClassAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  deleteClass(ctx, i.id),
);

export const addAssignmentAction = schoolAction(
  { permission: manage, schema: z.object({ classId: id, subjectId: id, staffId: id }) },
  async (ctx, input) => {
    await addAssignment(ctx, input);
  },
);
export const removeAssignmentAction = schoolAction({ permission: manage, schema: z.object({ id }) }, async (ctx, i) =>
  removeAssignment(ctx, i.id),
);
