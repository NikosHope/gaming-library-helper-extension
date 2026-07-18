import { browser } from 'wxt/browser';
import { fetchItadQuote } from '../adapters/itad';
import { findGameForPage, otherStore, replaceStoreSnapshot } from '../core/library';
import { RuntimeRequestSchema } from '../core/messages';
import { normalizeTitle } from '../core/normalize';
import { loadState, saveState, updateState } from '../core/storage';

interface MessageSender {
  url?: string | undefined;
  tab?: { url?: string | undefined } | undefined;
}

function senderStore(sender: MessageSender): 'steam' | 'gog' | undefined {
  const rawUrl = sender.url ?? sender.tab?.url;
  if (!rawUrl) return undefined;
  const hostname = new URL(rawUrl).hostname;
  if (hostname === 'store.steampowered.com') return 'steam';
  if (hostname === 'www.gog.com' || hostname === 'gog.com') return 'gog';
  return undefined;
}

function requireExtensionPage(sender: MessageSender): void {
  if (sender.tab) throw new Error('This operation is only available from an extension page');
}

function cacheKey(title: string, store: 'steam' | 'gog', country: string): string {
  return `${normalizeTitle(title)}|${store}|${country.toUpperCase()}`;
}

export default defineBackground(() => {
  void (async () => saveState(await loadState()))();

  // Firefox runtime listeners intentionally return a Promise for async responses.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  browser.runtime.onMessage.addListener(async (raw: unknown, sender) => {
    const parsed = RuntimeRequestSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Unsupported extension message');
    const request = parsed.data;

    switch (request.type) {
      case 'state:getAdmin': {
        requireExtensionPage(sender);
        return loadState();
      }
      case 'view:get': {
        const state = await loadState();
        state.settings.prices.apiKey = '';
        return state;
      }
      case 'settings:update': {
        requireExtensionPage(sender);
        return updateState((state) => ({ ...state, settings: request.settings }));
      }
      case 'library:replaceSnapshot': {
        const sourceStore = senderStore(sender);
        if (sourceStore !== request.store) {
          throw new Error(
            `A ${request.store} snapshot must come from an authenticated ${request.store} tab`,
          );
        }
        let summary = { added: 0, matched: 0, removed: 0 };
        const state = await updateState((current) => {
          const result = replaceStoreSnapshot(current, {
            store: request.store,
            syncedAt: request.syncedAt,
            refs: request.refs,
          });
          summary = { added: result.added, matched: result.matched, removed: result.removed };
          return result.state;
        });
        return { ok: true, summary, gameCount: state.snapshots[request.store]?.gameCount ?? 0 };
      }
      case 'library:setIgnored': {
        requireExtensionPage(sender);
        return updateState((state) => {
          const game = state.games.find((candidate) => candidate.id === request.gameId);
          if (!game) throw new Error('Game not found');
          game.ignored = request.ignored;
          return state;
        });
      }
      case 'price:get': {
        const state = await loadState();
        const settings = state.settings.prices;
        if (!settings.enabled || !settings.apiKey) return null;
        const targetStore = otherStore(request.currentStore);
        const key = cacheKey(request.title, targetStore, settings.country);
        const cached = state.priceCache[key];
        if (cached && Date.parse(cached.expiresAt) > Date.now()) return cached;

        const matchedGame = findGameForPage(state, {
          store: request.currentStore,
          title: request.title,
          ...(request.steamAppId ? { storeId: request.steamAppId } : {}),
        });
        if (matchedGame?.storeRefs[targetStore]?.owned) return null;

        const quote = await fetchItadQuote({
          title: request.title,
          ...(request.steamAppId ? { steamAppId: request.steamAppId } : {}),
          targetStore,
          country: settings.country,
          apiKey: settings.apiKey,
        });
        if (!quote) return null;
        await updateState((latest) => {
          latest.priceCache[key] = quote;
          return latest;
        });
        return quote;
      }
    }
  });
});
