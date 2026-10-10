import { setTimeout as delay } from 'node:timers/promises';

export class SourceError extends Error {
  constructor(source, status) {
    super(`${source} is unavailable${status ? ` (HTTP ${status})` : ''}`);
    this.source = source;
    this.status = status;
  }
}
export async function requestJson(source, url, options = {}, fetcher = fetch) {
  // Do not include URLs, response bodies, headers or underlying exceptions in errors.
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SourceError(source);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < 2) {
        await delay(
          Math.min(5000, Math.max(500, Number(response.headers.get('retry-after')) * 1000 || 1000)),
        );
        continue;
      }
    }
    if (!response.ok) throw new SourceError(source, response.status);
    try {
      const text = await response.text();
      if (text.length > 8_000_000) throw new Error();
      return JSON.parse(text);
    } catch {
      throw new SourceError(source, 'invalid data');
    }
  }
}
export function rateLimited(request, interval = 300) {
  let queue = Promise.resolve();
  let last = 0;
  return (...args) => {
    const operation = queue.then(async () => {
      await delay(Math.max(0, interval - (Date.now() - last)));
      last = Date.now();
      return request(...args);
    });
    queue = operation.catch(() => undefined);
    return operation;
  };
}
