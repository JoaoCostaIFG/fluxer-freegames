import type { EpicConfig } from '../config.js';
import { fetchJson, parseUtcDate } from '../util.js';
import { storeDisplayName, type GameGiveaway, type GiveawaySource } from './types.js';

interface EpicPromotionalOffer {
  startDate?: string;
  endDate?: string;
  discountSetting?: { discountPercentage?: string | number };
}

interface EpicElement {
  id?: string;
  title?: string;
  description?: string;
  productSlug?: string;
  urlSlug?: string;
  catalogNs?: { mappings?: Array<{ pageType?: string; pageSlug?: string }> };
  keyImages?: Array<{ type?: string; url?: string }>;
  promotions?: { promotionalOffers?: Array<{ promotionalOffers?: EpicPromotionalOffer[] }> };
  price?: { totalPrice?: { fmtPrice?: { originalPrice?: string } } };
}

interface EpicResponse {
  data?: { Catalog?: { searchStore?: { elements?: EpicElement[] } } };
}

/** Preference order for the banner image attached to announcements. */
const IMAGE_TYPE_PRIORITY = [
  'DieselStoreFrontWide',
  'OfferImageWide',
  'DieselGameBoxWide',
  'DieselGameBoxTall',
  'DieselGameBox',
  'Thumbnail',
];

function pickImage(images: EpicElement['keyImages']): string | null {
  if (!images?.length) return null;
  for (const type of IMAGE_TYPE_PRIORITY) {
    const match = images.find((image) => image.type === type && image.url);
    if (match?.url) return match.url;
  }
  return images.find((image) => image.url)?.url ?? null;
}

/** The active 100%-off promotional offer for this element, if any. */
function currentFreeOffer(element: EpicElement): EpicPromotionalOffer | null {
  const offers =
    element.promotions?.promotionalOffers?.flatMap((group) => group.promotionalOffers ?? []) ?? [];
  const now = Date.now();
  return (
    offers.find((offer) => {
      if (Number(offer.discountSetting?.discountPercentage ?? 100) !== 0) return false;
      const start = parseUtcDate(offer.startDate ?? null);
      const end = parseUtcDate(offer.endDate ?? null);
      if (start && now < start.getTime() - 5 * 60_000) return false;
      if (end && now > end.getTime() + 5 * 60_000) return false;
      return true;
    }) ?? null
  );
}

/** Epic Games Store weekly free games, straight from Epic's public catalog API. */
export class EpicSource implements GiveawaySource {
  readonly id = 'epic' as const;

  constructor(private readonly cfg: EpicConfig) {}

  async poll(): Promise<GameGiveaway[]> {
    const url =
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions' +
      `?locale=${encodeURIComponent(this.cfg.locale)}&country=${encodeURIComponent(this.cfg.country)}`;
    const json = await fetchJson<EpicResponse>(url);
    const elements = json.data?.Catalog?.searchStore?.elements ?? [];

    const giveaways: GameGiveaway[] = [];
    for (const element of elements) {
      if (!element.id || !element.title) continue;
      const offer = currentFreeOffer(element);
      if (!offer) continue;

      const slug =
        element.productSlug ||
        element.urlSlug ||
        element.catalogNs?.mappings?.find((mapping) => mapping.pageType === 'productHome')
          ?.pageSlug ||
        null;
      const claimUrl = slug
        ? `https://store.epicgames.com/${this.cfg.locale}/p/${slug.replace(/\/home$/i, '')}`
        : 'https://store.epicgames.com/free-games';

      const formatted = element.price?.totalPrice?.fmtPrice?.originalPrice?.trim();
      const originalPrice =
        formatted && formatted !== '0' && formatted.toLowerCase() !== 'free' ? formatted : null;

      const starts = parseUtcDate(offer.startDate ?? null);
      const ends = parseUtcDate(offer.endDate ?? null);

      giveaways.push({
        key: `epic:${element.id}`,
        source: this.id,
        store: 'epic',
        storeName: storeDisplayName('epic'),
        title: element.title,
        description: element.description?.trim() || null,
        imageUrl: pickImage(element.keyImages),
        url: claimUrl,
        originalPrice,
        startsAt: starts ? starts.toISOString() : null,
        endsAt: ends ? ends.toISOString() : null,
        platforms: ['pc'],
        type: 'game',
      });
    }
    return giveaways;
  }
}
