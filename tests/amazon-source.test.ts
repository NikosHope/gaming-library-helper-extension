import { describe, expect, it, vi } from 'vitest';
import {
  readAmazonEntitlements,
  summarizeAmazonSource,
  diagnoseAmazonSource,
  captureAmazonSnapshot,
} from '../src/adapters/amazon';
import appLibrary from './fixtures/amazon-app-library.json';
const row = {
  id: 'fictional-license',
  state: 'ACTIVE',
  product: { id: 'fictional-game', title: 'Fictional Game', type: 'Game', productLine: 'Games' },
};
describe('Amazon distribution source', () => {
  it('follows every cursor, strips extra data, and sends credentials only to the fixed Amazon endpoint', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          entitlements: [{ ...row, private_extra: 'not-retained' }],
          nextToken: 'page-two',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          entitlements: [
            {
              ...row,
              id: 'fictional-second',
              product: { ...row.product, id: 'fictional-second-game' },
            },
          ],
          nextToken: null,
        }),
      );
    const rows = await readAmazonEntitlements('synthetic-access', fetcher);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('private_extra');
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://gaming.amazon.com/api/distribution/entitlements');
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('x-amzn-token')).toBe('synthetic-access');
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    }
    const summary = await summarizeAmazonSource(rows);
    expect(summary.products).toBe(2);
    expect(JSON.stringify(summary)).not.toContain('Fictional Game');
    expect(JSON.stringify(summary)).not.toContain('fictional-license');
  });
  it.each([
    { entitlements: [], nextToken: null },
    { entitlements: [row], nextToken: 123 },
    { entitlements: [{ ...row, product: { id: 'fictional-game' } }], nextToken: null },
  ])('rejects empty or incomplete library data', async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(readAmazonEntitlements('synthetic', fetcher)).rejects.toThrow(/Amazon Games/u);
  });
  it('rejects repeated cursors and conflicting repeated licenses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ entitlements: [row], nextToken: 'repeated' })),
      );
    await expect(readAmazonEntitlements('synthetic', fetcher)).rejects.toThrow(/pagination/u);
    const changed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ entitlements: [row], nextToken: 'two' }))
      .mockResolvedValueOnce(
        Response.json({ entitlements: [{ ...row, state: 'REVOKED' }], nextToken: null }),
      );
    await expect(readAmazonEntitlements('synthetic', changed)).rejects.toThrow(/conflicting/u);
  });

  it('counts untrusted state/type names without inherited-object values', async () => {
    const summary = await summarizeAmazonSource([
      { ...row, state: '__proto__', product: { ...row.product, type: 'constructor' } },
      { ...row, state: '__proto__', product: { ...row.product, type: 'constructor' } },
    ]);
    expect(Object.hasOwn(summary.states, '__proto__')).toBe(true);
    expect(summary.states.__proto__).toBe(2);
    expect(summary.types.constructor).toBe(2);
    expect(Object.getPrototypeOf(summary.states)).toBe(Object.prototype);
  });
});

describe('Amazon app library capture', () => {
  it('accepts the observed live response with omitted type and terminal cursor', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(appLibrary));
    const refs = await captureAmazonSnapshot('synthetic-access', fetcher);
    expect(refs).toMatchObject([
      {
        store: 'amazon',
        storeId: 'fictional-app-product',
        title: 'Fictional App Game',
        titleStatus: 'resolved',
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('excludes external entitlements and non-live licenses, deduplicating product IDs', async () => {
    const live = appLibrary.entitlements[0]!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        entitlements: [
          live,
          { ...live, id: 'second-license' },
          {
            ...live,
            id: 'external-license',
            product: {
              ...live.product,
              id: 'other-store-code',
              productLine: 'Twitch:FuelEntitlement',
            },
          },
          {
            ...live,
            id: 'revoked-license',
            state: 'REVOKED',
            product: { ...live.product, id: 'revoked-game' },
          },
        ],
      }),
    );
    expect(await captureAmazonSnapshot('synthetic-access', fetcher)).toHaveLength(1);
  });
  it('rejects conflicting product titles and unknown live product categories', async () => {
    const live = appLibrary.entitlements[0]!;
    for (const entitlements of [
      [live, { ...live, id: 'second', product: { ...live.product, title: 'Conflicting Title' } }],
      [{ ...live, product: { ...live.product, productLine: 'Unknown:Category' } }],
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ entitlements }));
      await expect(captureAmazonSnapshot('synthetic-access', fetcher)).rejects.toThrow(
        /saved library is unchanged/u,
      );
    }
  });
});

it('reports only schema/category diagnostics, excluding identity, titles and credentials', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      entitlements: [
        {
          id: 'synthetic-private-license',
          state: 'Entitled',
          product: {
            id: 'synthetic-private-product',
            title: 'Synthetic Private Title',
            type: 'Game',
          },
        },
      ],
      customer: 'synthetic-private-customer',
    }),
  );
  const result = await diagnoseAmazonSource('synthetic-private-token', fetcher);
  expect(result).toMatchObject({
    schemaAccepted: false,
    pageEntries: 1,
    nextTokenPresent: false,
    states: { Entitled: 1 },
    types: { Game: 1 },
  });
  expect(result.issues).toContain('entitlements.[].product.productLine:invalid_type');
  expect(JSON.stringify(result)).not.toContain('synthetic-private');
  expect(JSON.stringify(result)).not.toContain('Synthetic Private Title');
});
