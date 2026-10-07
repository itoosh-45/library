import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';

export type ServerProvider = 'nli' | 'googlebooks' | 'goodreads';
export interface CatalogQuotaStore {
  /** Durably consume a slot before contacting the provider; zero admits, positive milliseconds reject. */
  reserve(provider: ServerProvider, now: number, dailyLimit: number): number;
  defer(provider: ServerProvider, until: number): void;
}

/** One durable ledger per deployment, shared by every process; never store keys or queries here. */
export class SqliteCatalogQuota implements CatalogQuotaStore {
  private database: DatabaseSync;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('Quota storage requires an absolute file path.');
    this.database = new DatabaseSync(path, { timeout: 1000 });
    try {
      this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS catalog_quota (
          provider TEXT PRIMARY KEY CHECK(provider IN ('nli','googlebooks','goodreads')),
          day TEXT NOT NULL, used INTEGER NOT NULL CHECK(used >= 0),
          next_at INTEGER NOT NULL CHECK(next_at >= 0)
        ) STRICT;`);
    } catch (error) { this.database.close(); throw error; }
  }
  reserve(provider: ServerProvider, now: number, dailyLimit: number): number {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(dailyLimit) || dailyLimit < 1) throw new Error('Invalid quota reservation.');
    const day = new Date(now).toISOString().slice(0, 10);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.database.prepare('SELECT day, used, next_at FROM catalog_quota WHERE provider = ?').get(provider);
      if (previous && (typeof previous.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(previous.day) || previous.day > day || !Number.isSafeInteger(previous.used) || Number(previous.used) < 0 || !Number.isSafeInteger(previous.next_at) || Number(previous.next_at) < 0)) throw new Error('Invalid quota state or clock rollback.');
      const used = previous?.day === day ? Number(previous.used) : 0;
      const nextAt = previous ? Number(previous.next_at) : 0;
      const wait = Math.max(0, nextAt - now, used >= dailyLimit ? Date.parse(day + 'T00:00:00.000Z') + 86400000 - now : 0);
      // A crash or a failed response-state write must not turn an uncertain upstream request into an immediate retry.
      if (!wait) this.database.prepare(`INSERT INTO catalog_quota(provider,day,used,next_at) VALUES (?,?,?,?)
        ON CONFLICT(provider) DO UPDATE SET day=excluded.day, used=excluded.used, next_at=excluded.next_at`).run(provider, day, used + 1, now + 86400000);
      this.database.exec('COMMIT'); return wait;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  defer(provider: ServerProvider, until: number): void {
    if (!Number.isSafeInteger(until) || until < 0) throw new Error('Invalid quota deferral.');
    const updated = this.database.prepare('UPDATE catalog_quota SET next_at = ? WHERE provider = ?').run(until, provider);
    if (updated.changes !== 1) throw new Error('No quota reservation to defer.');
  }
  close() { this.database.close(); }
}
