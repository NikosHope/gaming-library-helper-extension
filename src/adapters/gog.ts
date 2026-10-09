import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';
import { requestStoreJson } from './store-request';

const GogProductSchema = z
  .object({
    id: z
      .union([z.string().regex(/^[1-9]\d*$/u), z.number().int().positive().safe()])
      .transform(String),
    title: z.string().trim().min(1),
    // The account endpoint also knows about films and unavailable licenses.
    // Require the observed game/ownership fields instead of inferring them from a title.
    isGame: z.literal(true),
    isMovie: z.literal(false),
    availability: z.object({ isAvailableInAccount: z.literal(true) }),
    url: z.string().optional(),
    isHidden: z.boolean().optional(),
  })
  .passthrough();

const PositiveIntegerSchema = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const NonnegativeIntegerSchema = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);

const GogPageSchema = z
  .object({
    products: z.array(GogProductSchema),
    totalPages: PositiveIntegerSchema.optional(),
    total_pages: PositiveIntegerSchema.optional(),
    page: PositiveIntegerSchema,
    totalProducts: NonnegativeIntegerSchema,
  })
  .passthrough();

const MAX_GOG_PAGES = 200;

function absoluteGogUrl(url: string | undefined, id: string): string {
  const fallback = `https://www.gog.com/account/game/${id}`;
  if (!url) return fallback;
  try {
    const parsed = new URL(url, 'https://www.gog.com');
    if (
      parsed.protocol !== 'https:' ||
      !['www.gog.com', 'gog.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    ) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export async function captureGogSnapshot(fetcher: typeof fetch = fetch): Promise<StoreGameRef[]> {
  const refs: StoreGameRef[] = [];
  const importedAt = new Date().toISOString();
  let totalPages = 1;
  let totalProducts: number | undefined;
  const seenIds = new Set<string>();

  for (let page = 1; page <= totalPages; page += 1) {
    const url = new URL('https://www.gog.com/account/getFilteredProducts');
    url.searchParams.set('mediaType', '1');
    url.searchParams.set('sortBy', 'title');
    url.searchParams.set('page', String(page));

    const parsed = GogPageSchema.safeParse(await requestStoreJson(url, 'GOG', fetcher));
    if (!parsed.success) {
      throw new Error(
        'GOG library response has an unsupported shape. The previous library is unchanged.',
      );
    }
    const reportedPages = parsed.data.totalPages ?? parsed.data.total_pages;
    if (
      reportedPages === undefined ||
      (parsed.data.totalPages !== undefined &&
        parsed.data.total_pages !== undefined &&
        parsed.data.totalPages !== parsed.data.total_pages)
    ) {
      throw new Error(
        'GOG pagination is missing or inconsistent. Retry; the previous library is unchanged.',
      );
    }
    if (reportedPages > MAX_GOG_PAGES) {
      throw new Error(
        `GOG reported ${reportedPages} pages, above the safety limit. The previous library is unchanged.`,
      );
    }
    if (page === 1) {
      totalPages = reportedPages;
      totalProducts = parsed.data.totalProducts;
    } else if (reportedPages !== totalPages || parsed.data.totalProducts !== totalProducts) {
      throw new Error(
        'GOG library changed during pagination. Retry; the previous library is unchanged.',
      );
    }
    if (parsed.data.page !== undefined && parsed.data.page !== page) {
      throw new Error('GOG returned the wrong page. Retry; the previous library is unchanged.');
    }
    if (parsed.data.products.length === 0) {
      throw new Error(
        'GOG returned an empty library page. Check sign-in and retry; the previous library is unchanged.',
      );
    }

    for (const product of parsed.data.products) {
      if (seenIds.has(product.id)) {
        throw new Error(
          'GOG repeated a product during pagination. Retry; the previous library is unchanged.',
        );
      }
      seenIds.add(product.id);
      refs.push({
        store: 'gog',
        storeId: product.id,
        title: product.title,
        titleStatus: 'resolved',
        url: absoluteGogUrl(product.url, product.id),
        owned: true,
        ignoredAtSource: product.isHidden ?? false,
        importedAt,
      });
    }
  }

  if (totalProducts !== undefined && refs.length !== totalProducts) {
    throw new Error(
      'GOG product count does not match its library total. Retry; the previous library is unchanged.',
    );
  }
  return refs.sort((left, right) =>
    left.storeId < right.storeId ? -1 : left.storeId > right.storeId ? 1 : 0,
  );
}
