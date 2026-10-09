import { z } from 'zod/v3';

export const AMAZON_ORIGINS = [
  'https://www.amazon.com/*',
  'https://api.amazon.com/*',
  'https://gaming.amazon.com/*',
];
const SecretSchema = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[!-~]+$/u);
export const AmazonCredentialSchema = z.object({
  version: z.literal(1),
  accessToken: SecretSchema,
  refreshToken: SecretSchema,
});
export type AmazonCredential = z.infer<typeof AmazonCredentialSchema>;
export const AmazonAuthOutcomeSchema = z.object({
  version: z.literal(1),
  outcome: z.enum(['success', 'failure']),
});
export const AmazonPendingSchema = z.object({
  version: z.literal(1),
  tabId: z.number().int().nonnegative(),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  deviceSerial: z.string().regex(/^[0-9a-f]{32}$/u),
  clientId: z.string().regex(/^[0-9a-f]+$/u),
  expiresAt: z.number().int().positive().safe(),
});
export type AmazonPending = z.infer<typeof AmazonPendingSchema>;
const BearerSchema = z.object({
  access_token: SecretSchema,
  refresh_token: SecretSchema.optional(),
});

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export async function createAmazonChallenge() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const deviceSerial = crypto.randomUUID().replaceAll('-', '');
  const deviceType = 'A2UMVHOX7UP4V7';
  const clientId = [...new TextEncoder().encode(`${deviceSerial}#${deviceType}`)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const url = new URL('https://www.amazon.com/ap/signin');
  const returnTo = new URL('https://www.amazon.com/');
  returnTo.searchParams.set('glh_oauth_state', state);
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.mode': 'checkid_setup',
    'openid.oa2.scope': 'device_auth_access',
    'openid.ns.oa2': 'http://www.amazon.com/ap/ext/oauth/2',
    'openid.oa2.response_type': 'code',
    'openid.oa2.code_challenge_method': 'S256',
    'openid.oa2.client_id': `device:${clientId}`,
    'openid.oa2.code_challenge': challenge,
    'openid.return_to': returnTo.href,
    'openid.assoc_handle': 'amzn_sonic_games_launcher',
    pageId: 'amzn_sonic_games_launcher',
    language: 'en_US',
    marketPlaceId: 'ATVPDKIKX0DER',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { verifier, state, deviceSerial, clientId, url: url.href };
}

/** Called only for the one extension-created auth tab; never return the URL/code to the UI. */
export function amazonCallbackCode(
  pending: AmazonPending,
  rawUrl: string,
  now: number,
): string | undefined {
  if (now >= pending.expiresAt || rawUrl.length > 16_384) return;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (
    url.origin !== 'https://www.amazon.com' ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.hash
  )
    return;
  const states = url.searchParams.getAll('glh_oauth_state');
  const codes = url.searchParams.getAll('openid.oa2.authorization_code');
  if (
    states.length !== 1 ||
    states[0] !== pending.state ||
    codes.length !== 1 ||
    !codes[0] ||
    codes[0].length > 4096
  )
    return;
  return codes[0];
}

async function postAmazonAuth(
  path: 'register' | 'token',
  body: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`https://api.amazon.com/auth/${path}`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(
        'Amazon authorization failed. Retry sign-in; your saved library is unchanged.',
      );
    return (await response.json()) as unknown;
  } catch {
    // Never surface vendor response text, request bodies, codes, or tokens.
    throw new Error('Amazon authorization failed. Retry sign-in; your saved library is unchanged.');
  }
}

export async function exchangeAmazonCode(
  pending: AmazonPending,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<AmazonCredential> {
  const payload = await postAmazonAuth(
    'register',
    {
      auth_data: {
        authorization_code: code,
        code_verifier: pending.verifier,
        code_algorithm: 'SHA-256',
        client_id: pending.clientId,
        client_domain: 'DeviceLegacy',
        use_global_authentication: false,
      },
      registration_data: {
        app_name: 'Gaming Library Helper',
        app_version: '0.1.0',
        device_model: 'Firefox',
        device_name: 'Gaming Library Helper',
        device_serial: pending.deviceSerial,
        device_type: 'A2UMVHOX7UP4V7',
        domain: 'Device',
        os_version: 'Firefox',
      },
      user_context_map: {},
      requested_extensions: [],
      requested_token_type: ['bearer'],
    },
    fetcher,
  );
  const parsed = z
    .object({
      response: z.object({
        success: z.object({
          tokens: z.object({ bearer: BearerSchema.extend({ refresh_token: SecretSchema }) }),
        }),
      }),
    })
    .safeParse(payload);
  if (!parsed.success)
    throw new Error('Amazon authorization returned unsupported data. Retry sign-in.');
  const tokens = parsed.data.response.success.tokens.bearer;
  return { version: 1, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

export async function refreshAmazonCredential(
  current: AmazonCredential,
  fetcher: typeof fetch = fetch,
): Promise<AmazonCredential> {
  const parsed = BearerSchema.safeParse(
    await postAmazonAuth(
      'token',
      {
        app_name: 'AGSLauncher',
        app_version: '3.0.9495.3',
        source_token: current.refreshToken,
        requested_token_type: 'access_token',
        source_token_type: 'refresh_token',
      },
      fetcher,
    ),
  );
  if (!parsed.success)
    throw new Error('Amazon authorization returned unsupported data. Retry sign-in.');
  return {
    version: 1,
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? current.refreshToken,
  };
}
