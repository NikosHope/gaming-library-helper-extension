import { browser } from 'wxt/browser';
import { countOwned } from '../../core/library';
import { LibraryStateSchema, type LibraryState } from '../../core/schema';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing options element: ${id}`);
  return element as T;
};

let state: LibraryState;

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = row.insertCell();
  cell.textContent = value;
}

function renderGames(): void {
  const query = byId<HTMLInputElement>('search').value.trim().toLocaleLowerCase();
  const body = byId<HTMLTableSectionElement>('games');
  body.replaceChildren();
  const games = [...state.games]
    .filter((game) => game.displayTitle.toLocaleLowerCase().includes(query))
    .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle));

  for (const game of games) {
    const row = body.insertRow();
    appendCell(row, game.displayTitle);
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
  byId<HTMLInputElement>('prices-enabled').checked = state.settings.prices.enabled;
  byId<HTMLInputElement>('country').value = state.settings.prices.country;
  byId<HTMLInputElement>('api-key').value = state.settings.prices.apiKey;
  const shared = state.games.filter(
    (game) => game.storeRefs.steam?.owned && game.storeRefs.gog?.owned,
  ).length;
  byId('summary').textContent =
    `${state.games.length} canonical games · ${countOwned(state, 'steam')} Steam · ${countOwned(state, 'gog')} GOG · ${shared} on both`;
  renderGames();
  renderDevices();
}

async function load(): Promise<void> {
  state = LibraryStateSchema.parse(await browser.runtime.sendMessage({ type: 'state:getAdmin' }));
  render();
}

async function savePriceSettings(): Promise<void> {
  const status = byId('price-status');
  const enabled = byId<HTMLInputElement>('prices-enabled').checked;
  const apiKey = byId<HTMLInputElement>('api-key').value.trim();
  const country = byId<HTMLInputElement>('country').value.trim().toUpperCase();
  if (enabled && (!apiKey || !/^[A-Z]{2}$/u.test(country))) {
    status.textContent = 'Enter an API key and a two-letter country code.';
    return;
  }

  if (enabled) {
    const descriptor = {
      origins: ['https://api.isthereanydeal.com/*'],
      data_collection: ['websiteContent', 'authenticationInfo'],
    } as Parameters<typeof browser.permissions.request>[0] & { data_collection: string[] };
    const granted = await browser.permissions.request(descriptor);
    if (!granted) {
      status.textContent = 'Permission was not granted; prices remain disabled.';
      return;
    }
  }

  state.settings.prices = { enabled, apiKey, country: country || 'CA' };
  state = LibraryStateSchema.parse(
    await browser.runtime.sendMessage({ type: 'settings:update', settings: state.settings }),
  );
  status.textContent = enabled ? 'Price provider enabled.' : 'Price provider disabled.';
  render();
}

byId('search').addEventListener('input', renderGames);
byId('save-prices').addEventListener('click', () => void savePriceSettings());
void load().catch((error: unknown) => {
  byId('summary').textContent = error instanceof Error ? error.message : 'Failed to load settings';
});
