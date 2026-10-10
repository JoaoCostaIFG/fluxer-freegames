import { fetchJson, normalize, parseUtcDate } from '../util.js';
import { storeDisplayName, type GameGiveaway, type GiveawaySource } from './types.js';

interface GamerPowerGiveaway {
  id?: number;
  title?: string;
  worth?: string;
  thumbnail?: string;
  description?: string;
  open_giveaway_url?: string;
  open_giveaway?: string;
  published_date?: string;
  type?: string;
  platforms?: string;
  end_date?: string | null;
  stores?: string;
}

/**
 * Store detection: check the normalized stores+platforms text for known store
 * names. GamerPower mixes hardware platforms and store names in "platforms"
 * (e.g. "PC, Steam"), so both fields are searched.
 */
const STORE_NEEDLES: ReadonlyArray<readonly [slug: string, needle: string]> = [
  ['epic', 'epicgames'],
  ['steam', 'steam'],
  ['gog', 'gog'],
  ['ubisoft', 'ubisoft'],
  ['itch', 'itchio'],
  ['indiegala', 'indiegala'],
  ['fanatical', 'fanatical'],
  ['alienware', 'alienware'],
];

function detectStore(giveaway: GamerPowerGiveaway): string {
  const haystack = normalize(`${giveaway.stores ?? ''} ${giveaway.platforms ?? ''}`);
  for (const [slug, needle] of STORE_NEEDLES) {
    if (haystack.includes(needle)) return slug;
  }
  return 'other';
}

/** Map raw GamerPower platform tokens to canonical slugs. */
const PLATFORM_NEEDLES: ReadonlyArray<readonly [needle: string, slug: string]> = [
  ['windows', 'pc'],
  ['pc', 'pc'],
  ['mac', 'pc'],
  ['osx', 'pc'],
  ['linux', 'pc'],
  ['android', 'android'],
  ['ios', 'ios'],
  ['iphone', 'ios'],
  ['ps4', 'playstation'],
  ['ps5', 'playstation'],
  ['playstation', 'playstation'],
  ['xbox', 'xbox'],
  ['switch', 'switch'],
  ['nintendo', 'switch'],
  ['vr', 'vr'],
  ['browser', 'browser'],
];

function mapPlatforms(raw: string | undefined): string[] {
  const tokens = (raw ?? '')
    .split(/[,/|]/)
    .map((token) => normalize(token))
    .filter(Boolean);
  const platforms = new Set<string>();
  for (const token of tokens) {
    for (const [needle, slug] of PLATFORM_NEEDLES) {
      if (token.includes(needle)) {
        platforms.add(slug);
        break;
      }
    }
  }
  return [...platforms];
}

function mapType(raw: string | undefined): string {
  switch (normalize(raw ?? '')) {
    case 'game':
      return 'game';
    case 'dlc':
      return 'dlc';
    case 'earlyaccess':
      return 'early-access';
    case 'beta':
      return 'beta';
    case 'alpha':
      return 'alpha';
    case 'demo':
      return 'demo';
    case 'loot':
      return 'loot';
    default:
      return 'other';
  }
}

/** Deals that ended more than this long ago are skipped; the GamerPower
 *  feed lingers on freshly-ended giveaways. */
const ENDED_GRACE_MS = 5 * 60_000;

/**
 * GamerPower aggregates giveaways across many stores (Steam, GOG, itch.io,
 * Ubisoft, IndieGala, Fanatical, Alienware, ...). Epic giveaways are skipped
 * here because EpicSource covers them with richer data.
 */
export class GamerPowerSource implements GiveawaySource {
  readonly id = 'gamerpower' as const;

  async poll(): Promise<GameGiveaway[]> {
    const giveaways = await fetchJson<GamerPowerGiveaway[]>(
      'https://www.gamerpower.com/api/giveaways',
    );

    const out: GameGiveaway[] = [];
    for (const giveaway of giveaways) {
      if (!giveaway.id || !giveaway.title) continue;
      const store = detectStore(giveaway);
      if (store === 'epic') continue;

      const ends = parseUtcDate(giveaway.end_date ?? null);
      if (ends && Date.now() > ends.getTime() + ENDED_GRACE_MS) continue; // already over
      const starts = parseUtcDate(giveaway.published_date ?? null);
      const worth = (giveaway.worth ?? '').trim();

      out.push({
        key: `gp:${giveaway.id}`,
        source: this.id,
        store,
        storeName: storeDisplayName(store),
        title: giveaway.title,
        description: giveaway.description?.trim() || null,
        imageUrl: giveaway.thumbnail || null,
        url: giveaway.open_giveaway || giveaway.open_giveaway_url || 'https://www.gamerpower.com/',
        originalPrice:
          worth && normalize(worth) !== 'na' && normalize(worth) !== '0' ? worth : null,
        startsAt: starts ? starts.toISOString() : null,
        endsAt: ends ? ends.toISOString() : null,
        platforms: mapPlatforms(giveaway.platforms),
        type: mapType(giveaway.type),
      });
    }
    return out;
  }
}
