import { platformInvoicePdf } from "@/server/platform/invoice-pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await platformInvoicePdf(id).catch(() => null);
  if (!result) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${result.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
