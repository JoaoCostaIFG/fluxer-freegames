import { resolve } from 'node:path';
import type { TextBasedChannel } from '@fluxerjs/core';
import { loadConfig, parseArgs, type Filters } from './config.js';
import { loadDotEnv } from './env.js';
import { buildAnnouncementEmbed } from './embed.js';
import { connect, resolveTarget } from './fluxer.js';
import { reapExpired, type LastPoll } from './reaper.js';
import { StateStore } from './state.js';
import { EpicSource } from './sources/epic.js';
import { GamerPowerSource } from './sources/gamerpower.js';
import type { GameGiveaway, GiveawaySource } from './sources/types.js';
import { log, normalize, sleep } from './util.js';

/** Delay between consecutive announcement posts (basic rate-limit safety). */
const POST_SPACING_MS = 700;

function applyFilters(games: GameGiveaway[], filters: Filters): GameGiveaway[] {
  if (
    filters.stores.length === 0 &&
    filters.platforms.length === 0 &&
    filters.types.length === 0
  ) {
    return games;
  }
  const stores = new Set(filters.stores.map(normalize));
  const platforms = new Set(filters.platforms.map(normalize));
  const types = new Set(filters.types.map(normalize));
  return games.filter((game) => {
    if (stores.size > 0 && !stores.has(game.store)) return false;
    if (platforms.size > 0 && !game.platforms.some((platform) => platforms.has(platform))) {
      return false;
    }
    if (types.size > 0 && !types.has(game.type)) return false;
    return true;
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const cfg = loadConfig(args.configPath);
  const state = new StateStore(resolve(process.cwd(), 'data/state.json'), args.dryRun);

  const token = process.env.FLUXER_BOT_TOKEN;
  if (!token) throw new Error('FLUXER_BOT_TOKEN is not set — put it in .env or the environment');
  const origin = process.env.FLUXER_INSTANCE_ORIGIN;
  if (!origin) {
    throw new Error('FLUXER_INSTANCE_ORIGIN is not set — put it in .env or the environment');
  }

  log.info(
    `FreeGames starting${args.dryRun ? ' [dry-run]' : ''}${args.once ? ' [once]' : ''} ` +
      `(poll every ${cfg.pollIntervalMinutes}m, reap every ${cfg.reapIntervalMinutes}m)`,
  );

  const client = await connect(token, origin);
  const target = await resolveTarget(client, cfg);
  log.info(`fluxer: announcing in #${target.channelName} on "${target.guildName}"`);

  const channel = await client.channels.fetch(target.channelId);
  if (!channel.isTextBased()) throw new Error(`#${target.channelName} is not a text channel`);
  // Capture the narrowed type so it survives into the announce() closure.
  const announceChannel: TextBasedChannel = channel;

  const sources: GiveawaySource[] = [new EpicSource(cfg.epic), new GamerPowerSource()];
  let lastPoll: LastPoll | null = null;

  async function announce(giveaway: GameGiveaway): Promise<void> {
    if (args.dryRun) {
      log.info(`[dry-run] would announce: ${giveaway.storeName} — ${giveaway.title} (${giveaway.url})`);
      state.markSeen(giveaway.key);
      return;
    }
    const embed = buildAnnouncementEmbed(giveaway);
    const message = await announceChannel.send({ embeds: [embed] });
    state.setAnnounced(giveaway.key, {
      channelId: target.channelId,
      messageId: message.id,
      endsAt: giveaway.endsAt,
      source: giveaway.source,
      title: giveaway.title,
      announcedAt: new Date().toISOString(),
    });
    log.info(`announced: ${giveaway.storeName} — ${giveaway.title}`);
  }

  async function runPoll(): Promise<void> {
    const sourcesStatus: LastPoll['sources'] = {};
    const active: GameGiveaway[] = [];

    for (const source of sources) {
      try {
        const items = await source.poll();
        sourcesStatus[source.id] = { ok: true, keys: new Set(items.map((item) => item.key)) };
        active.push(...items);
        log.info(`source ${source.id}: ${items.length} active giveaway(s)`);
      } catch (err) {
        sourcesStatus[source.id] = { ok: false, keys: new Set() };
        log.error(`source ${source.id}: poll failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    lastPoll = { at: Date.now(), sources: sourcesStatus };

    const visible = applyFilters(active, cfg.filters);
    const dropped = active.length - visible.length;

    if (state.isFresh() && !args.announceExisting) {
      for (const giveaway of visible) state.markSeen(giveaway.key);
      log.info(
        `first run: baselined ${visible.length} active giveaway(s) silently ` +
          '(start with --announce-existing to post them); watching for new ones from now on',
      );
    } else {
      const toAnnounce = visible.filter((giveaway) => !state.isSeen(giveaway.key));
      if (state.isFresh() && args.announceExisting) {
        log.info(`first run: announcing all ${toAnnounce.length} currently active giveaway(s)`);
      } else if (toAnnounce.length === 0) {
        log.info(`poll: nothing new (${visible.length} active${dropped > 0 ? `, ${dropped} filtered out` : ''})`);
      }
      for (const giveaway of toAnnounce) {
        await announce(giveaway);
        await sleep(POST_SPACING_MS);
      }
    }

    for (const giveaway of visible) state.markSeen(giveaway.key);
    state.save();
  }

  async function runReap(): Promise<void> {
    await reapExpired({
      client,
      state,
      lastPoll,
      graceMinutes: cfg.endGraceMinutes,
      dryRun: args.dryRun,
    });
  }

  let stopping = false;
  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    log.info(`received ${signal}; shutting down`);
    state.save();
    try {
      await (client as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // best effort — the process is exiting anyway
    }
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection:', reason);
  });

  await runPoll();
  await runReap();

  if (args.once) {
    log.info('single pass complete; exiting');
    state.save();
    try {
      await (client as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // ignore
    }
    return;
  }

  setInterval(() => {
    void runPoll().catch((err) => {
      log.error(`poll failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, cfg.pollIntervalMinutes * 60_000);

  setInterval(() => {
    void runReap().catch((err) => {
      log.error(`reap failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, cfg.reapIntervalMinutes * 60_000);

  log.info('FreeGames is running; press Ctrl+C to stop');
}

main().catch((err) => {
  log.error(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
