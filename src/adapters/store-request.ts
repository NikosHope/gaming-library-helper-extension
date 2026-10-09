export type StoreRequestFailure =
  'access-required' | 'rate-limited' | 'network' | 'invalid-response';

export class StoreRequestError extends Error {
  constructor(
    public readonly kind: StoreRequestFailure,
    message: string,
  ) {
    super(message);
    this.name = 'StoreRequestError';
  }
}

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_DELAY_MS = 5_000;

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('Retry-After');
  if (header === null) return attempt * 1_000;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : attempt * 1_000;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Read a store response without exposing credentials, response bodies, or redirect URLs. */
export async function requestStoreJson(
  url: string | URL,
  store: string,
  fetcher: typeof fetch,
  credentials: RequestCredentials = 'include',
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let delay = attempt * 1_000;

    try {
      const response = await fetcher(url, {
        credentials,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new StoreRequestError(
          'access-required',
          `${store} denied access (${response.status}). Open its tab, complete sign-in or verification, then retry. The previous library is unchanged.`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        delay = retryDelay(response, attempt);
        if (attempt === MAX_ATTEMPTS || delay > MAX_RETRY_DELAY_MS) {
          throw new StoreRequestError(
            response.status === 429 ? 'rate-limited' : 'network',
            `${store} is temporarily unavailable (${response.status}). Retry later. The previous library is unchanged.`,
          );
        }
      } else {
        if (!response.ok) {
          throw new StoreRequestError(
            'invalid-response',
            `${store} request failed (${response.status}). Retry from its signed-in tab. The previous library is unchanged.`,
          );
        }
        if (response.redirected || response.headers.get('Content-Type')?.includes('text/html')) {
          throw new StoreRequestError(
            'invalid-response',
            `${store} returned a page instead of library data. Open its tab, check sign-in, then retry. The previous library is unchanged.`,
          );
        }
        try {
          return (await response.json()) as unknown;
        } catch {
          throw new StoreRequestError(
            'invalid-response',
            `${store} returned unreadable data. Retry later. The previous library is unchanged.`,
          );
        }
      }
    } catch (error) {
      if (error instanceof StoreRequestError) throw error;
      if (attempt === MAX_ATTEMPTS) {
        throw new StoreRequestError(
          'network',
          `${store} could not be reached after ${MAX_ATTEMPTS} attempts. Check your connection and retry. The previous library is unchanged.`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
    await pause(delay);
  }
  throw new StoreRequestError('network', `${store} could not be reached. Retry later.`);
}
