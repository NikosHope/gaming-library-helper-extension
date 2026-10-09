import { SyncSettingsSchema, SyncStatusSchema, type SyncStatus } from '../../core/sync';
import { browser } from 'wxt/browser';
import { STEAM_CATALOG_ORIGIN } from '../../adapters/steam';
import { STEAM_PUBLIC_METADATA_ORIGIN } from '../../adapters/steam-public-metadata';
import { AMAZON_ORIGINS } from '../../adapters/amazon-auth';
import { BATTLENET_ORIGIN, BATTLENET_GAMES_URL } from '../../adapters/battlenet';
import { z } from 'zod/v3';
import { firefoxPermissions } from '../../background/firefox-api';
import { countOwned } from '../../core/library';
import { LibraryStateSchema, StoreSchema, type LibraryState, type Store } from '../../core/schema';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing options element: ${id}`);
  return element as T;
};

let state: LibraryState;

let syncStatus: SyncStatus;
let syncBusy = false;
let refreshId = 0;
let amazonAuth: { connected: boolean; waiting: boolean; failed: boolean } = {
  connected: false,
  waiting: false,
  failed: false,
};
const AmazonAuthStatusSchema = z.object({
  connected: z.boolean(),
  waiting: z.boolean(),
  failed: z.boolean(),
});

const SOURCE_TABS: Partial<Record<Store, { pattern: string; url: string }>> = {
  steam: { pattern: 'https://store.steampowered.com/*', url: 'https://store.steampowered.com/' },
  gog: { pattern: 'https://www.gog.com/*', url: 'https://www.gog.com/account' },
  epic: { pattern: 'https://store.epicgames.com/*', url: 'https://store.epicgames.com/en-US/' },
  battlenet: { pattern: BATTLENET_GAMES_URL, url: BATTLENET_GAMES_URL },
};
const EPIC_ORIGIN = 'https://store.epicgames.com/*';

function capturePermissions(stores: Store[]): string[] {
  return [
    ...(stores.includes('steam') ? [STEAM_CATALOG_ORIGIN, STEAM_PUBLIC_METADATA_ORIGIN] : []),
    ...(stores.includes('epic') ? [EPIC_ORIGIN] : []),
    ...(stores.includes('battlenet') ? [BATTLENET_ORIGIN] : []),
  ];
}

function renderSync(): void {
  if (!syncStatus || !state) return;
  const { settings, receipts } = syncStatus;
  byId<HTMLInputElement>('auto-sync').checked = settings.enabled;
  byId<HTMLInputElement>('auto-sync').disabled = syncBusy;
  byId<HTMLSelectElement>('interval').value = String(settings.intervalHours);
  byId<HTMLSelectElement>('interval').disabled = syncBusy || !settings.enabled;
  byId<HTMLButtonElement>('sync-now').disabled = syncBusy;
  byId<HTMLButtonElement>('sync-now').textContent = syncBusy ? 'Please wait…' : 'Sync now';
  const interval =
    settings.intervalHours === 24
      ? '24 hours'
      : settings.intervalHours === 168
        ? '7 days'
        : '30 days';
  byId('sync-mode').textContent = settings.enabled
    ? 'Auto sync every ' + interval + ' while Firefox is running.'
    : 'Auto sync is off. Use Sync now when you want to update.';

  for (const store of ['steam', 'gog', 'epic', 'amazon', 'battlenet'] as const) {
    const snapshot = state.snapshots[store];
    const receipt = receipts.stores[store];
    const successfulTimes = [snapshot?.syncedAt, receipt?.lastSuccessAt]
      .filter((value): value is string => value !== undefined)
      .sort();
    const lastSuccess = successfulTimes.at(-1);
    const failed =
      receipt &&
      receipt.outcome !== 'success' &&
      (!lastSuccess || Date.parse(receipt.lastAttemptAt) >= Date.parse(lastSuccess));
    const pill = byId(store + '-status');
    pill.classList.toggle('pending', Boolean(failed));
    const details = byId(store + '-details');
    details.textContent = '';
    if (failed) {
      const messages = {
        'source-tab-required': [
          'Open store tab',
          'Open one nonprivate store tab and sign in, then retry.',
        ],
        'ambiguous-tabs': [
          'Multiple source tabs',
          'Keep one loaded store tab open for this store, then retry.',
        ],
        'capture-failed': [
          'Sync failed',
          'Check sign-in and store access, then retry. Your saved library is unchanged.',
        ],
      } as const;
      const message = messages[receipt.outcome as keyof typeof messages];
      pill.textContent = message[0];
      details.textContent = message[1];
    } else {
      pill.textContent = snapshot
        ? String(snapshot.gameCount) +
          (snapshot.unresolvedCount || store === 'steam' || store === 'battlenet'
            ? ' entries saved'
            : ' games saved')
        : (store === 'epic' || store === 'battlenet') && !settings.stores.includes(store)
          ? 'Not connected'
          : 'Not imported';
      if (!snapshot)
        details.textContent =
          store === 'amazon'
            ? amazonAuth.connected
              ? 'Amazon Games is connected. Use Sync now to import the app library.'
              : 'Connect Amazon Games, then use Sync now.'
            : 'Open the store, sign in, then use Sync now.';
      if (snapshot) {
        const unresolved = state.games.filter(
          (game) => game.storeRefs[store]?.titleStatus === 'unresolved',
        ).length;
        if (unresolved)
          details.textContent =
            String(unresolved) +
            ' entries have no confirmed title. Their IDs are saved; they do not hide games on other stores.';
      }
    }
    byId(store + '-last-success').textContent = lastSuccess
      ? new Date(lastSuccess).toLocaleString()
      : '—';
  }
  byId<HTMLButtonElement>('open-epic').textContent = settings.stores.includes('epic')
    ? 'Open Epic'
    : 'Connect';
  byId<HTMLButtonElement>('open-epic').disabled = syncBusy;
  byId<HTMLButtonElement>('connect-battlenet').textContent = settings.stores.includes('battlenet')
    ? 'Open Battle.net'
    : 'Connect';
  byId<HTMLButtonElement>('connect-battlenet').disabled = syncBusy;
  if (state.snapshots.battlenet && !byId('battlenet-details').textContent) {
    const games = countOwned(state, 'battlenet');
    const components = state.games.filter(
      (game) => game.storeRefs.battlenet?.classification?.kind === 'component',
    ).length;
    byId('battlenet-details').textContent =
      `${games} games and ${components} expansion components. Trial accounts are excluded; paid modern expansions and editions are not inferred.`;
  }
  if (!state.snapshots.amazon && !receipts.stores.amazon)
    byId('amazon-status').textContent = amazonAuth.waiting
      ? 'Finish sign-in'
      : amazonAuth.failed
        ? 'Sign-in failed · retry'
        : amazonAuth.connected
          ? 'Signed in · import pending'
          : 'Not connected';
  byId<HTMLButtonElement>('connect-amazon').textContent = amazonAuth.waiting
    ? 'Sign-in pending'
    : amazonAuth.connected
      ? 'Reconnect'
      : 'Connect';
  byId<HTMLButtonElement>('connect-amazon').disabled = syncBusy || amazonAuth.waiting;
}

async function saveSyncSettings(): Promise<void> {
  if (!syncStatus || syncBusy) return;
  const settings = SyncSettingsSchema.parse({
    ...syncStatus.settings,
    enabled: byId<HTMLInputElement>('auto-sync').checked,
    intervalHours: Number(byId<HTMLSelectElement>('interval').value),
  });
  syncBusy = true;
  renderSync();
  byId('sync-message').textContent = 'Saving schedule…';
  try {
    if (
      settings.enabled &&
      capturePermissions(settings.stores).length > 0 &&
      !(await firefoxPermissions.request({
        origins: capturePermissions(settings.stores),
        ...(settings.stores.includes('steam') ? { data_collection: ['websiteContent'] } : {}),
      }))
    ) {
      byId('sync-message').textContent =
        'Store access was not granted. Allow it when enabling Auto sync.';
      return;
    }
    await browser.runtime.sendMessage({ type: 'sync:configure', settings });
    await load();
    byId('sync-message').textContent = 'Schedule saved.';
  } catch {
    // Read back after failure: storage may have succeeded before alarm restoration failed.
    await load().catch(() => undefined);
    byId('sync-message').textContent =
      'Could not confirm the schedule. Reopen settings and try again.';
  } finally {
    syncBusy = false;
    renderSync();
  }
}

async function syncNow(): Promise<void> {
  if (!syncStatus || syncBusy) return;
  syncBusy = true;
  renderSync();
  byId('sync-message').textContent = 'Syncing selected stores… Keep the source tabs open.';
  try {
    const catalogAllowed =
      capturePermissions(syncStatus.settings.stores).length === 0 ||
      (await firefoxPermissions.request({
        origins: capturePermissions(syncStatus.settings.stores),
        ...(syncStatus.settings.stores.includes('steam')
          ? { data_collection: ['websiteContent'] }
          : {}),
      }));
    SyncStatusSchema.parse(await browser.runtime.sendMessage({ type: 'sync:runNow' }));
    await load();
    byId('sync-message').textContent = catalogAllowed
      ? 'Sync finished. Check each store’s result above.'
      : 'Sync finished. Store access was not granted for some sources; allow it with Sync now to update them.';
  } catch {
    await load().catch(() => undefined);
    byId('sync-message').textContent =
      'Could not finish sync. Reopen settings and retry; your saved library is preserved.';
  } finally {
    syncBusy = false;
    renderSync();
  }
}

async function openStore(store: Store): Promise<void> {
  try {
    const source = SOURCE_TABS[store];
    if (!source) throw new Error('This provider is not connected');
    const tabs = (await browser.tabs.query({ url: source.pattern }))
      .filter((tab) => !tab.incognito && tab.id !== undefined)
      .sort((left, right) => left.id! - right.id!);
    if (tabs[0]) await browser.tabs.update(tabs[0].id, { active: true });
    else await browser.tabs.create({ url: source.url });
  } catch {
    byId('sync-message').textContent =
      'Could not open the store. Open it in a nonprivate Firefox tab and sign in.';
  }
}

async function connectEpic(): Promise<void> {
  if (!syncStatus || syncBusy) return;
  if (syncStatus.settings.stores.includes('epic')) return openStore('epic');
  if (!(await browser.permissions.request({ origins: [EPIC_ORIGIN] }))) {
    byId('sync-message').textContent =
      'Epic access was not granted. Your saved library is unchanged.';
    return;
  }
  syncBusy = true;
  renderSync();
  try {
    await browser.runtime.sendMessage({
      type: 'sync:configure',
      settings: SyncSettingsSchema.parse({
        ...syncStatus.settings,
        stores: [...syncStatus.settings.stores, 'epic'],
      }),
    });
    await load();
    byId('sync-message').textContent =
      'Epic is enabled. Reload the signed-in Epic store tab, then use Sync now.';
  } catch {
    await load().catch(() => undefined);
    byId('sync-message').textContent = 'Could not enable Epic. Reopen settings and try again.';
  } finally {
    syncBusy = false;
    renderSync();
  }
}

async function connectBattleNet(): Promise<void> {
  if (!syncStatus || syncBusy) return;
  if (syncStatus.settings.stores.includes('battlenet')) return openStore('battlenet');
  if (!(await browser.permissions.request({ origins: [BATTLENET_ORIGIN] }))) {
    byId('sync-message').textContent =
      'Battle.net access was not granted. Your saved library is unchanged.';
    return;
  }
  syncBusy = true;
  renderSync();
  try {
    await browser.runtime.sendMessage({
      type: 'sync:configure',
      settings: SyncSettingsSchema.parse({
        ...syncStatus.settings,
        stores: [...syncStatus.settings.stores, 'battlenet'],
      }),
    });
    await load();
    byId('sync-message').textContent =
      'Battle.net is enabled. Reload Games & Subscriptions, wait for both game lists, then use Sync now.';
  } catch {
    await load().catch(() => undefined);
    byId('sync-message').textContent = 'Could not enable Battle.net. Reopen settings and retry.';
  } finally {
    syncBusy = false;
    renderSync();
  }
}

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = row.insertCell();
  cell.textContent = value;
}

function renderGames(): void {
  if (!state) return;
  const query = byId<HTMLInputElement>('search').value.trim().toLocaleLowerCase();
  const body = byId<HTMLTableSectionElement>('games');
  body.replaceChildren();
  const games = [...state.games]
    .filter((game) => game.displayTitle.toLocaleLowerCase().includes(query))
    .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle));

  for (const game of games) {
    const row = body.insertRow();
    const otherSources = (['epic', 'amazon', 'battlenet'] as const).flatMap((store) => {
      const ref = game.storeRefs[store];
      if (!ref?.owned) return [];
      const name = store === 'epic' ? 'Epic' : store === 'amazon' ? 'Amazon Games' : 'Battle.net';
      return [name + (ref.titleStatus === 'unresolved' ? ': ID only' : '')];
    });
    appendCell(
      row,
      game.displayTitle + (otherSources.length ? ' [' + otherSources.join(', ') + ']' : ''),
    );
    appendCell(
      row,
      game.storeRefs.steam?.titleStatus === 'unresolved'
        ? 'ID only'
        : game.storeRefs.steam
          ? 'Owned'
          : '—',
    );
    appendCell(row, game.storeRefs.gog ? 'Owned' : '—');
    const actionCell = row.insertCell();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.textContent = game.ignored ? 'Unignore' : 'Ignore';
    button.addEventListener('click', () => {
      void (async () => {
        state = LibraryStateSchema.parse(
          await browser.runtime.sendMessage({
            type: 'library:setIgnored',
            gameId: game.id,
            ignored: !game.ignored,
          }),
        );
        renderGames();
      })();
    });
    actionCell.append(button);
  }
}

function renderDevices(): void {
  const container = byId('devices');
  container.replaceChildren();
  for (const device of state.devices) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = device.name;
    const hardware = document.createElement('p');
    hardware.textContent = device.hardware;
    const meta = document.createElement('p');
    meta.className = 'hint';
    meta.textContent =
      `${device.operatingSystems.join(', ')} · ${device.cpuArchitecture} · ${device.graphicsApis.join(', ') || 'graphics API unknown'} · ${device.displayMode}` +
      `${device.memoryGb ? ` · ${device.memoryGb} GB` : ''}`;
    const notes = document.createElement('p');
    notes.textContent = device.notes;
    card.append(title, hardware, meta, notes);
    container.append(card);
  }
}

function render(): void {
  const shared = state.games.filter(
    (game) =>
      Object.values(game.storeRefs).filter((ref) => ref.owned && ref.titleStatus === 'resolved')
        .length >= 2,
  ).length;
  byId('summary').textContent = `${state.games.length} canonical entries · ${StoreSchema.options
    .filter((store) => state.snapshots[store])
    .map(
      (store) =>
        `${countOwned(state, store)} ${store === 'battlenet' ? 'Battle.net' : store.toUpperCase()} entries`,
    )
    .join(' · ')} · ${shared} confirmed across stores`;
  renderGames();
  renderDevices();
  renderSync();
}

async function load(): Promise<void> {
  const requestId = ++refreshId;
  const [library, status, auth] = await Promise.all([
    browser.runtime
      .sendMessage({ type: 'state:getAdmin' })
      .then((value: unknown) => LibraryStateSchema.parse(value)),
    browser.runtime
      .sendMessage({ type: 'sync:getStatus' })
      .then((value: unknown) => SyncStatusSchema.parse(value)),
    browser.runtime
      .sendMessage({ type: 'amazon:getAuthStatus' })
      .then((value: unknown) => AmazonAuthStatusSchema.parse(value)),
  ]);
  if (requestId !== refreshId) return;
  state = library;
  syncStatus = status;
  amazonAuth = auth;
  // A completed OAuth flow enables only the explicitly connected provider.
  if (auth.connected && !status.settings.stores.includes('amazon')) {
    await browser.runtime.sendMessage({
      type: 'sync:configure',
      settings: SyncSettingsSchema.parse({
        ...status.settings,
        stores: [...status.settings.stores, 'amazon'],
      }),
    });
    return load();
  }
  render();
}

function loadFailed(): void {
  byId('summary').textContent = 'Failed to load local settings. Reopen this page and try again.';
  byId('sync-message').textContent =
    'Could not read current sync status. Reopen this page and try again.';
}

byId('search').addEventListener('input', renderGames);
byId('auto-sync').addEventListener('change', () => {
  void saveSyncSettings();
});
byId('interval').addEventListener('change', () => {
  void saveSyncSettings();
});
byId('sync-now').addEventListener('click', () => {
  void syncNow();
});
byId('open-steam').addEventListener('click', () => {
  void openStore('steam');
});
byId('open-gog').addEventListener('click', () => {
  void openStore('gog');
});
byId('open-epic').addEventListener('click', () => {
  void connectEpic().catch(() => {
    byId('sync-message').textContent = 'Could not open Epic. Retry from this page.';
  });
});
byId('connect-battlenet').addEventListener('click', () => {
  void connectBattleNet().catch(() => {
    byId('sync-message').textContent = 'Could not open Battle.net. Retry from this page.';
  });
});
byId('connect-amazon').addEventListener('click', () => {
  void (async () => {
    if (!syncStatus || syncBusy || amazonAuth.waiting) return;
    syncBusy = true;
    renderSync();
    try {
      if (
        !(await firefoxPermissions.request({
          origins: AMAZON_ORIGINS,
          data_collection: ['authenticationInfo'],
        }))
      )
        return;
      await browser.runtime.sendMessage({ type: 'amazon:startAuth' });
      await load();
      byId('sync-message').textContent =
        'Finish Amazon sign-in in the new tab yourself. Your saved libraries are unchanged.';
    } finally {
      syncBusy = false;
      renderSync();
    }
  })().catch(() => {
    byId('sync-message').textContent = 'Could not start Amazon sign-in. Retry from settings.';
  });
});
browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === 'local' &&
    Object.keys(changes).some((key) => key.startsWith('gaming-library-helper/'))
  ) {
    void load().catch(loadFailed);
  }
});
void load().catch(loadFailed);
