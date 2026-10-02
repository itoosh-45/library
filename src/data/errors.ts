function storageQuotaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const value = error as { name?: string; cause?: unknown; inner?: unknown; failures?: unknown[] };
  return value.name === 'QuotaExceededError' || storageQuotaError(value.cause, depth + 1) || storageQuotaError(value.inner, depth + 1)
    || (Array.isArray(value.failures) && value.failures.slice(0, 20).some(failure => storageQuotaError(failure, depth + 1)));
}
export function errorMessage(error: unknown): string {
  if (storageQuotaError(error)) return 'אין מספיק מקום פנוי לאחסון בדפדפן. שמור גיבוי לפני פינוי מקום ונסה שוב.';
  return error instanceof Error ? error.message : 'הפעולה לא הושלמה. נסה שוב.';
}
