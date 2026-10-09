import { getSchoolContext, UnauthenticatedError } from "@/server/context";
import { DomainError, NotFoundError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import { exportXlsx, type ExportKind } from "@/server/services/exports";

const KINDS = new Set<ExportKind>(["students", "debtors", "payments", "attendance", "class-results"]);

function dateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

/** Export Excel d'une liste ou d'une statistique de l'école. */
export async function GET(request: Request, { params }: { params: Promise<{ school: string; kind: string }> }) {
  const { school, kind } = await params;
  if (!KINDS.has(kind as ExportKind)) return new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  try {
    const ctx = await getSchoolContext(school);
    if (!ctx) return new Response("Forbidden", { status: 403 });
    const { name, buffer } = await exportXlsx(ctx, kind as ExportKind, {
      from: dateParam(sp.get("from")),
      to: dateParam(sp.get("to")),
      classId: sp.get("classId") ?? undefined,
      termId: sp.get("termId") ?? undefined,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (error instanceof DomainError || error instanceof NotFoundError)
      return new Response("Not found", { status: 404 });
    throw error;
  }
}
