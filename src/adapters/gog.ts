import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';

const GogProductSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().min(1),
    url: z.string().optional(),
    isHidden: z.boolean().optional(),
  })
  .passthrough();

const GogPageSchema = z
  .object({
    products: z.array(GogProductSchema),
    totalPages: z.coerce.number().int().positive().optional(),
    total_pages: z.coerce.number().int().positive().optional(),
  })
  .passthrough();

const MAX_GOG_PAGES = 200;

function absoluteGogUrl(url: string | undefined, id: string): string {
  if (!url) return `https://www.gog.com/account/game/${id}`;
  return new URL(url, 'https://www.gog.com').toString();
}

export async function captureGogSnapshot(fetcher: typeof fetch = fetch): Promise<StoreGameRef[]> {
  const refs: StoreGameRef[] = [];
  const importedAt = new Date().toISOString();
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_GOG_PAGES; page += 1) {
    const url = new URL('https://www.gog.com/account/getFilteredProducts');
    url.searchParams.set('mediaType', '1');
    url.searchParams.set('sortBy', 'title');
    url.searchParams.set('page', String(page));
    const response = await fetcher(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`GOG library request failed (${response.status})`);

    const parsed = GogPageSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('GOG library response has an unsupported shape');
    totalPages = parsed.data.totalPages ?? parsed.data.total_pages ?? 1;

    for (const product of parsed.data.products) {
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

  if (refs.length === 0) {
    throw new Error('GOG returned no games. Open your GOG account page, sign in, then retry.');
  }
  if (totalPages > MAX_GOG_PAGES) {
    throw new Error(`GOG reported ${totalPages} pages, above the safety limit`);
  }

  return refs;
}
