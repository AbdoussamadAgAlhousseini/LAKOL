import { getSchoolContext, UnauthenticatedError } from "@/server/context";
import { ForbiddenError } from "@/server/rbac/policies";
import { NotFoundError } from "@/server/errors";
import { studentCardPdf } from "@/server/services/report-cards";

export async function GET(_: Request, { params }: { params: Promise<{ school: string; id: string }> }) {
  const { school, id } = await params;
  try {
    const ctx = await getSchoolContext(school);
    if (!ctx) return new Response("Forbidden", { status: 403 });
    const pdf = await studentCardPdf(ctx, id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="carte-scolaire.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
