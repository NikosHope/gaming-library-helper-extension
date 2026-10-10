import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { collectGogCandidates, collectSteamCandidates } from '../src/adapters/page-dom';
import { createDefaultState } from '../src/core/defaults';
import { replaceStoreSnapshot } from '../src/core/library';

const api = vi.hoisted(() => ({ send: vi.fn(), listen: vi.fn(), changed: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: api.send, onMessage: { addListener: api.listen } },
    storage: { onChanged: { addListener: api.changed } },
  },
}));
const fixture = (name: string) =>
  readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('store title parsing', () => {
  it('reads Steam titles without including or removing the extension badge', () => {
    vi.stubGlobal('location', new URL('https://store.steampowered.com/search/'));
    const { document } = parseHTML(fixture('steam-decorated.html'));
    expect(
      collectSteamCandidates(document).map((candidate) => ({
        id: candidate.storeId,
        title: candidate.title,
      })),
    ).toEqual([{ id: '10', title: 'Example Space Game' }]);
    expect(document.querySelector('.glh-ownership-badge')).not.toBeNull();
  });
  it('reads GOG detail and tile titles without including the extension badge', () => {
    vi.stubGlobal('location', new URL('https://www.gog.com/game/example_space_game'));
    const { document } = parseHTML(fixture('gog-decorated.html'));
    expect(collectGogCandidates(document).map((candidate) => candidate.title)).toEqual([
      'Example Space Game',
      'Example Space Game',
    ]);
    expect(collectGogCandidates(document)[1]?.storeId).toBe('20');
    expect(document.querySelectorAll('.glh-ownership-badge')).toHaveLength(2);
  });
});

describe('content decoration refresh', () => {
  it('stabilizes after its own DOM changes while still responding to external page changes', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    api.send.mockClear();
    const { document, window } = parseHTML(fixture('steam-decorated.html'));
    document.querySelector('.glh-ownership-badge')?.remove();
    vi.stubGlobal('document', document);
    vi.stubGlobal('location', new URL('https://store.steampowered.com/search/'));
    vi.stubGlobal('MutationObserver', window.MutationObserver);
    vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
    const state = replaceStoreSnapshot(createDefaultState(), {
      store: 'gog',
      syncedAt: '2026-10-08T08:00:00.000Z',
      refs: [
        {
          store: 'gog',
          storeId: '20',
          title: 'Example Space Game',
          titleStatus: 'resolved',
          owned: true,
          ignoredAtSource: false,
          importedAt: '2026-10-08T08:00:00.000Z',
        },
      ],
    }).state;
    state.registry.records.push({
      identity: { provider: 'igdb', id: 1 },
      title: 'Example Space Game',
      kind: 'game',
      dependency: 'none',
      independenceEvidence: [],
      url: 'https://www.igdb.com/games/example-space-game',
      checkedAt: '2026-10-08T08:00:00.000Z',
      externalRefs: [
        { store: 'steam', storeId: '10' },
        { store: 'gog', storeId: '20' },
      ],
    });
    state.registry.matches.push({
      store: 'gog',
      storeId: '20',
      catalog: { provider: 'igdb', id: 1 },
      method: 'external-id',
      evidenceUrls: ['https://www.gog.com/game/example_space_game'],
      verifiedAt: '2026-10-08T08:00:00.000Z',
    });
    api.send.mockResolvedValue(state);
    const entrypoint = await import('../src/entrypoints/store.content');
    const main = entrypoint.default.main?.bind(entrypoint.default);
    if (typeof main !== 'function') throw new Error('Content entrypoint missing');
    Reflect.apply(main, undefined, []);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.glh-ownership-badge')).toHaveLength(1);
    const externalChange = document.createElement('p');
    externalChange.textContent = 'Store updated the page';
    document.body.append(externalChange);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.glh-ownership-badge')).toHaveLength(1);
    expect(collectSteamCandidates(document)[0]?.title).toBe('Example Space Game');
  });
});
