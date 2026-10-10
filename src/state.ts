import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { log } from './util.js';

export interface AnnouncedEntry {
  channelId: string;
  messageId: string;
  /** ISO timestamp of the deal's end, or null when the source had none. */
  endsAt: string | null;
  /** Source id that produced the giveaway (used by the reaper). */
  source: string;
  title: string;
  announcedAt: string;
  closeAttempts?: number;
}

export interface BotState {
  version: 1;
  /** giveaway key -> ISO timestamp first seen */
  seen: Record<string, string>;
  /** giveaway key -> announcement details (message ref for the reaper) */
  announced: Record<string, AnnouncedEntry>;
  /** giveaway key -> ISO timestamp closed (deal over, already reacted) */
  closed: Record<string, string>;
}

const RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

function emptyState(): BotState {
  return { version: 1, seen: {}, announced: {}, closed: {} };
}

/**
 * Persistent state (data/state.json). In dry-run mode nothing is written,
 * so a dry run never suppresses future real announcements.
 */
export class StateStore {
  private state: BotState = emptyState();
  private readonly file: string;

  constructor(file: string, private readonly dryRun = false) {
    this.file = resolve(file);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      log.info(`state: starting fresh (${this.file} does not exist yet)`);
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<BotState>;
      this.state = {
        version: 1,
        seen: isRecord(parsed.seen) ? (parsed.seen as BotState['seen']) : {},
        announced: isRecord(parsed.announced) ? (parsed.announced as BotState['announced']) : {},
        closed: isRecord(parsed.closed) ? (parsed.closed as BotState['closed']) : {},
      };
      log.info(
        `state: loaded ${Object.keys(this.state.seen).length} seen, ` +
          `${Object.keys(this.state.announced).length} announced, ` +
          `${Object.keys(this.state.closed).length} closed`,
      );
    } catch (err) {
      log.error(
        `state: failed to parse ${this.file}, starting fresh: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  save(): void {
    if (this.dryRun) return;
    this.prune();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
      renameSync(tmp, this.file);
    } catch (err) {
      log.error(`state: failed to save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Drop seen/closed entries older than the retention window. */
  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const record of [this.state.seen, this.state.closed]) {
      for (const key of Object.keys(record)) {
        const at = Date.parse(record[key] ?? '');
        if (Number.isFinite(at) && at < cutoff) delete record[key];
      }
    }
  }

  /** True when this looks like a brand-new deployment. */
  isFresh(): boolean {
    return (
      Object.keys(this.state.seen).length === 0 && Object.keys(this.state.announced).length === 0
    );
  }

  isSeen(key: string): boolean {
    return key in this.state.seen;
  }

  markSeen(key: string): void {
    if (!(key in this.state.seen)) this.state.seen[key] = new Date().toISOString();
  }

  setAnnounced(key: string, entry: AnnouncedEntry): void {
    this.state.announced[key] = entry;
    this.markSeen(key);
  }

  getAnnounced(): [string, AnnouncedEntry][] {
    return Object.entries(this.state.announced);
  }

  moveToClosed(key: string): void {
    if (key in this.state.announced) {
      this.state.closed[key] = new Date().toISOString();
      delete this.state.announced[key];
    }
  }

  /** Track failed close attempts so the reaper can eventually give up. */
  bumpCloseAttempt(key: string): number {
    const entry = this.state.announced[key];
    if (!entry) return Number.POSITIVE_INFINITY;
    entry.closeAttempts = (entry.closeAttempts ?? 0) + 1;
    return entry.closeAttempts;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
