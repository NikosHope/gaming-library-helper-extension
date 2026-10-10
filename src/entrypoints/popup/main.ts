import { browser } from 'wxt/browser';
import { z } from 'zod/v3';
import { librarySummary } from '../../ui/catalog-library';
import { LibraryStateSchema, type LibraryState } from '../../core/schema';

const SyncResultSchema = z.object({
  gameCount: z.number().int().nonnegative(),
  summary: z.object({
    added: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  }),
});

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
};

let state: LibraryState;

function render(): void {
  const counts = librarySummary(state);
  byId('steam-count').textContent = String(counts.stores.steam);
  byId('gog-count').textContent = String(counts.stores.gog);
  byId('shared-count').textContent = String(counts.shared);
  byId('catalog-note').textContent =
    `${counts.games} verified games · ${counts.unknown} Unknown · ${counts.technical} technical · ${counts.products} saved products`;
  byId<HTMLInputElement>('highlight-owned').checked = state.settings.highlightOwnedOnOtherStore;
  byId<HTMLInputElement>('hide-owned').checked = state.settings.hideOwnedOnOtherStore;
  byId<HTMLInputElement>('hide-ignored').checked = state.settings.hideIgnored;
}

async function refresh(): Promise<void> {
  state = LibraryStateSchema.parse(await browser.runtime.sendMessage({ type: 'state:getAdmin' }));
  render();
}

async function saveDisplaySettings(): Promise<void> {
  state.settings.highlightOwnedOnOtherStore = byId<HTMLInputElement>('highlight-owned').checked;
  state.settings.hideOwnedOnOtherStore = byId<HTMLInputElement>('hide-owned').checked;
  state.settings.hideIgnored = byId<HTMLInputElement>('hide-ignored').checked;
  state = LibraryStateSchema.parse(
    await browser.runtime.sendMessage({ type: 'settings:update', settings: state.settings }),
  );
  render();
}

async function syncActiveTab(): Promise<void> {
  const button = byId<HTMLButtonElement>('sync');
  const status = byId('status');
  button.disabled = true;
  status.textContent = 'Syncing…';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab');
    const result = SyncResultSchema.parse(
      await browser.tabs.sendMessage(tab.id, {
        type: 'page:captureSnapshot',
      }),
    );
    await refresh();
    status.textContent = `Synced ${result.gameCount} source products. Added ${result.summary.added}, matched ${result.summary.matched}.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Sync failed';
  } finally {
    button.disabled = false;
  }
}

byId('sync').addEventListener('click', () => void syncActiveTab());
byId('options').addEventListener('click', () => void browser.runtime.openOptionsPage());
for (const id of ['highlight-owned', 'hide-owned', 'hide-ignored']) {
  byId(id).addEventListener('change', () => void saveDisplaySettings());
}

void refresh().catch((error: unknown) => {
  byId('status').textContent = error instanceof Error ? error.message : 'Failed to load library';
});
