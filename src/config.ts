import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Filters {
  /** Store slugs to allow. Empty array = allow all. */
  stores: string[];
  /** Platform slugs to allow (pc, android, ...). Empty array = allow all. */
  platforms: string[];
  /** Giveaway types to allow (game, dlc, ...). Empty array = allow all. */
  types: string[];
}

export interface EpicConfig {
  country: string;
  locale: string;
}

export interface GamerPowerConfig {
  /**
   * Skip open-ended giveaways (no end date) published longer ago than this
   * many days. GamerPower's feed never expires some entries; without this
   * guard years-dead DLC-key packs get announced. 0 disables the guard.
   */
  maxOpenEndedAgeDays: number;
}

export interface AppConfig {
  /** Guild (server) snowflake, or "auto" for the first guild the bot is in. */
  guildId: string;
  /** Channel name (e.g. "free-games") or channel snowflake. */
  channel: string;
  pollIntervalMinutes: number;
  reapIntervalMinutes: number;
  endGraceMinutes: number;
  epic: EpicConfig;
  gamerpower: GamerPowerConfig;
  filters: Filters;
}

export interface CliOptions {
  configPath: string;
  dryRun: boolean;
  once: boolean;
  announceExisting: boolean;
}

const USAGE = `FreeGames — announces free game giveaways into a Fluxer channel.

Usage:
  npm start -- [--dry-run] [--once] [--announce-existing] [--config=<path>]

Options:
  --dry-run           Log what would be posted without sending anything.
                      Nothing is written to the state file.
  --once              Run a single poll + reap pass and exit.
  --announce-existing On the very first run, post every currently active
                      giveaway instead of baselining silently.
  --config=<path>     Path to config.json (default: ./config.json).
  -h, --help          Show this help.
`;

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    configPath: resolve(process.cwd(), 'config.json'),
    dryRun: false,
    once: false,
    announceExisting: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue; // npm/pnpm script separator may be forwarded
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--once') opts.once = true;
    else if (arg === '--announce-existing') opts.announceExisting = true;
    else if (arg.startsWith('--config=')) opts.configPath = resolve(arg.slice('--config='.length));
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return opts;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(path: string): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Cannot read config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const root = (raw ?? {}) as Record<string, unknown>;
  const epic = (root.epic ?? {}) as Record<string, unknown>;
  const gamerpower = (root.gamerpower ?? {}) as Record<string, unknown>;
  const filters = (root.filters ?? {}) as Record<string, unknown>;
  return {
    guildId:
      typeof root.guildId === 'string' && root.guildId.trim() ? root.guildId.trim() : 'auto',
    channel:
      typeof root.channel === 'string' && root.channel.trim() ? root.channel.trim() : 'free-games',
    pollIntervalMinutes: asPositiveNumber(root.pollIntervalMinutes, 20),
    reapIntervalMinutes: asPositiveNumber(root.reapIntervalMinutes, 5),
    endGraceMinutes: asPositiveNumber(root.endGraceMinutes, 10),
    epic: {
      country: typeof epic.country === 'string' && epic.country.trim() ? epic.country.trim() : 'US',
      locale: typeof epic.locale === 'string' && epic.locale.trim() ? epic.locale.trim() : 'en-US',
    },
    gamerpower: {
      maxOpenEndedAgeDays:
        typeof gamerpower.maxOpenEndedAgeDays === 'number' &&
        Number.isFinite(gamerpower.maxOpenEndedAgeDays) &&
        gamerpower.maxOpenEndedAgeDays >= 0
          ? gamerpower.maxOpenEndedAgeDays
          : 30,
    },
    filters: {
      stores: asStringArray(filters.stores),
      platforms: asStringArray(filters.platforms),
      types: asStringArray(filters.types),
    },
  };
}
