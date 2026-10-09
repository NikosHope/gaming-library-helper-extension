import { isPrimaryRef } from '../src/core/products';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureGogSnapshot } from '../src/adapters/gog';
import { captureSteamSnapshot, requestSteamCatalog } from '../src/adapters/steam';
import { createDefaultState } from '../src/core/defaults';
import { replaceStoreSnapshot } from '../src/core/library';
import { GOG_PAGES, STEAM_ITEMS, STEAM_OWNERSHIP } from './fixtures/store-responses';

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input);
}

const now = '2026-10-07T20:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
});
afterEach(() => vi.useRealTimers());

function gogFetcher(pages: unknown[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetcher = vi.fn<typeof fetch>();
  for (const page of pages) fetcher.mockResolvedValueOnce(Response.json(page));
  return fetcher;
}

describe('GOG snapshot capture', () => {
  it('collects all pages in canonical ID order and produces repeatable records', async () => {
    const fetcher = gogFetcher(GOG_PAGES);
    const refs = await captureGogSnapshot(fetcher);
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20', '30']);
    expect(refs[2]).toMatchObject({ ignoredAtSource: true, importedAt: now });
    expect(fetcher.mock.calls.map(([url]) => requestUrl(url).searchParams.get('page'))).toEqual([
      '1',
      '2',
    ]);
    expect(await captureGogSnapshot(gogFetcher(GOG_PAGES))).toEqual(refs);
  });

  it.each([
    [{ ...GOG_PAGES[0], totalPages: undefined }, /pagination/u],
    [{ ...GOG_PAGES[0], totalPages: 201 }, /safety limit/u],
    [{ ...GOG_PAGES[0], totalPages: true }, /unsupported shape/u],
    [{ ...GOG_PAGES[0], totalProducts: false }, /unsupported shape/u],
    [{ ...GOG_PAGES[0], total_pages: 3 }, /inconsistent/u],
    [{ ...GOG_PAGES[0], products: [] }, /empty library page/u],
    [{ ...GOG_PAGES[0], page: 2 }, /wrong page/u],
    [
      { ...GOG_PAGES[0], products: [{ ...GOG_PAGES[0]!.products[0], id: '' }] },
      /unsupported shape/u,
    ],
    [{ ...GOG_PAGES[0], page: undefined }, /unsupported shape/u],
    [{ ...GOG_PAGES[0], totalProducts: undefined }, /unsupported shape/u],
    [
      { ...GOG_PAGES[0], products: [{ ...GOG_PAGES[0]!.products[0], isGame: false }] },
      /unsupported shape/u,
    ],
    [
      {
        ...GOG_PAGES[0],
        products: [{ ...GOG_PAGES[0]!.products[0], availability: { isAvailableInAccount: false } }],
      },
      /unsupported shape/u,
    ],
  ])('rejects incomplete or unsafe first pages', async (page, message) => {
    const fetcher = gogFetcher([page]);
    await expect(captureGogSnapshot(fetcher)).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...GOG_PAGES[1], totalPages: 1 }, /changed during pagination/u],
    [{ ...GOG_PAGES[1], totalProducts: 4 }, /changed during pagination/u],
    [{ ...GOG_PAGES[1], page: 1 }, /wrong page/u],
    [{ ...GOG_PAGES[1], products: [] }, /empty library page/u],
    [{ ...GOG_PAGES[1], products: [{ ...GOG_PAGES[0]!.products[1] }] }, /repeated a product/u],
    [
      {
        ...GOG_PAGES[1],
        products: [{ ...GOG_PAGES[1]!.products[0] }, { ...GOG_PAGES[1]!.products[0], id: 40 }],
      },
      /count does not match/u,
    ],
  ])('rejects changed, repeated, or truncated pagination', async (page, message) => {
    await expect(captureGogSnapshot(gogFetcher([GOG_PAGES[0], page]))).rejects.toThrow(message);
  });

  it('does not commit any partial results when a later page fails', async () => {
    const refs = await captureGogSnapshot(gogFetcher(GOG_PAGES));
    const current = replaceStoreSnapshot(createDefaultState(), {
      store: 'gog',
      refs,
      syncedAt: now,
    }).state;
    const before = structuredClone(current);
    const fetcher = gogFetcher([GOG_PAGES[0]]);
    fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(
      (async () => {
        const partial = await captureGogSnapshot(fetcher);
        return replaceStoreSnapshot(current, { store: 'gog', refs: partial, syncedAt: now });
      })(),
    ).rejects.toThrow(/denied access/u);
    expect(current).toEqual(before);
  });

  it.each([
    'javascript:alert(1)',
    'https://other.example/game',
    'http://www.gog.com/game',
    'https://user:password@www.gog.com/game',
  ])('replaces unsafe product links with a provider-ID link', async (url) => {
    const refs = await captureGogSnapshot(
      gogFetcher([
        {
          totalPages: 1,
          totalProducts: 1,
          page: 1,
          products: [{ ...GOG_PAGES[0]!.products[1], url }],
        },
      ]),
    );
    expect(refs[0]?.url).toBe('https://www.gog.com/account/game/10');
  });
});

describe('Steam snapshot capture', () => {
  function steamFetcher(
    ownership: unknown = STEAM_OWNERSHIP,
    items: unknown[] = STEAM_ITEMS,
  ): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      return Promise.resolve(
        Response.json(
          url.pathname.includes('userdata') ? ownership : { response: { store_items: items } },
        ),
      );
    });
  }

  it('joins only owned IDs to batched metadata regardless of response order', async () => {
    const fetcher = steamFetcher();
    const refs = await captureSteamSnapshot(fetcher);
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20']);
    expect(refs[0]?.title).toBe('Sample Alpha');
    expect(refs[1]?.ignoredAtSource).toBe(true);
    const input = JSON.parse(
      requestUrl(fetcher.mock.calls[1]![0]).searchParams.get('input_json')!,
    ) as { ids: unknown[] };
    expect(input.ids).toEqual([{ appid: 10 }, { appid: 20 }]);
    expect(fetcher.mock.calls[0]![1]?.credentials).toBe('include');
    expect(fetcher.mock.calls[1]![1]?.credentials).toBe('omit');
    expect(await captureSteamSnapshot(steamFetcher())).toEqual(refs);
  });

  it('accepts the observed empty ignore array without treating array indexes as app IDs', async () => {
    const refs = await captureSteamSnapshot(
      steamFetcher({ rgOwnedApps: [10, 20], rgIgnoredApps: [] }),
    );
    expect(refs.every((ref) => !ref.ignoredAtSource)).toBe(true);
    await expect(
      captureSteamSnapshot(steamFetcher({ rgOwnedApps: [10, 20], rgIgnoredApps: [20] })),
    ).rejects.toThrow(/unsupported shape/u);
  });

  it('preserves components and tools separately from restricted IDs', async () => {
    const items = [
      STEAM_ITEMS[1],
      { id: 20, item_type: 0, appid: 0, success: 15, name: 'Do not infer this title' },
      ...[1, 4, 6, 11].map((type, i) => ({
        id: 30 + i,
        appid: 30 + i,
        item_type: 0,
        success: 1,
        type,
        name: 'Non-game',
      })),
    ];
    const refs = await captureSteamSnapshot(
      steamFetcher({ rgOwnedApps: [10, 20, 30, 31, 32, 33] }, items),
    );
    expect(refs).toHaveLength(6);
    expect(refs.slice(2).map((ref) => ref.classification?.kind)).toEqual([
      'component',
      'component',
      'tool',
      'auxiliary',
    ]);
    expect(refs[1]).toMatchObject({
      storeId: '20',
      title: 'Steam app 20',
      titleStatus: 'unresolved',
      owned: true,
    });
  });

  it('keeps Valve mods, betas, media and advertising out of primary game ownership', async () => {
    const types = [2, 12, 3, 5, 7, 8, 9, 10, 13, 14, 99];
    const items = [
      STEAM_ITEMS[1]!,
      ...types.map((type, index) => ({
        id: 20 + index,
        appid: 20 + index,
        item_type: 0,
        success: 1,
        type,
        name: `Named product ${index}`,
      })),
    ];
    const refs = await captureSteamSnapshot(
      steamFetcher({ rgOwnedApps: items.map((item) => item.id) }, items),
    );
    expect(refs.map((ref) => ref.storeId)).toEqual(items.map((item) => String(item.id)));
    expect(refs.slice(1).every((ref) => ref.titleStatus === 'resolved')).toBe(true);
    expect(refs[1]).toMatchObject({
      classification: { kind: 'component', componentType: 'other' },
    });
    expect(refs[2]).toMatchObject({ classification: { kind: 'component', componentType: 'beta' } });
    expect(refs.slice(3, 9).every((ref) => ref.classification?.kind === 'auxiliary')).toBe(true);
    expect(refs[9]).toMatchObject({ classification: { kind: 'tool' } });
    expect(refs[10]).toMatchObject({ classification: { kind: 'auxiliary' } });
    expect(refs[11]).toMatchObject({ classification: { kind: 'unknown' } });
    expect(refs.filter(isPrimaryRef).map((ref) => ref.storeId)).toEqual(['10']);
    expect(refs.slice(1).every((ref) => !ref.classification?.parent)).toBe(true);
  });

  it('collects every metadata batch for a large library', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => i + 1);
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('userdata'))
        return Promise.resolve(Response.json({ rgOwnedApps: ids }));
      const data = JSON.parse(url.searchParams.get('input_json')!) as { ids: { appid: number }[] };
      return Promise.resolve(
        Response.json({
          response: {
            store_items: data.ids.map(({ appid }) => ({
              id: appid,
              appid,
              item_type: 0,
              success: 1,
              type: 0,
              name: 'Game ' + appid,
            })),
          },
        }),
      );
    });
    const refs = await captureSteamSnapshot(fetcher);
    expect(refs).toHaveLength(205);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(refs[204]).toMatchObject({ storeId: '205', title: 'Game 205', titleStatus: 'resolved' });
  });

  it('does not require a game title for a confirmed non-game item', async () => {
    const refs = await captureSteamSnapshot(
      steamFetcher(STEAM_OWNERSHIP, [
        STEAM_ITEMS[1],
        { id: 20, item_type: 0, appid: 0, success: 1, type: 13, name: '' },
      ]),
    );
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20']);
    expect(refs[1]).toMatchObject({ titleStatus: 'unresolved', classification: { kind: 'tool' } });
  });

  it('stops before another batch after the metadata budget expires', async () => {
    const ids = Array.from({ length: 105 }, (_, i) => i + 1);
    const reader = vi.fn((appIds: number[]) => {
      vi.setSystemTime(new Date(Date.now() + 121_000));
      return Promise.resolve({
        response: {
          store_items: appIds.map((appid) => ({
            id: appid,
            appid,
            item_type: 0,
            success: 1,
            type: 0,
            name: 'Game ' + appid,
          })),
        },
      });
    });
    await expect(captureSteamSnapshot(steamFetcher({ rgOwnedApps: ids }), reader)).rejects.toThrow(
      /metadata took too long/u,
    );
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('strips unrelated catalog fields before responding to a content script', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        response: {
          store_items: STEAM_ITEMS.map((item) => ({ ...item, unrelated: 'not forwarded' })),
          unrelated: true,
        },
        unrelated: true,
      }),
    );
    expect(await requestSteamCatalog([10, 20], fetcher)).toEqual({
      response: { store_items: STEAM_ITEMS },
    });
  });

  it('resolves a storefront alias only from the original owned app record', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ rgOwnedApps: [10] }))
      .mockResolvedValueOnce(
        Response.json({
          response: {
            store_items: [
              { id: 10, item_type: 0, appid: 999, success: 1, type: 0, name: 'Destination' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          '10': { success: true, data: { steam_appid: 10, type: 'game', name: 'Original' } },
        }),
      );
    const refs = await captureSteamSnapshot(fetcher);
    expect(refs[0]).toMatchObject({ storeId: '10', title: 'Original', titleStatus: 'resolved' });
    const [url, init] = fetcher.mock.calls[2]!;
    expect(requestUrl(url).origin).toBe('https://store.steampowered.com');
    expect(requestUrl(url).pathname).toBe('/api/appdetails');
    expect(requestUrl(url).searchParams.get('appids')).toBe('10');
    expect(requestUrl(url).searchParams.get('filters')).toBe('basic');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('Cookie')).toBeNull();
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  it.each([
    { success: false },
    { success: true, data: { steam_appid: 10, type: 'unknown', name: 'Unknown' } },
    { success: true, data: { steam_appid: 999, type: 'game', name: 'Destination' } },
  ])(
    'retains an unavailable or unclassified original app without claiming its redirect destination',
    async (details) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ rgOwnedApps: [10] }))
        .mockResolvedValueOnce(
          Response.json({
            response: {
              store_items: [
                { id: 10, item_type: 0, appid: 999, success: 1, type: 0, name: 'Destination' },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(Response.json({ '10': details }));
      const refs = await captureSteamSnapshot(fetcher);
      expect(refs[0]).toMatchObject({
        storeId: '10',
        title: 'Steam app 10',
        titleStatus: 'unresolved',
      });
    },
  );

  it('keeps the original DLC ID without owning the redirect game', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ rgOwnedApps: [10, 20] }))
      .mockResolvedValueOnce(
        Response.json({
          response: {
            store_items: [
              STEAM_ITEMS[1],
              { id: 20, item_type: 0, appid: 999, success: 1, type: 0, name: 'Destination' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          '20': { success: true, data: { steam_appid: 20, type: 'dlc', name: 'Extra' } },
        }),
      );
    const refs = await captureSteamSnapshot(fetcher);
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20']);
    expect(refs[1]).toMatchObject({
      title: 'Extra',
      classification: { kind: 'component', componentType: 'dlc' },
    });
  });

  it.each([
    {},
    { '10': { success: true, data: { steam_appid: 888, type: 'game', name: 'Destination' } } },
    { '10': { success: true, data: { steam_appid: 10, type: 'game' } } },
  ])('rejects incomplete or conflicting original-app metadata', async (details) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          response: {
            store_items: [
              { id: 10, item_type: 0, appid: 999, success: 1, type: 0, name: 'Destination' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(Response.json(details));
    await expect(requestSteamCatalog([10], fetcher)).rejects.toThrow(/inconsistent/u);
  });

  it.each([
    [STEAM_ITEMS.slice(0, 1), /incomplete metadata/u],
    [[STEAM_ITEMS[0], STEAM_ITEMS[0]], /inconsistent/u],
    [[STEAM_ITEMS[0], { ...STEAM_ITEMS[1], id: 999 }], /inconsistent/u],
    [[STEAM_ITEMS[0], { ...STEAM_ITEMS[1], appid: 999 }], /inconsistent/u],
    [[STEAM_ITEMS[0], { ...STEAM_ITEMS[1], type: undefined }], /inconsistent/u],
    [[STEAM_ITEMS[0], { ...STEAM_ITEMS[1], name: ' ' }], /inconsistent/u],
    [[STEAM_ITEMS[0], { ...STEAM_ITEMS[1], item_type: 1 }], /incomplete metadata/u],
  ])('rejects incomplete, duplicated, or mismatched catalog responses', async (items, message) => {
    await expect(captureSteamSnapshot(steamFetcher(STEAM_OWNERSHIP, items))).rejects.toThrow(
      message,
    );
  });

  it('preserves the previous snapshot when metadata is rate limited', async () => {
    const current = replaceStoreSnapshot(createDefaultState(), {
      store: 'steam',
      refs: await captureSteamSnapshot(steamFetcher()),
      syncedAt: now,
    }).state;
    const before = structuredClone(current);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(STEAM_OWNERSHIP))
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
    await expect(
      (async () => {
        const refs = await captureSteamSnapshot(fetcher);
        return replaceStoreSnapshot(current, { store: 'steam', refs, syncedAt: now });
      })(),
    ).rejects.toThrow(/temporarily unavailable/u);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(current).toEqual(before);
  });

  it('preserves an owned library containing only components without inventing games', async () => {
    const refs = await captureSteamSnapshot(
      steamFetcher(
        STEAM_OWNERSHIP,
        STEAM_ITEMS.map((item) => ({ ...item, type: 4 })),
      ),
    );
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20']);
    expect(refs.every((ref) => ref.classification?.kind === 'component')).toBe(true);
  });

  it.each([
    { rgOwnedApps: [], rgIgnoredApps: [] },
    { rgOwnedApps: ['bad'] },
    { rgOwnedApps: [true] },
    {},
  ])(
    'rejects empty or malformed ownership instead of clearing the old snapshot',
    async (ownership) => {
      await expect(captureSteamSnapshot(steamFetcher(ownership))).rejects.toThrow(
        /previous library is unchanged/u,
      );
    },
  );
});
