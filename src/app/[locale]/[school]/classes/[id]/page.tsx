import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage } from "@/server/page-context";
import { can, canOnClass } from "@/server/rbac/policies";
import { staffOptions, subjectOptions } from "@/server/services/options";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, Td, Th } from "@/components/ui/table";
import { addAssignmentAction, removeAssignmentAction } from "../../structure/actions";

export default async function ClassPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadSchoolPage(school, locale);
  // Parcours 6 : un professeur n'ouvre que les classes où il enseigne.
  if (!ctx || !canOnClass(ctx.scope, "student.read", id)) return <Forbidden />;

  const cls = await ctx.db.class.findUnique({
    where: { id },
    include: {
      level: true,
      track: true,
      room: true,
      headTeacher: true,
      academicYear: true,
      enrollments: {
        where: { status: "ACTIVE", deletedAt: null },
        include: { student: true },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      },
      teachingAssignments: { include: { subject: true, staff: true }, orderBy: { subject: { name: "asc" } } },
    },
  });
  if (!cls) notFound();

  const [t, te] = await Promise.all([getTranslations("classes"), getTranslations("enums")]);
  const manage = can(ctx.scope, "school.structure.manage");
  const [subjects, staff] = manage ? await Promise.all([subjectOptions(ctx), staffOptions(ctx)]) : [[], []];
  const assigned = new Set(cls.teachingAssignments.map((a) => a.subjectId));
  const girls = cls.enrollments.filter((e) => e.student.gender === "FEMALE").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={cls.name}
        description={[
          cls.level.name,
          cls.track?.code,
          cls.room?.name,
          cls.headTeacher && `${t("headTeacher")} : ${cls.headTeacher.firstName} ${cls.headTeacher.lastName}`,
          cls.academicYear.name,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("roster")}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("count", { count: cls.enrollments.length })} ·{" "}
              {t("genderSplit", { girls, boys: cls.enrollments.length - girls })}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <ol className="divide-y" data-testid="roster">
              {cls.enrollments.map((e, i) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="text-muted-foreground w-6 text-right tabular-nums">{i + 1}</span>
                  <Link
                    href={`/${school}/students/${e.studentId}`}
                    className="flex-1 font-medium underline-offset-4 hover:underline"
                  >
                    {e.student.lastName} {e.student.firstName}
                  </Link>
                  <span className="text-muted-foreground">{te(`genderShort.${e.student.gender}`)}</span>
                  <span className="text-muted-foreground hidden sm:inline">{e.student.matricule}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("assignments")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <thead>
                <tr>
                  <Th>{t("subject")}</Th>
                  <Th>{t("teacher")}</Th>
                  {manage && <Th className="sr-only">{t("remove")}</Th>}
                </tr>
              </thead>
              <tbody>
                {cls.teachingAssignments.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.subject.name}</Td>
                    <Td>
                      {a.staff.firstName} {a.staff.lastName}
                    </Td>
                    {manage && (
                      <Td className="text-right">
                        <ActionButton
                          action={removeAssignmentAction}
                          school={school}
                          fields={{ id: a.id }}
                          variant="ghost"
                          size="icon"
                        >
                          <Trash2 aria-label={t("remove")} />
                        </ActionButton>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            {manage && (
              <ActionForm action={addAssignmentAction} school={school} className="border-t pt-4">
                <input type="hidden" name="classId" value={cls.id} />
                <Field name="subjectId" label={t("subject")}>
                  <Select id="subjectId" name="subjectId" defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {subjects
                      .filter((s) => !assigned.has(s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field name="staffId" label={t("teacher")}>
                  <Select id="staffId" name="staffId" defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" className="self-start">
                  {t("assign")}
                </SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
