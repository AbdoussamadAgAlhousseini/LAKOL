import { getSchoolContext, UnauthenticatedError } from "@/server/context";
import { can } from "@/server/rbac/policies";
import { buildStaffImportTemplate } from "@/server/services/staff-import";

export async function GET(_: Request, { params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  try {
    const ctx = await getSchoolContext(school);
    if (!ctx || !can(ctx.scope, "staff.write")) return new Response("Forbidden", { status: 403 });
    const body = await buildStaffImportTemplate(ctx);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lakol-import-personnel.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    return new Response("Error", { status: 500 });
  }
}
