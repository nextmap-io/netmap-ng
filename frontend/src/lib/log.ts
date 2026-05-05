/**
 * Lightweight error/telemetry hook.
 * - Logs to console only in dev (suppresses noise in production builds).
 * - Production hook for Sentry / OpenTelemetry can be wired here later.
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[netmap]", error, context);
  }
  // Production: hook to Sentry / OpenTelemetry later.
}
