import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { inputFromLocalDocument } from '../src/core/reconciliation-import';
import { replaceStoreSnapshot } from '../src/core/library';
import { exportLibrary, importLibrary } from '../src/core/backup';
import {
  RegistrySchema,
  CatalogRecordSchema,
  ProposalFileSchema,
  type Registry,
  type Footprint,
} from '../src/core/reconciliation-schema';
import {
  acceptedResult,
  applyAcceptedResult,
  classifyFootprint,
  classifyFootprints,
  createInputSnapshot,
  editionRoot,
  independentlyPlayable,
  projectLibrary,
  sourceFootprints,
  validateRegistry,
  verifyInputSnapshot,
} from '../src/core/reconciliation';

const now = '2026-10-09T10:00:00.000Z';
const product = (storeId: string, kind: Footprint['kind'] = 'unknown'): Footprint => ({
  store: 'steam',
  storeId,
  title: `Original ${storeId}`,
  titleStatus: kind === 'unknown' ? 'unresolved' : 'resolved',
  kind,
});
function record(id: number, storeId: string, overrides: Record<string, unknown> = {}) {
  return CatalogRecordSchema.parse({
    identity: { provider: 'igdb', id },
    title: `Catalog ${id}`,
    kind: 'game',
    dependency: 'none',
    url: `https://www.igdb.com/games/sample-${id}`,
    checkedAt: now,
    externalRefs: [{ store: 'steam', storeId }],
    ...overrides,
  });
}
function registry(pairs: [number, string][] = []): Registry {
  return RegistrySchema.parse({
    version: 1,
    records: pairs.map(([id, app]) => record(id, app)),
    matches: pairs.map(([id, storeId]) => ({
      store: 'steam',
      storeId,
      catalog: { provider: 'igdb', id },
      method: 'external-id',
      verifiedAt: now,
      evidenceUrls: [`https://store.steampowered.com/app/${storeId}/`],
    })),
  });
}
function pkg(data: Registry, appIds: string[], packageId = '817628', complete = true) {
  data.packages.push({
    packageId,
    appIds,
    source: 'valve-pics',
    complete,
    checkedAt: now,
    evidenceUrl: `https://store.steampowered.com/sub/${packageId}/`,
  });
  return data;
}
function state(ids: string[]) {
  return replaceStoreSnapshot(createDefaultState(), {
    store: 'steam',
    syncedAt: now,
    refs: ids.map((storeId) => ({
      store: 'steam',
      storeId,
      title: `Original ${storeId}`,
      titleStatus: 'unresolved',
      owned: true,
      ignoredAtSource: false,
      importedAt: now,
    })),
  }).state;
}

describe('catalog projection and package inference', () => {
  it('does not treat a missing catalog product type as contradictory positive evidence', () => {
    const data = registry([[1, '10']]);
    data.records[0] = record(1, '10', { kind: 'unknown', dependency: 'unknown' });
    data.records.push(
      CatalogRecordSchema.parse({
        ...record(2, '10'),
        identity: { provider: 'rawg', id: 2 },
        url: 'https://rawg.io/games/fixture',
      }),
    );
    data.matches.push({
      store: 'steam',
      storeId: '10',
      catalog: { provider: 'rawg', id: 2 },
      method: 'external-id',
      verifiedAt: now,
      evidenceUrls: ['https://store.steampowered.com/app/10/'],
    });
    expect(classifyFootprint(product('10', 'game'), data)).toMatchObject({
      role: 'game',
      family: 'rawg:2',
    });
  });
  it('keeps GTA app identity and creates no ownership from neighbours', () => {
    const data = pkg(
      registry([
        [1, '1546970'],
        [2, '1546990'],
        [3, '1547000'],
      ]),
      ['1546970', '1546990', '1547000', '3575160'],
    );
    expect(classifyFootprint(product('3575160'), data)).toMatchObject({
      role: 'bundle-related',
      inferred: true,
      footprint: { title: 'Original 3575160', storeId: '3575160' },
      packageIds: ['817628'],
      relatedFamilies: ['igdb:1', 'igdb:2', 'igdb:3'],
    });
    const source = state(['3575160']);
    source.registry = data;
    expect(projectLibrary(source).games).toEqual([]);
    expect(source.games).toHaveLength(1);
  });
  it('counts one basis and ignores unknown neighbours without naming a component', () => {
    const data = pkg(registry([[1, '10']]), ['10', '20', '30']);
    expect(classifyFootprint(product('20'), data)).toMatchObject({
      role: 'edition-or-component',
      inferred: true,
      relatedFamilies: ['igdb:1'],
    });
    expect(classifyFootprint(product('20'), pkg(registry(), ['20', '30']))).toMatchObject({
      role: 'unknown',
    });
  });
  it('requires a complete composition, accepts newer observations, and detects conflicting positive packages', () => {
    const data = pkg(
      registry([
        [1, '10'],
        [2, '11'],
      ]),
      ['10', '20'],
      '50',
      false,
    );
    expect(classifyFootprint(product('20'), data).role).toBe('unknown');
    pkg(data, ['10', '20'], '50');
    expect(classifyFootprint(product('20'), data).role).toBe('edition-or-component');
    pkg(data, ['11', '20'], '51');
    expect(classifyFootprint(product('20'), data)).toMatchObject({
      role: 'unknown',
      reason: 'Conflicting package game families',
    });
  });
  it('does not demote a confirmed game because it is in a package', () => {
    const data = pkg(
      registry([
        [1, '10'],
        [2, '11'],
      ]),
      ['10', '11', '20'],
    );
    expect(classifyFootprint(product('10', 'game'), data).role).toBe('game');
    expect(classifyFootprint(product('20', 'game'), data).role).toBe('unknown');
  });
  it('maps confirmed component parents to the game basis', () => {
    const data = registry([
      [1, '10'],
      [2, '11'],
    ]);
    data.records[1] = record(2, '11', {
      kind: 'component',
      dependency: 'base-game',
      parent: { provider: 'igdb', id: 1 },
    });
    pkg(data, ['11', '20']);
    expect(classifyFootprint(product('20'), data).relatedFamilies).toEqual(['igdb:1']);
    expect(classifyFootprint(product('11', 'component'), data)).toMatchObject({
      role: 'component',
      relatedFamilies: ['igdb:1'],
    });
  });
  it('supports PICS type/parent observations without mutating original footprints', () => {
    const data = registry([[1, '10']]);
    data.products.push({
      ...product('11', 'component'),
      parentStoreId: '10',
      source: 'valve-pics',
      sourceUrl: 'https://store.steampowered.com/app/11/',
      checkedAt: now,
    });
    pkg(data, ['11', '20']);
    expect(classifyFootprint(product('20'), data).role).toBe('edition-or-component');
    expect(classifyFootprint(product('11'), data).role).toBe('component');
    expect(product('11').kind).toBe('unknown');
  });
  it('keeps tools technical, but surfaces positive type contradictions', () => {
    expect(classifyFootprint(product('10', 'tool'), registry()).role).toBe('tool');
    expect(classifyFootprint(product('10', 'auxiliary'), registry()).role).toBe('auxiliary');
    expect(classifyFootprint(product('10', 'tool'), registry([[1, '10']])).role).toBe('unknown');
    expect(classifyFootprint(product('10', 'component'), registry([[1, '10']])).role).toBe(
      'unknown',
    );
    const data = registry();
    data.products.push(
      {
        ...product('10', 'tool'),
        source: 'valve-pics',
        sourceUrl: 'https://store.steampowered.com/app/10/',
        checkedAt: now,
      },
      {
        ...product('10', 'game'),
        source: 'valve-pics',
        sourceUrl: 'https://store.steampowered.com/app/10/',
        checkedAt: now,
      },
    );
    expect(classifyFootprint(product('10'), data).reason).toBe('Conflicting product types');
  });
  it('merges editions and several products from one store, while keeping remakes and remasters', () => {
    const source = state(['10', '11', '12', '13', '14']);
    const data = registry([
      [1, '10'],
      [2, '11'],
      [3, '12'],
      [4, '13'],
      [5, '14'],
    ]);
    data.records[1] = record(2, '11', {
      kind: 'edition',
      versionParent: { provider: 'igdb', id: 1 },
    });
    data.records[2] = record(3, '12', { kind: 'remake' });
    data.records[3] = record(4, '13', { kind: 'remaster' });
    data.records[4] = record(5, '14', {
      kind: 'component',
      dependency: 'base-game',
      parent: { provider: 'igdb', id: 1 },
    });
    source.registry = data;
    const projection = projectLibrary(source);
    expect(projection.games).toHaveLength(3);
    expect(projection.games[0]?.products.map((item) => item.footprint.storeId)).toEqual([
      '10',
      '11',
    ]);
    expect(projection.games[0]?.components[0]?.footprint.storeId).toBe('14');
    expect(projection.games[0]?.sourceRecordIds).toHaveLength(2);
    expect(importLibrary(exportLibrary(source))).toEqual(source);
  });
  it('requires launch evidence for mods and accepts independent expansions', () => {
    const data = registry([[1, '10']]);
    data.records[0] = record(1, '10', { kind: 'mod', dependency: 'free-engine' });
    expect(classifyFootprint(product('10', 'component'), data).role).toBe('component');
    data.records[0].independenceEvidence = ['https://example.org/official-requirements'];
    expect(classifyFootprint(product('10', 'component'), data).role).toBe('game');
    data.records[0].dependency = 'base-game';
    expect(independentlyPlayable(data.records[0])).toBe(false);
    data.records[0] = record(1, '10', { kind: 'standalone-expansion' });
    expect(classifyFootprint(product('10', 'component'), data).role).toBe('game');
  });
  it('does not turn title search or LLM proposals into an identity', () => {
    const data = registry();
    data.proposals.push({
      id: crypto.randomUUID(),
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id: 1 },
      evidenceUrls: ['https://www.igdb.com/games/sample'],
      rationale: 'Title looks similar',
      origin: 'llm',
    });
    const source = state(['10']);
    source.registry = data;
    expect(projectLibrary(source).unknown).toHaveLength(1);
    expect(projectLibrary(source).games).toHaveLength(0);
    expect(
      ProposalFileSchema.safeParse({
        version: 1,
        inputHash: 'a'.repeat(64),
        proposals: [{ ...data.proposals[0], approved: true }],
      }).success,
    ).toBe(false);
  });
  it('detects conflicting IDs, catalog categories and explicit conflict issues', () => {
    const data = registry([
      [1, '10'],
      [2, '10'],
    ]);
    expect(classifyFootprint(product('10'), data).role).toBe('unknown');
    data.matches.pop();
    data.records.pop();
    data.issues.push({
      store: 'steam',
      storeId: '10',
      reason: 'conflicting-evidence',
      message: 'Two official sources disagree',
    });
    expect(classifyFootprint(product('10'), data).role).toBe('unknown');
    data.issues = [];
    data.records[0] = record(1, '10', { kind: 'component' });
    expect(classifyFootprint(product('10', 'game'), data).role).toBe('unknown');
  });
  it('bridges two catalogs only with verified shared store identity', () => {
    const data = registry([[1, '10']]);
    data.records.push(record(5, '10', { identity: { provider: 'rawg', id: 5 } }));
    data.matches.push({ ...data.matches[0]!, catalog: { provider: 'rawg', id: 5 } });
    const source = state(['10']);
    source.registry = data;
    expect(projectLibrary(source).games[0]?.identity).toEqual({ provider: 'igdb', id: 1 });
    data.records[1]!.kind = 'remake';
    expect(projectLibrary(source).games).toHaveLength(0);
  });
  it('does not infer package roles from conflicted neighbours or incompatible catalog bridges', () => {
    const data = pkg(registry([[1, '10']]), ['10', '20']);
    expect(
      classifyFootprints([product('10', 'tool'), product('20')], data).map((item) => item.role),
    ).toEqual(['unknown', 'unknown']);
    const conflicting = registry([
      [1, '10'],
      [2, '11'],
    ]);
    conflicting.records.push(
      record(3, '10', {
        identity: { provider: 'rawg', id: 3 },
        externalRefs: [
          { store: 'steam', storeId: '10' },
          { store: 'steam', storeId: '11' },
        ],
      }),
    );
    conflicting.matches.push(
      ...conflicting.matches.map((match) => ({
        ...match,
        catalog: { provider: 'rawg' as const, id: 3 },
      })),
    );
    expect(
      classifyFootprints([product('10'), product('11')], conflicting).map((item) => item.role),
    ).toEqual(['unknown', 'unknown']);
  });
});

describe('exchange validation and privacy', () => {
  it('imports retained v5 row exports and backups without copying private annotations', async () => {
    const input = await inputFromLocalDocument({
      version: 5,
      exportedAt: now,
      account: 'Private account',
      rows: [
        {
          store: 'steam',
          providerId: '10',
          providerTitle: 'Alpha',
          titleStatus: 'resolved',
          importedAt: now,
          canonicalId: 'Private UUID',
          notes: 'Private note',
        },
      ],
    });
    expect(input.products[0]).toMatchObject({
      store: 'steam',
      storeId: '10',
      title: 'Alpha',
      observedAt: now,
      kind: 'unknown',
    });
    expect(JSON.stringify(input)).not.toContain('Private');
    expect(await inputFromLocalDocument(input)).toEqual(input);
    const source = state(['10']);
    source.games[0]!.notes = 'Private note';
    expect(
      (await inputFromLocalDocument(JSON.parse(exportLibrary(source)) as unknown)).products[0]
        ?.storeId,
    ).toBe('10');
    await expect(inputFromLocalDocument({ version: 5, rows: [] })).rejects.toThrow();
  });
  it('exports only public footprints and rejects tampering', async () => {
    const source = state(['10']);
    const game = source.games[0]!;
    game.notes = 'Personal note';
    game.aliases = ['Private alias'];
    game.storeRefs.steam!.url = 'https://store.steampowered.com/app/10/?token=synthetic';
    const input = await createInputSnapshot(source, now);
    const json = JSON.stringify(input);
    expect(json).not.toContain('Personal note');
    expect(json).not.toContain('Private alias');
    expect(json).not.toContain('synthetic');
    expect(json).not.toContain(game.id);
    expect(await verifyInputSnapshot(input)).toEqual(input);
    await expect(verifyInputSnapshot({ ...input, inputHash: 'a'.repeat(64) })).rejects.toThrow(
      /hash/u,
    );
    game.storeRefs.steam!.url = 'https://store.steampowered.com/app/10/Example/?l=english';
    expect(sourceFootprints(source)[0]?.publicUrl).toBe(
      'https://store.steampowered.com/app/10/Example',
    );
    game.storeRefs.steam!.url = 'https://store.steampowered.com/app/20/';
    expect(sourceFootprints(source)[0]?.publicUrl).toBeUndefined();
    game.storeRefs.steam!.classification = {
      kind: 'game',
      source: 'store-metadata',
      confidence: 'primary',
      evidenceUrls: [
        'https://example.org/requirements?account_id=private-account',
        'https://example.org/requirements#access_token=synthetic',
      ],
    };
    const sanitized = sourceFootprints(source);
    expect(sanitized[0]?.classification).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain('private-account');
    expect(JSON.stringify(sanitized)).not.toContain('synthetic');
  });
  it('applies metadata atomically, preserves all ownership and annotations, and rejects stale input', async () => {
    const source = state(['10']);
    source.games[0]!.notes = 'Keep';
    const before = structuredClone(source);
    const result = acceptedResult(
      await createInputSnapshot(source, now),
      registry([[1, '10']]),
      now,
    );
    const next = await applyAcceptedResult(source, result);
    expect(next.games).toEqual(before.games);
    expect(source).toEqual(before);
    expect(projectLibrary(next).games).toHaveLength(1);
    expect(await applyAcceptedResult(next, result)).toEqual(next);
    const stale = state(['10', '11']);
    await expect(applyAcceptedResult(stale, result)).rejects.toThrow(/stale/u);
    expect(stale.registry.matches).toEqual([]);
  });
  it('rejects fabricated automatic matches, missing or cyclic parents and reviews', () => {
    const data = registry([[1, '10']]);
    data.records[0]!.externalRefs = [];
    expect(() => validateRegistry(data)).toThrow(/exact/u);
    data.matches[0]!.method = 'human-review';
    data.matches[0]!.reviewId = crypto.randomUUID();
    expect(() => validateRegistry(data)).toThrow(/ledger/u);
    data.matches = [];
    data.records[0] = record(1, '10', {
      kind: 'edition',
      versionParent: { provider: 'igdb', id: 2 },
    });
    data.records.push(
      record(2, '11', { kind: 'edition', versionParent: { provider: 'igdb', id: 1 } }),
    );
    expect(editionRoot({ provider: 'igdb', id: 1 }, data)).toBeUndefined();
    expect(() => validateRegistry(data)).toThrow(/cyclic/u);
    data.records = [record(1, '10', { parent: { provider: 'igdb', id: 9 } })];
    expect(() => validateRegistry(data)).toThrow(/parent/u);
    data.records = [record(1, '10'), record(1, '10')];
    expect(() => validateRegistry(data)).toThrow(/duplicate/u);
  });
  it('requires the review receipt to belong to the current input', async () => {
    const source = state(['10']);
    const input = await createInputSnapshot(source, now);
    const data = registry([[1, '10']]);
    const reviewId = crypto.randomUUID();
    data.matches[0] = { ...data.matches[0]!, method: 'human-review', reviewId };
    data.reviews.push({
      reviewId,
      proposalId: crypto.randomUUID(),
      inputHash: 'a'.repeat(64),
      approvedAt: now,
      reviewer: 'human',
      store: 'steam',
      storeId: '10',
      catalog: { provider: 'igdb', id: 1 },
      evidenceUrls: ['https://www.igdb.com/games/sample'],
    });
    await expect(applyAcceptedResult(source, acceptedResult(input, data))).rejects.toThrow(
      /different snapshot/u,
    );
    data.reviews[0]!.inputHash = input.inputHash;
    expect(
      (await applyAcceptedResult(source, acceptedResult(input, data))).registry.reviews,
    ).toHaveLength(1);
  });
});
