import { describe, expect, it, vi } from 'vitest';
import { requestSteamPublicAppInfo } from '../src/adapters/steam-public-metadata';
import { requestSteamCatalog } from '../src/adapters/steam';

const response = (app: unknown) => ({ status: 'success', data: { '10': app } });

describe('public Steam app metadata', () => {
  it('resolves only the independently requested original game ID and omits credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          response({ common: { gameid: '10', name: 'Removed original', type: 'Game' } }),
        ),
      );
    expect(await requestSteamPublicAppInfo(10, fetcher)).toEqual({
      id: 10,
      appid: 10,
      item_type: 0,
      success: 1,
      type: 0,
      name: 'Removed original',
    });
    const [input, init] = fetcher.mock.calls[0]!;
    expect(input).toBe('https://api.steamcmd.net/v1/info/10');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('Cookie')).toBeNull();
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  it.each([
    {},
    { common: { name: 'Not evidence', type: 'Game' } },
    { common: { gameid: '10', name: 'Unknown classification', type: 'NewFutureType' } },
    { common: { gameid: '10', name: 'Unknown classification', type: 'constructor' } },
    { common: { gameid: '10', type: 'Game' } },
  ])('keeps unavailable or unclassified metadata unresolved', async (app) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response(app)));
    expect(await requestSteamPublicAppInfo(10, fetcher)).toEqual({
      id: 10,
      item_type: 0,
      success: 2,
    });
  });

  it.each([
    ['DLC', 4],
    ['Config', 13],
    ['Tool', 13],
    ['Music', 11],
    ['Video', 7],
  ])('classifies a confirmed %s without inventing a game title', async (type, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(response({ appid: 10, common: { type } })));
    expect(await requestSteamPublicAppInfo(10, fetcher)).toMatchObject({
      id: 10,
      success: 1,
      type: expected,
    });
  });

  it.each([
    {
      status: 'success',
      data: { '999': { common: { gameid: '999', name: 'Another game', type: 'game' } } },
    },
    response({ common: { gameid: '999', name: 'Another game', type: 'game' } }),
    response({ appid: 999, common: { gameid: '10', name: 'Another game', type: 'game' } }),
    { status: 'success', data: { '10': {}, '20': {} } },
    { status: 'error', data: 'unavailable' },
  ])('rejects changed or substituted metadata', async (data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
    await expect(requestSteamPublicAppInfo(10, fetcher)).rejects.toThrow(/metadata/u);
  });

  it('does not fetch invalid IDs', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(requestSteamPublicAppInfo(id, fetcher)).rejects.toThrow(/Invalid/u);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enriches only unavailable catalog IDs and keeps request order with at most four concurrent reads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        response: {
          store_items: [
            { id: 1, appid: 1, item_type: 0, success: 1, type: 0, name: 'Available' },
            ...Array.from({ length: 9 }, (_, i) => ({ id: i + 2, item_type: 0, success: 15 })),
          ],
        },
      }),
    );
    let active = 0;
    let maximum = 0;
    const read = vi.fn(async (id: number) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return {
        id,
        appid: id,
        item_type: 0 as const,
        success: 1,
        type: id === 2 ? 4 : 0,
        name: 'Original ' + id,
      };
    });
    const catalog = await requestSteamCatalog(
      Array.from({ length: 10 }, (_, i) => i + 1),
      fetcher,
      read,
    );
    expect(read.mock.calls.map(([id]) => id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(maximum).toBe(4);
    expect(catalog.response.store_items.map((item) => item.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(catalog.response.store_items[1]?.type).toBe(4);
  });
});
