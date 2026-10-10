import { randomUUID } from 'node:crypto';
import { CatalogRecordSchema } from '../../src/core/reconciliation-schema.ts';
import { productKey, catalogKey } from '../../src/core/reconciliation.ts';
import { readCredential } from './keychain.mjs';
import { requestJson, rateLimited, SourceError } from './network.mjs';

export { storeUrlKey } from '../../src/core/store-url.ts';
import { storeUrlKey } from '../../src/core/store-url.ts';

function nameKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/gu, '')
    .replaceAll('/', '');
}
export function exactExternalRefs(externals, products) {
  const refs = new Map();
  for (const external of externals ?? []) {
    const source = nameKey(external.external_game_source?.name);
    const uid = String(external.uid ?? '');
    const urlKey = storeUrlKey(external.url);
    if (
      source === 'steam' &&
      /^[1-9]\d*$/u.test(uid) &&
      (!external.url || urlKey === `steam:${uid}`)
    )
      refs.set(`steam:${uid}`, {
        store: 'steam',
        storeId: uid,
        ...(external.url ? { url: external.url } : {}),
      });
    for (const item of products) {
      if (item.store === 'steam' && urlKey !== productKey(item)) continue;
      if (item.publicUrl && urlKey && urlKey === storeUrlKey(item.publicUrl))
        refs.set(productKey(item), { store: item.store, storeId: item.storeId, url: external.url });
    }
  }
  return [...refs.values()];
}
export function parseIgdbGame(game, products, checkedAt = new Date().toISOString()) {
  const type = nameKey(game.game_type?.type);
  const types = {
    maingame: 'game',
    standaloneexpansion: 'standalone-expansion',
    mod: 'mod',
    remake: 'remake',
    remaster: 'remaster',
    expandedgame: 'game',
    port: 'game',
    dlcaddon: 'component',
    expansion: 'component',
    episode: 'unknown',
    season: 'unknown',
    bundle: 'bundle',
    pack: 'bundle',
    update: 'component',
  };
  const kind = ['remake', 'remaster'].includes(types[type])
    ? types[type]
    : game.version_parent
      ? 'edition'
      : (types[type] ?? 'unknown');
  const identity = { provider: 'igdb', id: game.id };
  return CatalogRecordSchema.parse({
    identity,
    title: game.name,
    kind,
    url: game.url,
    checkedAt,
    dependency: ['game', 'standalone-expansion', 'remake', 'remaster'].includes(kind)
      ? 'none'
      : kind === 'component'
        ? 'base-game'
        : 'unknown',
    ...(kind === 'edition' ? { versionParent: { provider: 'igdb', id: game.version_parent } } : {}),
    ...(game.parent_game ? { parent: { provider: 'igdb', id: game.parent_game } } : {}),
    externalRefs: exactExternalRefs(game.external_games, products),
  });
}
export function parseRawgGame(game, storeLinks, products, checkedAt = new Date().toISOString()) {
  const refs = [];
  for (const link of storeLinks)
    for (const product of products) {
      if (product.store === 'steam' && storeUrlKey(link.url) !== productKey(product)) continue;
      const exactSteam =
        product.store === 'steam' && storeUrlKey(link.url) === `steam:${product.storeId}`;
      if (
        exactSteam ||
        (product.publicUrl &&
          storeUrlKey(link.url) &&
          storeUrlKey(link.url) === storeUrlKey(product.publicUrl))
      )
        refs.push({ store: product.store, storeId: product.storeId, url: link.url });
    }
  // RAWG provides no general product-type/edition-parent contract. Only a positive official
  // game type can establish standalone play here; title words and global platforms cannot.
  const primary = products.find(
    (item) =>
      refs.some((ref) => productKey(ref) === productKey(item)) &&
      item.kind === 'game' &&
      item.classification?.source === 'store-metadata' &&
      item.classification?.confidence === 'primary',
  );
  return CatalogRecordSchema.parse({
    identity: { provider: 'rawg', id: game.id },
    title: game.name,
    kind: primary ? 'game' : 'unknown',
    dependency: primary ? 'none' : 'unknown',
    independenceEvidence: primary
      ? [primary.publicUrl ?? `https://store.steampowered.com/app/${primary.storeId}/`]
      : [],
    url: `https://rawg.io/games/${game.slug}`,
    checkedAt,
    externalRefs: [...new Map(refs.map((ref) => [productKey(ref), ref])).values()],
  });
}
export async function createCatalogs(products, credential = readCredential, fetcher = fetch) {
  const clientId = await credential('igdb-client-id');
  const secret = await credential('igdb-client-secret');
  const rawgKey = await credential('rawg-key');
  let token;
  let expires = 0;
  const igdb = rateLimited(async (endpoint, body) => {
    if (!clientId || !secret) throw new SourceError('IGDB', 'not configured');
    if (!token || Date.now() >= expires) {
      const auth = await requestJson(
        'Twitch OAuth',
        'https://id.twitch.tv/oauth2/token',
        {
          method: 'POST',
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: secret,
            grant_type: 'client_credentials',
          }),
        },
        fetcher,
      );
      if (typeof auth.access_token !== 'string' || !Number.isFinite(auth.expires_in))
        throw new SourceError('Twitch OAuth', 'invalid data');
      token = auth.access_token;
      expires = Date.now() + Math.max(0, auth.expires_in - 60) * 1000;
    }
    const response = await requestJson(
      'IGDB',
      `https://api.igdb.com/v4/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body,
      },
      fetcher,
    );
    if (!Array.isArray(response)) throw new SourceError('IGDB', 'invalid data');
    return response;
  });
  const rawg = rateLimited(async (endpoint, query = {}) => {
    if (!rawgKey) throw new SourceError('RAWG', 'not configured');
    return requestJson(
      'RAWG',
      `https://api.rawg.io/api/${endpoint}?${new URLSearchParams({ ...query, key: rawgKey })}`,
      {},
      fetcher,
    );
  }, 500);
  const fields =
    'id,name,url,game_type.type,version_parent,parent_game,external_games.uid,external_games.url,external_games.external_game_source.name';
  const fetched = new Map();
  return {
    configured: { igdb: Boolean(clientId && secret), rawg: Boolean(rawgKey) },
    async exactSteam(ids) {
      if (!ids.length) return [];
      if (!ids.every((id) => /^[1-9]\d*$/u.test(id))) throw new Error('Invalid Steam identity');
      const sources = await igdb('external_game_sources', 'fields id,name; limit 500;');
      const steam = sources.find((item) => nameKey(item.name) === 'steam');
      if (!steam) throw new SourceError('IGDB', 'Steam source not found');
      const identities = new Set();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const uids = ids
          .slice(offset, offset + 100)
          .map((id) => JSON.stringify(id))
          .join(',');
        for (let page = 0; page < 20; page++) {
          const games = await igdb(
            'external_games',
            `fields uid,game; where external_game_source = ${steam.id} & uid = (${uids}); limit 500; offset ${page * 500};`,
          );
          for (const item of games)
            if (Number.isSafeInteger(item.game) && item.game > 0) identities.add(item.game);
          if (games.length < 500) break;
          if (page === 19) throw new SourceError('IGDB', 'external ID pagination incomplete');
        }
      }
      const records = [];
      const values = [...identities];
      for (let offset = 0; offset < values.length; offset += 100) {
        const games = await igdb(
          'games',
          `fields ${fields}; where id = (${values.slice(offset, offset + 100).join(',')}); limit 500;`,
        );
        for (const game of games) {
          const parsed = parseIgdbGame(game, products);
          fetched.set(catalogKey(parsed.identity), parsed);
          records.push(parsed);
        }
      }
      return records;
    },
    async get(identity, fresh = false) {
      if (!fresh && fetched.has(catalogKey(identity))) return fetched.get(catalogKey(identity));
      let parsed;
      if (identity.provider === 'igdb') {
        const rows = await igdb('games', `fields ${fields}; where id = ${identity.id}; limit 1;`);
        if (!rows[0] || rows[0].id !== identity.id) throw new SourceError('IGDB', 'ID not found');
        parsed = parseIgdbGame(rows[0], products);
      } else {
        const game = await rawg(`games/${identity.id}`);
        if (game.id !== identity.id) throw new SourceError('RAWG', 'ID mismatch');
        const links = [];
        let page = 1;
        while (page <= 10) {
          let stores;
          try {
            stores = await rawg(`games/${identity.id}/stores`, {
              page: String(page),
              page_size: '100',
            });
          } catch (error) {
            // A paid store-link capability is optional for a human ID review; it cannot support an automatic match.
            if (error instanceof SourceError && [402, 403].includes(error.status)) {
              links.length = 0;
              break;
            }
            throw error;
          }
          if (!Array.isArray(stores.results))
            throw new SourceError('RAWG', 'store links unavailable');
          links.push(...stores.results);
          if (!stores.next) break;
          page++;
          if (page > 10) throw new SourceError('RAWG', 'store pagination incomplete');
        }
        parsed = parseRawgGame(game, links, products);
      }
      fetched.set(catalogKey(identity), parsed);
      return parsed;
    },
    async search(product, provider) {
      if (product.titleStatus !== 'resolved') return [];
      let candidates;
      if (provider === 'igdb')
        candidates = await igdb(
          'games',
          `fields ${fields}; search ${JSON.stringify(product.title)}; limit 5;`,
        );
      else {
        const response = await rawg('games', { search: product.title, page_size: '5' });
        if (!Array.isArray(response.results)) throw new SourceError('RAWG', 'invalid search');
        candidates = response.results;
      }
      return candidates.map((game) => ({
        id: randomUUID(),
        store: product.store,
        storeId: product.storeId,
        candidate: { provider, id: game.id },
        evidenceUrls: [provider === 'igdb' ? game.url : `https://rawg.io/games/${game.slug}`],
        rationale: `Catalog search candidate: ${game.name}. Title search does not confirm identity.`,
        origin: 'catalog-search',
      }));
    },
  };
}
