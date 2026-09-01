const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const numericId = (gid: string): string => gid.slice(gid.lastIndexOf("/") + 1);

export function targetIds(value: string): Set<string> {
  const ids = value.split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id));
  if (!ids.length) throw new Error("TARGET_VARIANT_IDS must contain numeric IDs");
  return new Set(ids);
}

export function validateDateRange(start: unknown, end: unknown, maxDays: number): void {
  if (typeof start !== "string" || typeof end !== "string" || !ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    throw new ValidationError("Dates must use YYYY-MM-DD");
  }
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || new Date(startMs).toISOString().slice(0, 10) !== start || new Date(endMs).toISOString().slice(0, 10) !== end) {
    throw new ValidationError("Dates are invalid");
  }
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (days < 1) throw new ValidationError("Start date must be on or before end date");
  if (days > maxDays) throw new ValidationError(`Date range cannot exceed ${maxDays} days`);
}

// Converts a shop-local wall clock to UTC without relying on browser timezone.
export function zonedDateBoundary(date: string, timeZone: string, end = false): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const wanted = Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0);
  let guess = wanted;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += wanted - shown;
  }
  return new Date(guess).toISOString();
}

export function etaSeconds(processed: number, total: number, averageMs: number | null): number | null {
  return processed > 0 && averageMs !== null ? Math.max(0, Math.round((total - processed) * averageMs / 1000)) : null;
}

export function retryDelay(attempt: number): number {
  return Math.min(3600, Math.round(5 * 2 ** Math.max(0, attempt - 1) + Math.random() * 5));
}

export class ValidationError extends Error {}
export class RetryableError extends Error {}
export class PermanentError extends Error {}
