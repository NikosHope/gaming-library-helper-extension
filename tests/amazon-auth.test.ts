import { describe, expect, it, vi } from 'vitest';
import {
  AmazonPendingSchema,
  amazonCallbackCode,
  createAmazonChallenge,
  exchangeAmazonCode,
  refreshAmazonCredential,
} from '../src/adapters/amazon-auth';

describe('Amazon authorization boundary', () => {
  it('generates fresh PKCE verifiers and callback nonces without device identifiers', async () => {
    const first = await createAmazonChallenge();
    const second = await createAmazonChallenge();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.state).not.toBe(second.state);
    expect(first.deviceSerial).not.toBe(second.deviceSerial);
    const url = new URL(first.url);
    expect(url.origin).toBe('https://www.amazon.com');
    expect(url.pathname).toBe('/ap/signin');
    expect(url.searchParams.get('openid.oa2.code_challenge_method')).toBe('S256');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    expect(url.searchParams.get('openid.oa2.code_challenge')).toBe(expected);
    expect(
      new URL(url.searchParams.get('openid.return_to')!).searchParams.get('glh_oauth_state'),
    ).toBe(first.state);
    expect(url.searchParams.has('openid.oa2.code_verifier')).toBe(false);
  });

  it('accepts only the bound callback origin, nonce, one code, and unexpired flow', async () => {
    const challenge = await createAmazonChallenge();
    const now = Date.now();
    const pending = AmazonPendingSchema.parse({
      ...challenge,
      version: 1,
      tabId: 1,
      expiresAt: now + 60_000,
    });
    const valid = new URL('https://www.amazon.com/');
    valid.searchParams.set('glh_oauth_state', pending.state);
    valid.searchParams.set('openid.oa2.authorization_code', 'synthetic-code');
    expect(amazonCallbackCode(pending, valid.href, now)).toBe('synthetic-code');
    expect(amazonCallbackCode(pending, valid.href, pending.expiresAt)).toBeUndefined();
    for (const change of [
      (url: URL) => {
        url.hostname = 'evil.example';
      },
      (url: URL) => {
        url.protocol = 'http:';
      },
      (url: URL) => {
        url.port = '444';
      },
      (url: URL) => {
        url.pathname = '/ap/signin';
      },
      (url: URL) => {
        url.username = 'user';
      },
      (url: URL) => {
        url.hash = 'fragment';
      },
      (url: URL) => {
        url.searchParams.delete('glh_oauth_state');
      },
      (url: URL) => {
        url.searchParams.set('glh_oauth_state', 'wrong');
      },
      (url: URL) => {
        url.searchParams.append('openid.oa2.authorization_code', 'other');
      },
      (url: URL) => {
        url.searchParams.append('glh_oauth_state', pending.state);
      },
    ]) {
      const url = new URL(valid);
      change(url);
      expect(amazonCallbackCode(pending, url.href, now)).toBeUndefined();
    }
  });

  it('exchanges only bearer credentials without cookies, profile extensions, or redirect forwarding', async () => {
    const pending = AmazonPendingSchema.parse({
      ...(await createAmazonChallenge()),
      version: 1,
      tabId: 1,
      expiresAt: Date.now() + 60_000,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        response: {
          success: {
            tokens: {
              bearer: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' },
              mac_dms: { private_key: 'not-retained' },
            },
            customer_info: { email: 'not-retained' },
          },
        },
      }),
    );
    const result = await exchangeAmazonCode(pending, 'synthetic-code', fetcher);
    expect(result).toEqual({
      version: 1,
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.amazon.com/auth/register');
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(init!.body as string) as {
      requested_extensions: string[];
      requested_token_type: string[];
      auth_data: { code_verifier: string };
    };
    expect(body.requested_extensions).toEqual([]);
    expect(body.requested_token_type).toEqual(['bearer']);
    expect(body.auth_data.code_verifier).toBe(pending.verifier);
  });

  it('retains the existing refresh credential unless the server explicitly rotates it', async () => {
    const current = {
      version: 1 as const,
      accessToken: 'synthetic-old',
      refreshToken: 'synthetic-refresh',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-new' }))
      .mockResolvedValueOnce(
        Response.json({ access_token: 'synthetic-newer', refresh_token: 'synthetic-rotated' }),
      );
    expect(await refreshAmazonCredential(current, fetcher)).toMatchObject({
      accessToken: 'synthetic-new',
      refreshToken: 'synthetic-refresh',
    });
    expect(await refreshAmazonCredential(current, fetcher)).toMatchObject({
      refreshToken: 'synthetic-rotated',
    });
  });

  it('never exposes vendor errors or sent secrets on a failed exchange', async () => {
    const pending = AmazonPendingSchema.parse({
      ...(await createAmazonChallenge()),
      version: 1,
      tabId: 1,
      expiresAt: Date.now() + 60_000,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('synthetic-secret in vendor error'));
    const promise = exchangeAmazonCode(pending, 'synthetic-code', fetcher);
    await expect(promise).rejects.toThrow('Amazon authorization failed.');
    await expect(promise).rejects.not.toThrow('synthetic-secret');
  });
});
