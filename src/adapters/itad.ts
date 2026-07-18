import { z } from 'zod/v3';
import type { PriceQuote, Store } from '../core/schema';

const LookupSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    game: z.object({ id: z.string().uuid(), title: z.string().min(1) }).passthrough(),
  }),
]);

const MoneySchema = z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) });
const DealSchema = z
  .object({
    shop: z.object({ name: z.string().min(1) }).passthrough(),
    price: MoneySchema,
    regular: MoneySchema.optional(),
    cut: z.number().min(0).max(100).optional(),
    url: z.string().url(),
  })
  .passthrough();
const PricesSchema = z.array(
  z.object({ id: z.string().uuid(), deals: z.array(DealSchema).default([]) }).passthrough(),
);

function isTargetShop(name: string, store: Store): boolean {
  const normalized = name.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/gu, '');
  return store === 'steam'
    ? normalized === 'steam'
    : normalized === 'gog' || normalized === 'gogcom';
}

export interface ItadLookupInput {
  title: string;
  steamAppId?: string;
  targetStore: Store;
  country: string;
  apiKey: string;
}

export async function fetchItadQuote(
  input: ItadLookupInput,
  fetcher: typeof fetch = fetch,
): Promise<PriceQuote | null> {
  const lookupUrl = new URL('https://api.isthereanydeal.com/games/lookup/v1');
  if (input.steamAppId && /^\d+$/u.test(input.steamAppId)) {
    lookupUrl.searchParams.set('appid', input.steamAppId);
  } else {
    lookupUrl.searchParams.set('title', input.title);
  }

  const headers = { 'ITAD-API-Key': input.apiKey };
  const lookupResponse = await fetcher(lookupUrl, { headers });
  if (!lookupResponse.ok) throw new Error(`ITAD lookup failed (${lookupResponse.status})`);
  const lookup = LookupSchema.parse(await lookupResponse.json());
  if (!lookup.found) return null;

  const pricesUrl = new URL('https://api.isthereanydeal.com/games/prices/v3');
  pricesUrl.searchParams.set('country', input.country.toUpperCase());
  pricesUrl.searchParams.set('capacity', '30');
  const pricesResponse = await fetcher(pricesUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify([lookup.game.id]),
  });
  if (!pricesResponse.ok) throw new Error(`ITAD price request failed (${pricesResponse.status})`);
  const prices = PricesSchema.parse(await pricesResponse.json());
  const deal = prices[0]?.deals.find((candidate) =>
    isTargetShop(candidate.shop.name, input.targetStore),
  );
  if (!deal) return null;

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + 12 * 60 * 60 * 1000);
  return {
    provider: 'itad',
    gameTitle: lookup.game.title,
    store: input.targetStore,
    amount: deal.price.amount,
    currency: deal.price.currency,
    regularAmount: deal.regular?.amount,
    discountPercent: deal.cut,
    url: deal.url,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}
