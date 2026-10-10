import type { Client } from '@fluxerjs/core';
import type { StateStore } from './state.js';
import { log } from './util.js';

/** Reaction added to an announcement once its deal is over. */
export const DONE_EMOJI = '❌';

export interface SourcePollStatus {
  ok: boolean;
  /** Giveaway keys the source reported as active in its last successful poll. */
  keys: ReadonlySet<string>;
}

export interface LastPoll {
  at: number;
  sources: Record<string, SourcePollStatus>;
}

const MAX_CLOSE_ATTEMPTS = 5;

/**
 * Mark announced-but-finished deals as done by reacting with a red cross.
 * A deal is considered over when:
 *  - its end date has passed (plus a grace window), or
 *  - the source that announced it had a successful poll and no longer lists it
 *    (covers missing end dates and delisted giveaways).
 */
export async function reapExpired(options: {
  client: Client;
  state: StateStore;
  lastPoll: LastPoll | null;
  graceMinutes: number;
  dryRun: boolean;
}): Promise<number> {
  const { client, state, lastPoll, graceMinutes, dryRun } = options;
  const graceMs = graceMinutes * 60_000;
  let closed = 0;

  for (const [key, entry] of state.getAnnounced()) {
    let reason: string | null = null;
    if (entry.endsAt && Date.now() >= Date.parse(entry.endsAt) + graceMs) {
      reason = 'end date passed';
    } else if (lastPoll) {
      const status = lastPoll.sources[entry.source];
      if (status?.ok && !status.keys.has(key)) reason = 'no longer listed by source';
    }
    if (!reason) continue;

    log.info(`reaper: marking "${entry.title}" as done (${reason})`);
    if (dryRun) continue;

    try {
      const message = await client.channels.fetchMessage(entry.channelId, entry.messageId);
      await message.react(DONE_EMOJI);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const messageGone = /\b(404|unknown message|not found)\b/i.test(message);
      if (messageGone) {
        log.warn(`reaper: message for "${entry.title}" is gone; closing silently`);
        state.moveToClosed(key);
        state.save();
        continue;
      }
      const attempts = state.bumpCloseAttempt(key);
      if (attempts >= MAX_CLOSE_ATTEMPTS) {
        log.warn(`reaper: giving up on "${entry.title}" after ${attempts} failed attempts`);
        state.moveToClosed(key);
        state.save();
        continue;
      }
      log.error(`reaper: failed to mark "${entry.title}" (${message}); will retry`);
      continue;
    }

    state.moveToClosed(key);
    closed++;
  }

  if (closed > 0) state.save();
  return closed;
}
