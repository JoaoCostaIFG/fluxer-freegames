const ts = () => new Date().toISOString();

export const log = {
  info: (...args: unknown[]) => console.log(`[${ts()} INFO]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${ts()} WARN]`, ...args),
  error: (...args: unknown[]) => console.error(`[${ts()} ERROR]`, ...args),
};

/** Lowercase and strip everything that is not a letter or digit. */
export function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Trim to max length on a word boundary, appending an ellipsis when cut. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Fetch JSON with timeout and retries (exponential-ish backoff). */
export async function fetchJson<T>(
  url: string,
  opts: { retries?: number; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { retries = 2, timeoutMs = 20_000, headers } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'FreeGames/1.0 (self-hosted Fluxer bot)',
          accept: 'application/json',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(2_500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Parse "YYYY-MM-DD HH:mm:ss" (assumed UTC, GamerPower style) or a regular
 * ISO-8601 string. Returns null when missing or invalid.
 */
export function parseUtcDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  const date = match
    ? new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
      )
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}
