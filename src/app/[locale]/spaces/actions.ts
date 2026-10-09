"use server";

import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { prisma } from "@/server/db/client";
import { getCurrentSession } from "@/server/auth/session";

const schema = z.object({ locale: z.string(), school: z.string(), role: z.string() });

/** Active un espace (école × rôle) pour la session courante. */
export async function switchSpaceAction(formData: FormData) {
  const { locale, school, role } = schema.parse(Object.fromEntries(formData));
  const current = await getCurrentSession();
  if (!current) redirect({ href: "/login", locale });

  const userRole = await prisma.userRole.findFirst({
    where: { userId: current!.user.id, school: { slug: school }, role: { key: role } },
  });
  if (!userRole) redirect({ href: "/spaces", locale });

  await prisma.session.update({
    where: { id: current!.session.id },
    data: { activeSchoolId: userRole!.schoolId, activeRoleKey: role },
  });
  redirect({ href: `/${school}/dashboard`, locale });
}
