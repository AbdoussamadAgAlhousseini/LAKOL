import type { SchoolContext } from "@/server/context";
import { Select } from "@/components/ui/select";

/** Liste déroulante des élèves inscrits, groupés par classe (année active). */
export async function StudentSelect({
  ctx,
  id = "studentId",
  name = "studentId",
  placeholder = "—",
}: {
  ctx: SchoolContext;
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const classes = await ctx.db.class.findMany({
    where: { academicYear: { isActive: true } },
    include: {
      enrollments: {
        where: { status: "ACTIVE", deletedAt: null },
        include: { student: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      },
    },
    orderBy: { name: "asc" },
  });
  return (
    <Select id={id} name={name} defaultValue="">
      <option value="" disabled>
        {placeholder}
      </option>
      {classes.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {c.enrollments.map((e) => (
            <option key={e.studentId} value={e.studentId}>
              {e.student.lastName} {e.student.firstName}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
