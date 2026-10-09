import { getSchoolContext, UnauthenticatedError } from "@/server/context";
import { unreadMessageCount } from "@/server/services/messaging";
import { unreadNotificationCount } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

const INTERVAL_MS = 5_000;
const LIFETIME_MS = 5 * 60_000; // le navigateur se reconnecte tout seul (EventSource)

/** Flux SSE : compteurs de notifications et de messages non lus de l'utilisateur. */
export async function GET(request: Request, { params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  let ctx;
  try {
    ctx = await getSchoolContext(school);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  if (!ctx) return new Response("Forbidden", { status: 403 });
  const context = ctx;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = "";
  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      const close = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      };
      const push = async () => {
        if (Date.now() - started > LIFETIME_MS) return close();
        try {
          const [notifications, messages] = await Promise.all([
            unreadNotificationCount(context),
            unreadMessageCount(context),
          ]);
          const data = JSON.stringify({ notifications, messages });
          controller.enqueue(encoder.encode(data === last ? ": ping\n\n" : `event: counts\ndata: ${data}\n\n`));
          last = data;
        } catch {
          close();
        }
      };
      controller.enqueue(encoder.encode("retry: 10000\n\n"));
      await push();
      timer = setInterval(push, INTERVAL_MS);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
