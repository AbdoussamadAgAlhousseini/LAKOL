import { getSchoolContext, UnauthenticatedError } from "@/server/context";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import { receiptPdf } from "@/server/services/finance/payments";

export async function GET(_: Request, { params }: { params: Promise<{ school: string; paymentId: string }> }) {
  const { school, paymentId } = await params;
  try {
    const ctx = await getSchoolContext(school);
    if (!ctx) return new Response("Forbidden", { status: 403 });
    const { number, pdf } = await receiptPdf(ctx, paymentId);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="recu-${number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (error instanceof DomainError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
