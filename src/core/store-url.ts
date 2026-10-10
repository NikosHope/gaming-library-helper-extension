import { PublicEvidenceUrlSchema } from './reconciliation-schema';

/** Exact public product locators. Locale/query/display-title text cannot assert another product. */
export function storeUrlKey(value: unknown): string | undefined {
  if (!PublicEvidenceUrlSchema.safeParse(value).success || typeof value !== 'string')
    return undefined;
  const url = new URL(value);
  if (url.port) return undefined;
  const path = url.pathname.replace(/\/+$/u, '');
  if (url.hostname === 'store.steampowered.com') {
    const id = /^\/app\/([1-9]\d*)(?:\/|$)/u.exec(path)?.[1];
    return id ? `steam:${id}` : undefined;
  }
  if (['gog.com', 'www.gog.com'].includes(url.hostname)) {
    const slug = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:game|games)\/([^/]+)$/iu.exec(path)?.[1];
    return slug ? `gog:${slug}` : undefined;
  }
  if (url.hostname === 'store.epicgames.com') {
    const slug = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?p\/([^/]+)$/iu.exec(path)?.[1];
    return slug ? `epic:${slug}` : undefined;
  }
  if (['us.shop.battle.net', 'eu.shop.battle.net'].includes(url.hostname)) {
    const product = /^\/(?:[a-z]{2}-[a-z]{2}\/)?product\/([^/]+)$/iu.exec(path)?.[1];
    return product ? `battlenet:product/${product}` : undefined;
  }
  return undefined;
}
