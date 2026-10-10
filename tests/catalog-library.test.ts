import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createDefaultState } from '../src/core/defaults';
import { replaceStoreSnapshot } from '../src/core/library';
import { setIgnoredRecords, setIgnoredProducts, isProductIgnored } from '../src/core/annotations';
import { createPageLibrary } from '../src/core/library';
import { exportLibrary, importLibrary } from '../src/core/backup';
import { contentHash, createInputSnapshot } from '../src/core/reconciliation';
import { RuntimeRequestSchema } from '../src/core/messages';
import { CatalogRecordSchema, RegistrySchema } from '../src/core/reconciliation-schema';
import {
  librarySummary,
  renderCatalogLibrary,
  type CatalogRenderOptions,
} from '../src/ui/catalog-library';
import type { LibraryState, Store } from '../src/core/schema';

const now = '2026-10-09T10:00:00.000Z';
function source(ids: string[], store: Store = 'steam', initial = createDefaultState()) {
  return replaceStoreSnapshot(initial, {
    store,
    syncedAt: now,
    refs: ids.map((storeId) => ({
      store,
      storeId,
      title: `Original ${storeId}`,
      titleStatus: 'unresolved' as const,
      owned: true,
      ignoredAtSource: false,
      importedAt: now,
    })),
  }).state;
}
function catalog(id: number, storeId: string, overrides: Record<string, unknown> = {}) {
  return CatalogRecordSchema.parse({
    identity: { provider: 'igdb', id },
    title: `Game ${id}`,
    kind: 'game',
    dependency: 'none',
    url: `https://www.igdb.com/games/fixture-${id}`,
    checkedAt: now,
    externalRefs: [{ store: 'steam', storeId }],
    ...overrides,
  });
}
function exact(state: LibraryState, id: number, storeId: string, store: Store = 'steam') {
  state.registry.records.push(catalog(id, storeId, { externalRefs: [{ store, storeId }] }));
  state.registry.matches.push({
    store,
    storeId,
    catalog: { provider: 'igdb', id },
    method: 'external-id',
    evidenceUrls: ['https://www.igdb.com/games/fixture'],
    verifiedAt: now,
  });
}
function view(state: LibraryState, overrides: Partial<CatalogRenderOptions> = {}) {
  const { document } = parseHTML(
    '<html><body><div id="panel-games"></div><div id="panel-unknown"></div><div id="panel-technical"></div></body></html>',
  );
  const options: CatalogRenderOptions = {
    panel: 'games',
    query: '',
    page: 0,
    canReview: false,
    pendingReviews: new Set(),
    onIgnored: vi.fn(async () => {}),
    onApprove: vi.fn(async () => {}),
    ...overrides,
  };
  const result = renderCatalogLibrary(document, state, options);
  return { document, options, result };
}

describe('catalog library presentation', () => {
  it('groups editions and several products per store while retaining product-specific IDs, OS and annotations', async () => {
    const state = source(['10', '11']);
    exact(state, 1, '10');
    exact(state, 2, '11');
    state.registry.records[1] = catalog(2, '11', {
      kind: 'edition',
      versionParent: { provider: 'igdb', id: 1 },
    });
    state.registry.records[0]!.externalRefs.push({ store: 'gog', storeId: '20' });
    const owned = source(['20'], 'gog', state);
    owned.registry.matches.push({
      store: 'gog',
      storeId: '20',
      catalog: { provider: 'igdb', id: 1 },
      method: 'external-id',
      verifiedAt: now,
      evidenceUrls: ['https://www.gog.com/game/fixture'],
    });
    owned.games[0]!.notes = 'Private annotation stays local';
    owned.registry.platforms.push({
      store: 'steam',
      storeId: '10',
      windows: true,
      macos: false,
      checkedAt: now,
      evidenceUrl: 'https://store.steampowered.com/app/10/',
    });
    const rendered = view(owned);
    expect(rendered.result.total).toBe(1);
    expect(rendered.document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(rendered.document.body.textContent).toContain('3 owned products');
    for (const value of [
      'Steam · 10',
      'Steam · 11',
      'GOG · 20',
      'macOS: no',
      'Linux: unknown',
      'Official OS unknown',
      'Private annotation stays local',
      'igdb:2 · edition',
    ])
      expect(rendered.document.body.textContent).toContain(value);
    expect(librarySummary(owned)).toMatchObject({
      games: 1,
      products: 3,
      shared: 1,
      stores: { steam: 1, gog: 1 },
    });
    rendered.document.querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    expect(rendered.options.onIgnored).toHaveBeenCalledWith(
      expect.arrayContaining([
        { store: 'steam', storeId: '10' },
        { store: 'steam', storeId: '11' },
        { store: 'gog', storeId: '20' },
      ]),
      true,
    );
  });
  it('keeps LLM candidates in Unknown and requires a checked ID and connected runner for the explicit review action', async () => {
    const state = source(['10']);
    const id = crypto.randomUUID();
    state.registry.records.push(catalog(1, '10'));
    state.registry.proposals.push({
      id,
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id: 1 },
      origin: 'llm',
      rationale: 'Possible title match',
      evidenceUrls: ['https://www.igdb.com/games/fixture-1'],
    });
    expect(view(state).result.total).toBe(0);
    expect(
      view(state, { panel: 'unknown', canReview: true }).document.querySelector<HTMLButtonElement>(
        'button',
      )!.disabled,
    ).toBe(true);
    state.registry.candidateChecks.push({
      proposalId: id,
      outcome: 'exists',
      checkedAt: now,
    });
    expect(
      view(state, { panel: 'unknown' }).document.querySelector<HTMLButtonElement>('button')!
        .disabled,
    ).toBe(true);
    const rendered = view(state, { panel: 'unknown', canReview: true });
    expect(rendered.document.body.textContent).toContain('not a confirmed identity');
    rendered.document.querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    expect(rendered.options.onApprove).toHaveBeenCalledWith(state.registry.proposals[0], false);
    expect(state.registry.matches).toHaveLength(0);
    expect(librarySummary(state).games).toBe(0);
    expect(
      view(state, { panel: 'unknown', canReview: true, pendingReviews: new Set([id]) }).document
        .body.textContent,
    ).toContain('Decision recorded');
  });
  it('shows the GTA app and package evidence as technical without renaming it or creating neighbour ownership', () => {
    const state = source(['3575160']);
    exact(state, 1, '1546970');
    exact(state, 2, '1546990');
    exact(state, 3, '1547000');
    state.registry.packages.push({
      packageId: '817628',
      appIds: ['1546970', '1546990', '1547000', '3575160'],
      complete: true,
      source: 'valve-pics',
      checkedAt: now,
      evidenceUrl: 'https://store.steampowered.com/sub/817628/',
    });
    const rendered = view(state, { panel: 'technical' });
    expect(rendered.result.total).toBe(1);
    expect(rendered.document.querySelector('tbody strong')!.textContent).toBe('Original 3575160');
    expect(rendered.document.body.textContent).toContain('bundle-related (inferred)');
    expect(rendered.document.body.textContent).toContain('Steam package 817628');
    expect(librarySummary(state)).toMatchObject({ games: 0, technical: 1, products: 1 });
    expect(state.games).toHaveLength(1);
  });
  it('renders hostile imported text as plain text and filters source IDs across pagination', () => {
    const state = source(Array.from({ length: 205 }, (_, i) => String(i + 1)));
    state.games[0]!.displayTitle = '<img src=x onerror=alert(1)>';
    state.games[0]!.storeRefs.steam!.title = '<img src=x onerror=alert(1)>';
    state.games[0]!.notes = '<script>alert(2)</script>';
    const first = view(state, { panel: 'unknown' });
    expect(first.result).toEqual({ total: 205, pages: 3, page: 0 });
    expect(first.document.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(first.document.querySelector('img,script')).toBeNull();
    expect(first.document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(view(state, { panel: 'unknown', page: 99 }).result.page).toBe(2);
    const found = view(state, { panel: 'unknown', query: 'steam:205' });
    expect(found.result.total).toBe(1);
    expect(found.document.body.textContent).toContain('Original 205');
    expect(librarySummary(state)).toMatchObject({ games: 0, unknown: 205, products: 205 });
    expect(RegistrySchema.safeParse(state.registry).success).toBe(true);
  });
});

describe('atomic game annotations', () => {
  it('isolates an ignore decision when a legacy UUID projects to two different catalog games', async () => {
    const state = source(['10']);
    const legacy = state.games[0]!;
    legacy.notes = 'Original private note';
    legacy.storeRefs.gog = {
      store: 'gog',
      storeId: '20',
      title: 'Another original game',
      titleStatus: 'resolved',
      owned: true,
      ignoredAtSource: false,
      importedAt: now,
    };
    exact(state, 1, '10');
    exact(state, 2, '20', 'gog');
    const beforeHash = (await createInputSnapshot(state)).inputHash;
    const updated = setIgnoredProducts(state, [{ store: 'steam', storeId: '10' }], true);
    expect(updated.games).toBe(state.games);
    expect(isProductIgnored(updated, { store: 'steam', storeId: '10' })).toBe(true);
    expect(isProductIgnored(updated, { store: 'gog', storeId: '20' })).toBe(false);
    const index = createPageLibrary(updated);
    expect(index.get('steam:10')!.ignored).toBe(true);
    expect(index.get('gog:20')!.ignored).toBe(false);
    expect(view(updated).document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect((await createInputSnapshot(updated)).inputHash).toBe(beforeHash);
    expect(await contentHash(importLibrary(exportLibrary(updated)))).toBe(
      await contentHash(updated),
    );
    expect(() => setIgnoredProducts(state, [{ store: 'steam', storeId: 'missing' }], true)).toThrow(
      'changed',
    );
    expect(() =>
      setIgnoredProducts(
        state,
        [
          { store: 'steam', storeId: '10' },
          { store: 'steam', storeId: '10' },
        ],
        true,
      ),
    ).toThrow('changed');
  });
  it('allows a product override to unignore one game without changing the legacy ignore flag or another game', () => {
    const state = source(['10']);
    state.games[0]!.ignored = true;
    state.games[0]!.storeRefs.gog = {
      store: 'gog',
      storeId: '20',
      title: 'Another game',
      titleStatus: 'resolved',
      owned: true,
      ignoredAtSource: false,
      importedAt: now,
    };
    const updated = setIgnoredProducts(state, [{ store: 'steam', storeId: '10' }], false);
    expect(isProductIgnored(updated, { store: 'steam', storeId: '10' })).toBe(false);
    expect(isProductIgnored(updated, { store: 'gog', storeId: '20' })).toBe(true);
    expect(updated.games[0]!.ignored).toBe(true);
    const request = {
      type: 'library:setProductsIgnored',
      products: [{ store: 'steam', storeId: '10' }],
      ignored: false,
    };
    expect(RuntimeRequestSchema.safeParse(request).success).toBe(true);
    expect(
      RuntimeRequestSchema.safeParse({
        ...request,
        products: [...request.products, ...request.products],
      }).success,
    ).toBe(false);
    expect(
      RuntimeRequestSchema.safeParse({
        ...request,
        products: [{ store: 'steam', storeId: '10', owned: true }],
      }).success,
    ).toBe(false);
  });
  it('updates every source UUID in a game without losing ownership, catalog or unrelated annotations', () => {
    const state = source(['10', '11', '12']);
    state.games[0]!.notes = 'local note';
    const updated = setIgnoredRecords(
      state,
      state.games.slice(0, 2).map((game) => game.id),
      true,
    );
    expect(updated.games.map((game) => game.ignored)).toEqual([true, true, false]);
    expect(updated.games.map((game) => game.id)).toEqual(state.games.map((game) => game.id));
    expect(updated.games[0]!.storeRefs).toEqual(state.games[0]!.storeRefs);
    expect(updated.games[0]!.notes).toBe('local note');
    expect(updated.registry).toBe(state.registry);
    expect(state.games[0]!.ignored).toBe(false);
    for (const ids of [[], [state.games[0]!.id, state.games[0]!.id], [crypto.randomUUID()]])
      expect(() => setIgnoredRecords(state, ids, true)).toThrow('changed');
  });
  it('validates the batch message without accepting duplicated, arbitrary or extra fields', () => {
    const request = {
      type: 'library:setIgnoredMany',
      gameIds: [crypto.randomUUID()],
      ignored: true,
    };
    expect(RuntimeRequestSchema.safeParse(request).success).toBe(true);
    for (const payload of [
      { ...request, gameIds: [] },
      { ...request, gameIds: ['not-a-uuid'] },
      { ...request, gameIds: [request.gameIds[0], request.gameIds[0]] },
      { ...request, owned: true },
    ])
      expect(RuntimeRequestSchema.safeParse(payload).success).toBe(false);
  });
});
