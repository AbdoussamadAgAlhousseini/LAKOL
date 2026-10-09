// Exécuté une fois au démarrage du serveur Next.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("./server/env");
    assertEnv("app");
  }
}
