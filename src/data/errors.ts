export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'הפעולה לא הושלמה. נסה שוב.'; }
