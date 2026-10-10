import { ChannelType, Client, Events } from '@fluxerjs/core';
import type { AppConfig } from './config.js';
import { log, sleep } from './util.js';

export interface ResolvedTarget {
  channelId: string;
  channelName: string;
  guildName: string;
}

/**
 * Connect to a (self-hosted) Fluxer instance. Tries /.well-known/fluxer
 * discovery first; falls back to using the origin directly as the API host.
 */
export async function connect(token: string, origin: string): Promise<Client> {
  let client: Client;
  try {
    client = await Client.fromDiscovery(origin);
    log.info(`fluxer: discovery ok (api endpoint ${client.instance.endpoints.api})`);
  } catch (err) {
    log.warn(
      `fluxer: discovery failed (${err instanceof Error ? err.message : String(err)}); ` +
        `falling back to explicit api ${origin}`,
    );
    client = new Client({ instance: { api: origin } });
  }

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () => rejectReady(new Error('gateway READY not received within 60s')),
      60_000,
    );
    client.once(Events.Ready, () => {
      clearTimeout(timer);
      resolveReady();
    });
  });

  await client.login(token);
  await ready;
  log.info(`fluxer: logged in as ${client.user?.username ?? 'unknown'}`);
  return client;
}

async function resolveGuild(client: Client, guildId: string) {
  if (guildId !== 'auto') {
    return client.guilds.fetch(guildId);
  }
  // "auto": the first guild the bot is in. Guilds can take a few seconds to
  // arrive over the gateway after READY.
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const guild of client.guilds.values()) return guild;
    await sleep(500);
  }
  throw new Error(
    'guildId "auto": bot is not in any guild — invite the bot to your server first',
  );
}

/** Channel types we are willing to post announcements into. */
const ANNOUNCE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText as number,
  ChannelType.GuildAnnouncement as number,
]);

/** Resolve the configured guild+channel into a concrete channel id. */
export async function resolveTarget(client: Client, cfg: AppConfig): Promise<ResolvedTarget> {
  const guild = await resolveGuild(client, cfg.guildId);

  // Numeric channel values are treated as channel IDs.
  if (/^\d+$/.test(cfg.channel)) {
    const channel = await client.channels.fetch(cfg.channel);
    if (!channel.isTextBased()) {
      throw new Error(`channel ${cfg.channel} is not a text-based channel`);
    }
    return { channelId: channel.id, channelName: cfg.channel, guildName: guild.name };
  }

  const channels = await guild.fetchChannels();
  const wanted = cfg.channel.toLowerCase();
  const match = channels.find(
    (channel) =>
      (channel.name ?? '').toLowerCase() === wanted &&
      ANNOUNCE_CHANNEL_TYPES.has(channel.type as number),
  );
  if (!match) {
    const names = channels.map((channel) => channel.name).join(', ');
    throw new Error(
      `channel "${cfg.channel}" not found in guild "${guild.name}". ` +
        `Channels visible to the bot: ${names || '(none)'}`,
    );
  }
  return {
    channelId: match.id,
    channelName: match.name ?? cfg.channel,
    guildName: guild.name,
  };
}
