import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AmazonPending } from '../src/adapters/amazon-auth';
const mocks = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn((key: string) => Promise.resolve({ [key]: structuredClone(data[key]) })),
    set: vi.fn((value: Record<string, unknown>) => {
      Object.assign(data, structuredClone(value));
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      delete data[key];
      return Promise.resolve();
    }),
  });
  return {
    local,
    session,
    api: {
      storage: { local: area(local), session: area(session) },
      permissions: { contains: vi.fn(() => Promise.resolve(true)) },
      tabs: {
        create: vi.fn(() => Promise.resolve({ id: 42 })),
        update: vi.fn(() => Promise.resolve({ id: 42 })),
        onUpdated: {},
      },
      runtime: {
        getURL: (path: string) => 'moz-extension://fictional/' + path.replace(/^\//u, ''),
      },
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: mocks.api }));
const credentialKey = 'gaming-library-helper/amazon-credential';
const pendingKey = 'gaming-library-helper/amazon-auth-pending';
const outcomeKey = 'gaming-library-helper/amazon-auth-outcome';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const table of [mocks.local, mocks.session])
    for (const key of Object.keys(table)) delete table[key];
  mocks.api.permissions.contains.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Amazon background authorization', () => {
  it('shares an overlapping sign-in start and keeps PKCE state in session storage only', async () => {
    const { startAmazonAuth } = await import('../src/background/amazon-auth');
    const first = startAmazonAuth();
    expect(startAmazonAuth()).toBe(first);
    await first;
    expect(mocks.api.tabs.create).toHaveBeenCalledTimes(1);
    expect(mocks.session[pendingKey]).toMatchObject({ version: 1, tabId: 42 });
    expect(mocks.local).toEqual({});
  });

  it('returns only connection status and refuses unsupported existing credentials', async () => {
    const { amazonAuthStatus, startAmazonAuth } = await import('../src/background/amazon-auth');
    mocks.local[credentialKey] = {
      version: 1,
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
    };
    expect(await amazonAuthStatus()).toEqual({ connected: true, waiting: false, failed: false });
    mocks.local[credentialKey] = { version: 2, unknown: 'preserved' };
    await expect(startAmazonAuth()).rejects.toThrow(/preserved/u);
    expect(mocks.local[credentialKey]).toEqual({ version: 2, unknown: 'preserved' });
    expect(mocks.api.tabs.create).not.toHaveBeenCalled();
  });

  it('ignores other tabs and consumes a valid callback only once', async () => {
    const { startAmazonAuth, receiveAmazonNavigation } =
      await import('../src/background/amazon-auth');
    await startAmazonAuth();
    const pending = mocks.session[pendingKey] as AmazonPending;
    const url = new URL('https://www.amazon.com/');
    url.searchParams.set('glh_oauth_state', pending.state);
    url.searchParams.set('openid.oa2.authorization_code', 'synthetic-code');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        response: {
          success: {
            tokens: {
              bearer: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' },
            },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    receiveAmazonNavigation(999, url.href);
    receiveAmazonNavigation(42, url.href);
    receiveAmazonNavigation(42, url.href);
    await vi.waitFor(() => {
      expect(mocks.local[credentialKey]).toBeDefined();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.session[pendingKey]).toBeUndefined();
    expect(mocks.api.tabs.update).toHaveBeenLastCalledWith(42, {
      url: 'moz-extension://fictional/options.html',
    });
    expect(mocks.local[outcomeKey]).toEqual({ version: 1, outcome: 'success' });
    expect(JSON.stringify(mocks.local)).not.toContain('synthetic-code');
  });

  it('preserves older credentials and records only a safe failure on a failed exchange', async () => {
    const { startAmazonAuth, receiveAmazonNavigation } =
      await import('../src/background/amazon-auth');
    const old = { version: 1, accessToken: 'synthetic-old', refreshToken: 'synthetic-refresh' };
    mocks.local[credentialKey] = old;
    await startAmazonAuth();
    const pending = mocks.session[pendingKey] as AmazonPending;
    const url = new URL('https://www.amazon.com/');
    url.searchParams.set('glh_oauth_state', pending.state);
    url.searchParams.set('openid.oa2.authorization_code', 'synthetic-code');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-secret error body')),
    );
    receiveAmazonNavigation(42, url.href);
    await vi.waitFor(() => {
      expect(mocks.local[outcomeKey]).toEqual({ version: 1, outcome: 'failure' });
    });
    expect(mocks.local[credentialKey]).toEqual(old);
    expect(JSON.stringify(mocks.local)).not.toContain('synthetic-secret');
  });

  it('does not exchange a callback after consent is revoked', async () => {
    const { startAmazonAuth, receiveAmazonNavigation } =
      await import('../src/background/amazon-auth');
    await startAmazonAuth();
    const pending = mocks.session[pendingKey] as AmazonPending;
    const url = new URL('https://www.amazon.com/');
    url.searchParams.set('glh_oauth_state', pending.state);
    url.searchParams.set('openid.oa2.authorization_code', 'synthetic-code');
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    mocks.api.permissions.contains.mockResolvedValue(false);
    receiveAmazonNavigation(42, url.href);
    await vi.waitFor(() => {
      expect(mocks.session[pendingKey]).toBeUndefined();
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.local[credentialKey]).toBeUndefined();
  });
});
