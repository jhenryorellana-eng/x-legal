/**
 * Next.js instrumentation hook (C-3 fix).
 *
 * Next.js executes this file once at server startup (before any request).
 * We guard on NEXT_RUNTIME='nodejs' so it only runs in the Node.js runtime
 * (not in Edge or during the build step).
 *
 * DOC-20 §5: consumers must be registered at startup; heavy side-effects are
 * delegated to QStash inside the consumer.
 *
 * registerConsumers() is idempotent (guarded by the `registered` flag inside
 * register-consumers.ts), so hot-reload in dev does not double-register.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerConsumers } = await import(
      "@/backend/modules/register-consumers"
    );
    registerConsumers();
  }
}
