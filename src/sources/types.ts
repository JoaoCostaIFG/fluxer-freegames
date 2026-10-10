export type SourceId = 'epic' | 'gamerpower';

/** Normalized representation of a free-game giveaway, regardless of origin. */
export interface GameGiveaway {
  /** Stable dedupe key, e.g. "epic:<catalog id>" or "gp:<giveaway id>". */
  key: string;
  source: SourceId;
  /** Canonical store slug: epic, steam, gog, itch, ubisoft, indiegala, ... */
  store: string;
  /** Human-readable store name for embeds. */
  storeName: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  /** Direct claim URL. */
  url: string;
  /** Formatted original price, e.g. "$19.99", or null when unknown. */
  originalPrice: string | null;
  /** ISO timestamp or null. */
  startsAt: string | null;
  /** ISO timestamp or null (null = no known end date). */
  endsAt: string | null;
  /** Platform slugs: pc, android, ios, xbox, playstation, switch, vr, browser. */
  platforms: string[];
  /** Giveaway type slug: game, dlc, early-access, beta, alpha, demo, loot. */
  type: string;
}

export interface GiveawaySource {
  readonly id: SourceId;
  /** Fetch the currently active giveaways. Throws on failure. */
  poll(): Promise<GameGiveaway[]>;
}

const STORE_DISPLAY_NAMES: Record<string, string> = {
  epic: 'Epic Games Store',
  steam: 'Steam',
  gog: 'GOG',
  ubisoft: 'Ubisoft Connect',
  itch: 'itch.io',
  indiegala: 'IndieGala',
  fanatical: 'Fanatical',
  alienware: 'Alienware Arena',
  other: 'Other',
};

export function storeDisplayName(slug: string): string {
  return STORE_DISPLAY_NAMES[slug] ?? slug;
}
