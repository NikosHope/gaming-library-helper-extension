import { browser } from 'wxt/browser';
import {
  configureSync,
  getSyncStatus,
  restoreSyncAlarm,
  runScheduledSync,
  runSyncNow,
  SYNC_ALARM,
} from '../background/scheduled-sync';
import { requireExtensionPage, requireSteamStore, senderStore } from '../background/message-sender';
import { requestSteamCatalog, STEAM_CATALOG_ORIGIN } from '../adapters/steam';
import {
  requestSteamPublicAppInfo,
  STEAM_PUBLIC_METADATA_ORIGIN,
} from '../adapters/steam-public-metadata';
import { replaceStoreSnapshot } from '../core/library';
import { RuntimeRequestSchema } from '../core/messages';
import { loadState, updateState } from '../core/storage';
import {
  amazonAuthStatus,
  startAmazonAuth,
  receiveAmazonNavigation,
  refreshAmazonAccess,
} from '../background/amazon-auth';
import {
  readAmazonEntitlements,
  summarizeAmazonSource,
  diagnoseAmazonSource,
} from '../adapters/amazon';
import { firefoxPermissions, firefoxTabUpdates } from '../background/firefox-api';
import { loadSteamMetadata, importSteamMetadata } from '../background/steam-metadata';
import { cachedSteamMetadataItem } from '../core/steam-metadata';

export default defineBackground(() => {
  firefoxTabUpdates.addListener(
    (tabId, changeInfo) => {
      if (changeInfo.url?.includes('glh_oauth_state='))
        receiveAmazonNavigation(tabId, changeInfo.url);
    },
    { urls: ['https://www.amazon.com/*'], properties: ['url'] },
  );
  void (async () => {
    await updateState((state) => state);
    await restoreSyncAlarm();
  })().catch(() => undefined);
  browser.runtime.onStartup.addListener(() => {
    void restoreSyncAlarm().catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void runScheduledSync().catch(() => undefined);
  });

  // Firefox runtime listeners intentionally return a Promise for async responses.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  browser.runtime.onMessage.addListener(async (raw: unknown, sender) => {
    const parsed = RuntimeRequestSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Unsupported extension message');
    const request = parsed.data;

    switch (request.type) {
      case 'steam:importMetadata':
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return importSteamMetadata(request.snapshot);
      case 'amazon:startAuth':
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return startAmazonAuth();
      case 'amazon:getAuthStatus':
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return amazonAuthStatus();
      case 'amazon:inspectSource': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        const token = await refreshAmazonAccess();
        return summarizeAmazonSource(await readAmazonEntitlements(token));
      }
      case 'amazon:diagnoseSource': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return diagnoseAmazonSource(await refreshAmazonAccess());
      }
      case 'steam:catalog': {
        requireSteamStore(sender);
        if (!(await browser.permissions.contains({ origins: [STEAM_CATALOG_ORIGIN] }))) {
          throw new Error(
            'Steam catalog access is required. Open extension settings and use Sync now to grant it. The previous library is unchanged.',
          );
        }
        const publicMetadataAllowed = await firefoxPermissions.contains({
          origins: [STEAM_PUBLIC_METADATA_ORIGIN],
          data_collection: ['websiteContent'],
        });
        const cache = await loadSteamMetadata();
        return requestSteamCatalog(
          request.appIds,
          fetch,
          publicMetadataAllowed || cache.apps.length
            ? async (id) => {
                const metadata = publicMetadataAllowed
                  ? await requestSteamPublicAppInfo(id)
                  : undefined;
                return metadata?.success === 1 ? metadata : cachedSteamMetadataItem(cache, id);
              }
            : undefined,
        );
      }
      case 'sync:getStatus': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return getSyncStatus();
      }
      case 'sync:runNow': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        await runSyncNow();
        return getSyncStatus();
      }
      case 'sync:configure': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return configureSync(request.settings);
      }
      case 'state:getAdmin': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return loadState();
      }
      case 'view:get': {
        return loadState();
      }
      case 'settings:update': {
        requireExtensionPage(sender, browser.runtime.getURL('/'));
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
        requireExtensionPage(sender, browser.runtime.getURL('/'));
        return updateState((state) => {
          const game = state.games.find((candidate) => candidate.id === request.gameId);
          if (!game) throw new Error('Game not found');
          game.ignored = request.ignored;
          return state;
        });
      }
    }
  });
});
