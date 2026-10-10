import { EmbedBuilder } from '@fluxerjs/core';
import type { GameGiveaway } from './sources/types.js';
import { formatUtcDate, truncate } from './util.js';

const COLOR_FREE = 0x57f287; // green
const FOOTER_TEXT = 'FreeGames';

/** Build the announcement embed for one giveaway. */
export function buildAnnouncementEmbed(giveaway: GameGiveaway): EmbedBuilder {
  const parts: string[] = [];
  if (giveaway.description) parts.push(truncate(giveaway.description, 300));
  parts.push(giveaway.originalPrice ? `~~${giveaway.originalPrice}~~ **FREE**` : '**FREE**');

  const embed = new EmbedBuilder()
    .setColor(COLOR_FREE)
    .setAuthor({ name: `${giveaway.storeName} — 100% off` })
    .setTitle(truncate(giveaway.title, 250))
    .setURL(giveaway.url)
    .setDescription(parts.join('\n\n'))
    .addFields({
      name: 'Free until',
      value: giveaway.endsAt ? formatUtcDate(new Date(giveaway.endsAt)) : 'unknown',
      inline: true,
    })
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
  return embed;
}
