import { readAuthorizedFile } from "@/server/platform/files";
import { UnauthenticatedError } from "@/server/context";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await readAuthorizedFile(id);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.doc.mimeType,
        "Content-Length": String(file.body.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.doc.name)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    return new Response("Not found", { status: 404 });
  }
}
