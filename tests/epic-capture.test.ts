import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEpicSnapshot } from '../src/adapters/epic';

// Fictional library records using official/community contract field names; no account data.
const alpha = {
  namespace: 'fictional',
  catalogItemId: 'alpha',
  appName: 'alpha-windows',
  sandboxType: 'PUBLIC',
  catalogItem: {
    id: 'alpha',
    namespace: 'fictional',
    title: 'Sample Alpha',
    categories: [{ path: 'applications' }],
    mainGameItem: null,
  },
};
const beta = {
  ...alpha,
  catalogItemId: 'beta',
  appName: 'beta-windows',
  catalogItem: { ...alpha.catalogItem, id: 'beta', title: 'Sample Beta' },
};
function page(records: unknown[], nextCursor: string | null = null): unknown {
  return { data: { Library: { libraryItems: { records, responseMetadata: { nextCursor } } } } };
}
function fetcher(pages: unknown[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const result = vi.fn<typeof fetch>();
  for (const value of pages) result.mockResolvedValueOnce(Response.json(value));
  return result;
}
function requestBody(init: RequestInit | undefined): {
  query: string;
  variables: { cursor: string | null };
} {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON string request body');
  return JSON.parse(init.body) as {
    query: string;
    variables: { cursor: string | null };
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T02:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('Epic library capture', () => {
  it('collects every cursor page in deterministic provider-ID order with cookie-only reads', async () => {
    const request = fetcher([page([beta], 'page-two'), page([alpha])]);
    const refs = await captureEpicSnapshot(request);
    expect(refs.map((ref) => ref.storeId)).toEqual(['fictional:alpha', 'fictional:beta']);
    expect(refs[0]).toMatchObject({ title: 'Sample Alpha', titleStatus: 'resolved', owned: true });
    const requests = request.mock.calls.map(([url, init]) => {
      expect(url).toBe('https://store.epicgames.com/graphql');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('Cookie')).toBeNull();
      return requestBody(init);
    });
    expect(requests.map((body) => body.variables.cursor)).toEqual([null, 'page-two']);
    expect(requests[0]?.query).toBe(requests[1]?.query);
    expect(requests[0]?.query).not.toMatch(/mutation/u);
    expect(await captureEpicSnapshot(fetcher([page([alpha, beta])]))).toEqual(refs);
  });

  it('deduplicates Windows/Mac assets only when their owned product identity and metadata match', async () => {
    const refs = await captureEpicSnapshot(
      fetcher([page([alpha], 'next'), page([{ ...alpha, appName: 'alpha-mac' }])]),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.storeId).toBe('fictional:alpha');
  });

  it('excludes explicit DLC, demos, extras, software, Unreal assets, and private sandboxes', async () => {
    const excluded = [
      { ...beta, catalogItem: { ...beta.catalogItem, mainGameItem: { id: 'parent' } } },
      ...['addons/dlc', 'games/demo', 'plugins/engine', 'digitalextras', 'software'].map(
        (path, index) => ({
          ...beta,
          appName: 'excluded-' + index,
          catalogItem: { ...beta.catalogItem, categories: [{ path: 'applications' }, { path }] },
        }),
      ),
      {
        ...beta,
        appName: 'unreal',
        namespace: 'ue',
        catalogItem: { ...beta.catalogItem, namespace: 'ue' },
      },
      { ...beta, appName: 'private', sandboxType: 'PRIVATE' },
    ];
    const refs = await captureEpicSnapshot(fetcher([page([alpha, ...excluded])]));
    expect(refs.map((ref) => ref.storeId)).toEqual(['fictional:alpha']);
  });

  it.each([
    { ...alpha, catalogItem: null },
    { ...alpha, catalogItem: { ...alpha.catalogItem, categories: null } },
    { ...alpha, catalogItem: { ...alpha.catalogItem, title: '' } },
    { ...alpha, sandboxType: null },
    { ...alpha, catalogItem: { ...alpha.catalogItem, categories: [{ path: 'unknown/type' }] } },
    {
      ...alpha,
      catalogItem: {
        ...alpha.catalogItem,
        categories: [{ path: 'addons/launchable' }],
        mainGameItem: { id: 'parent' },
      },
    },
  ])(
    'retains unclassified owned products without inventing a confirmed game title',
    async (record) => {
      const refs = await captureEpicSnapshot(fetcher([page([record])]));
      expect(refs[0]).toMatchObject({
        storeId: 'fictional:alpha',
        title: 'Epic item fictional:alpha',
        titleStatus: 'unresolved',
      });
    },
  );

  it.each([
    {},
    { errors: [{ message: 'Not authorized' }], data: null },
    { ...(page([alpha]) as object), errors: [{ message: 'Partial result' }] },
    { data: { Library: { libraryItems: { records: [alpha], responseMetadata: {} } } } },
    page([{ ...alpha, catalogItem: { ...alpha.catalogItem, id: 'different' } }]),
    page([{ ...alpha, namespace: 'evil:ambiguous' }]),
    page([{ ...alpha, catalogItem: { ...alpha.catalogItem, categories: undefined } }]),
  ])(
    'rejects partial GraphQL responses and unverified identity/pagination fields',
    async (value) => {
      await expect(captureEpicSnapshot(fetcher([value]))).rejects.toThrow(
        /previous library is unchanged/u,
      );
    },
  );

  it('deduplicates identical repeated assets within and across pages', async () => {
    const refs = await captureEpicSnapshot(
      fetcher([page([alpha, alpha], 'next'), page([alpha, beta, beta])]),
    );
    expect(refs.map((ref) => ref.storeId)).toEqual(['fictional:alpha', 'fictional:beta']);
  });

  it('rejects changing asset or product metadata across pages', async () => {
    await expect(
      captureEpicSnapshot(
        fetcher([
          page([alpha], 'next'),
          page([{ ...alpha, catalogItem: { ...alpha.catalogItem, title: 'Changed' } }]),
        ]),
      ),
    ).rejects.toThrow(/asset metadata changed/u);
    await expect(
      captureEpicSnapshot(
        fetcher([
          page([alpha], 'next'),
          page([
            {
              ...alpha,
              appName: 'alpha-mac',
              catalogItem: { ...alpha.catalogItem, title: 'Different' },
            },
          ]),
        ]),
      ),
    ).rejects.toThrow(/metadata changed/u);
  });

  it('rejects repeated cursors and empty intermediate pages', async () => {
    await expect(
      captureEpicSnapshot(fetcher([page([alpha], 'next'), page([beta], 'next')])),
    ).rejects.toThrow(/repeated a pagination cursor/u);
    await expect(captureEpicSnapshot(fetcher([page([], 'next')]))).rejects.toThrow(
      /empty intermediate page/u,
    );
  });

  it('does not return a partial snapshot after an expired sign-in on a later page', async () => {
    const request = fetcher([page([alpha], 'next')]);
    request.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(captureEpicSnapshot(request)).rejects.toThrow(/denied access/u);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty library instead of clearing a previous capture', async () => {
    await expect(captureEpicSnapshot(fetcher([page([])]))).rejects.toThrow(/no game entries/u);
  });

  it('keeps an untrusted cursor in JSON variables without changing the read query', async () => {
    const cursor = '" }) } mutation DoNotExecute { anything }';
    const request = fetcher([page([alpha], cursor), page([beta])]);
    await captureEpicSnapshot(request);
    const bodies = request.mock.calls.map(([, init]) => requestBody(init));
    expect(bodies[1]?.query).toBe(bodies[0]?.query);
    expect(bodies[1]?.variables.cursor).toBe(cursor);
  });
});
