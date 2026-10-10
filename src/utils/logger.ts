import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';

/**
 * Structured JSON logs, one object per line on stdout. On Lambda, stdout goes straight to
 * CloudWatch Logs, where these fields are queryable with Logs Insights
 * (e.g. `filter event = "status_transition" | stats avg(durationMs) by to`).
 *
 * LOG_LEVEL: trace|debug|info|warn|error|fatal|silent (default info).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'recyconnect' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

const context = new AsyncLocalStorage<Logger>();

/** Runs `fn` with a child logger (e.g. carrying reqId) that `log()` returns anywhere below it. */
export function withLogContext<T>(bindings: Record<string, unknown>, fn: () => T): T {
  return context.run(log().child(bindings), fn);
}

/** The logger for the current request / job, or the root logger outside one. */
export function log(): Logger {
  return context.getStore() ?? logger;
}
