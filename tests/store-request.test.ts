import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestStoreJson, StoreRequestError } from '../src/adapters/store-request';

describe('bounded store requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('retries a temporary failure and uses the browser session without reading credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ products: [] }));
    const operation = requestStoreJson(
      'https://www.gog.com/account/getFilteredProducts',
      'GOG',
      fetcher,
    );
    await vi.runAllTimersAsync();
    await expect(operation).resolves.toEqual({ products: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  });

  it.each([401, 403])('does not retry access rejection %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    await expect(requestStoreJson('https://www.gog.com/', 'GOG', fetcher)).rejects.toMatchObject({
      kind: 'access-required',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After without bypassing a long rate limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', {
        status: 429,
        headers: { 'Retry-After': '600' },
      }),
    );
    await expect(requestStoreJson('https://www.gog.com/', 'GOG', fetcher)).rejects.toMatchObject({
      kind: 'rate-limited',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('waits for a short Retry-After before retrying', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const operation = requestStoreJson('https://www.gog.com/', 'GOG', fetcher);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(operation).resolves.toEqual({ ok: true });
  });

  it('bounds failed network retries and does not echo page-controlled error text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-private-value'));
    const operation = requestStoreJson('https://www.gog.com/', 'GOG', fetcher).catch(
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = await operation;
    expect(error).toBeInstanceOf(StoreRequestError);
    expect(error).toMatchObject({ kind: 'network' });
    expect(String(error)).not.toContain('synthetic-private-value');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('aborts hung fetches within the request timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const operation = requestStoreJson('https://www.gog.com/', 'GOG', fetcher).catch(
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await operation).toMatchObject({ kind: 'network' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(Date.now()).toBe(Date.parse('2026-10-07T20:00:00Z') + 48_000);
  });

  it.each([
    new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('not json', { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects login pages and malformed bodies without retrying', async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(requestStoreJson('https://www.gog.com/', 'GOG', fetcher)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
