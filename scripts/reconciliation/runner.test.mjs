import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, utimes, open, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createDefaultState } from '../../src/core/defaults.ts';
import { replaceStoreSnapshot } from '../../src/core/library.ts';
import { createInputSnapshot, contentHash } from '../../src/core/reconciliation.ts';
import { CatalogRecordSchema, CollectedSchema } from '../../src/core/reconciliation-schema.ts';
import { publishSnapshot, atomicWrite, readJson, withLock, MAX_DOCUMENT_BYTES } from './io.mjs';
import { createNativeSession, encodeFrame, runHost } from './native-host.mjs';
import { collect, validate, approve } from './pipeline.mjs';
import { parsePicsApp, parsePicsPackage, collectPics } from './pics.mjs';
import {
  parseIgdbGame,
  parseRawgGame,
  exactExternalRefs,
  storeUrlKey,
  createCatalogs,
} from './catalogs.mjs';
import { requestJson } from './network.mjs';
import { SourceError } from './network.mjs';

const now = '2026-10-09T10:00:00.000Z';
test('patched protobuf dependency supports Steam static codecs and PICS request encoding', () => {
  const require = createRequire(import.meta.url);
  const fromSteam = createRequire(require.resolve('steam-user'));
  const fromTicket = createRequire(fromSteam.resolve('steam-appticket'));
  assert.equal(fromTicket('protobufjs/package.json').version, '7.6.6');
  const ticket = fromTicket('./protobufs/generated/encrypted_app_ticket.js').EncryptedAppTicket;
  const bytes = ticket
    .encode({ ticket_version_no: 1, encrypted_ticket: Buffer.from([1, 2, 3]) })
    .finish();
  const decoded = ticket.decode(bytes);
  assert.equal(decoded.ticket_version_no, 1);
  assert.deepEqual([...decoded.encrypted_ticket], [1, 2, 3]);
  const schema = fromSteam('./protobufs/generated/_load.js');
  const request = schema.CMsgClientPICSProductInfoRequest;
  const message = request.fromObject({ apps: [{ appid: 10 }], packages: [{ packageid: 817628 }] });
  const result = request.toObject(request.decode(request.encode(message).finish()));
  assert.equal(result.apps[0].appid, 10);
  assert.equal(result.packages[0].packageid, 817628);
});
const original = {
  store: 'steam',
  storeId: '10',
  title: 'Fictional Alpha',
  titleStatus: 'resolved',
  owned: true,
  ignoredAtSource: false,
  importedAt: now,
};
const makeInput = () =>
  createInputSnapshot(
    replaceStoreSnapshot(createDefaultState(), { store: 'steam', syncedAt: now, refs: [original] })
      .state,
    now,
  );
const game = () =>
  CatalogRecordSchema.parse({
    identity: { provider: 'igdb', id: 1 },
    title: 'Fictional Alpha',
    kind: 'game',
    dependency: 'none',
    url: 'https://www.igdb.com/games/fictional-alpha',
    checkedAt: now,
    externalRefs: [{ store: 'steam', storeId: '10' }],
  });
const fakeCatalogs = () => ({
  configured: { igdb: true, rawg: false },
  exactSteam: async () => [game()],
  get: async () => game(),
  search: async () => [],
});
const noPics = async () => ({ products: [], packages: [], platforms: [], issues: [] });
async function local(action) {
  const root = await mkdtemp(join(tmpdir(), 'glh-reconcile-'));
  try {
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('fixed native operations, framing, chunks and idempotent snapshot publication', () =>
  local(async (root) => {
    const input = await makeInput();
    const native = createNativeSession(root);
    const text = JSON.stringify(input);
    assert.deepEqual(await native({ op: 'exec', command: 'untrusted' }), {
      status: 'error',
      code: 'invalid-message',
    });
    assert.equal(
      (await native({ op: 'publish:begin', inputHash: input.inputHash, characters: text.length }))
        .changed,
      true,
    );
    assert.equal((await native({ op: 'publish:chunk', offset: 1, data: text })).status, 'error');
    assert.equal((await native({ op: 'publish:chunk', offset: 0, data: text })).status, 'ok');
    assert.equal((await native({ op: 'publish:commit' })).changed, true);
    assert.equal(
      (await native({ op: 'publish:begin', inputHash: input.inputHash, characters: text.length }))
        .changed,
      false,
    );
    assert.deepEqual(await native({ op: 'result:read', inputHash: input.inputHash, offset: 0 }), {
      status: 'waiting',
    });
    const stream = new PassThrough();
    const output = new PassThrough();
    const buffers = [];
    output.on('data', (chunk) => buffers.push(chunk));
    const running = runHost(stream, output, root);
    const frame = encodeFrame({ op: 'result:read', inputHash: input.inputHash, offset: 0 });
    stream.write(frame.subarray(0, 3));
    stream.end(frame.subarray(3));
    await running;
    assert.equal(JSON.parse(Buffer.concat(buffers).subarray(4).toString()).status, 'waiting');
  }));
test('collect/validate/read cycle, stale and concurrent runs, and last-result preservation', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    assert.equal((await collect({ root, pics: noPics, catalogsFactory: fakeCatalogs })).matches, 1);
    assert.equal((await validate({ root, catalogsFactory: fakeCatalogs })).games, 1);
    const native = createNativeSession(root);
    const response = await native({ op: 'result:read', inputHash: input.inputHash, offset: 0 });
    assert.equal(response.status, 'chunk');
    assert.equal(response.hash, await contentHash(JSON.parse(response.data)));
    assert.equal(
      (await native({ op: 'result:read', inputHash: 'a'.repeat(64), offset: 0 })).code,
      'stale-input',
    );
    const previous = await readFile(join(root, 'result.json'), 'utf8');
    await assert.rejects(
      validate({
        root,
        catalogsFactory: () => ({
          ...fakeCatalogs(),
          get: () => {
            throw new Error('offline');
          },
        }),
      }),
      /unchanged/u,
    );
    assert.equal(await readFile(join(root, 'result.json'), 'utf8'), previous);
    const changed = {
      ...input,
      createdAt: '2026-10-09T11:00:00.000Z',
      products: [...input.products, { ...input.products[0], storeId: '20' }],
    };
    changed.inputHash = await contentHash(changed.products);
    await publishSnapshot(changed, root);
    await assert.rejects(validate({ root, catalogsFactory: fakeCatalogs }), /stale/u);
    assert.equal(await readFile(join(root, 'result.json'), 'utf8'), previous);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const active = withLock(root, 'runner', async () => {
      entered();
      await gate;
    });
    await started;
    await assert.rejects(
      withLock(root, 'runner', () => undefined),
      /Another/u,
    );
    release();
    await active;
  }));
test('native review requires the exact current Firefox snapshot and never approves stale input', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    const calls = [];
    const native = createNativeSession(root, async (...args) => calls.push(args));
    const proposalId = randomUUID();
    assert.equal(
      (await native({ op: 'review:approve', proposalId, independence: false })).code,
      'invalid-message',
    );
    assert.equal(
      (
        await native({
          op: 'review:approve',
          proposalId,
          independence: false,
          inputHash: 'f'.repeat(64),
        })
      ).code,
      'stale-input',
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await native({
          op: 'review:approve',
          proposalId,
          independence: false,
          inputHash: input.inputHash,
        })
      ).status,
      'ok',
    );
    assert.deepEqual(calls, [
      [proposalId, { root, human: true, independence: false, expectedInputHash: input.inputHash }],
    ]);
  }));
test('missing catalog credentials do not claim a confirmed absence of a catalog ID', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    await collect({
      root,
      pics: noPics,
      catalogsFactory: () => ({ configured: { igdb: false, rawg: false } }),
    });
    const { registry } = await readJson(join(root, 'collected.json'));
    assert.equal(
      registry.issues.filter((issue) => issue.reason === 'catalog-not-configured').length,
      2,
    );
    assert.equal(
      registry.issues.some((issue) => issue.reason === 'catalog-not-found'),
      false,
    );
    assert.equal(
      registry.issues.some((issue) => issue.reason === 'catalog-not-confirmed'),
      true,
    );
  }));
test('the sanitized remainder retains public metadata and labels unowned package neighbours without exposing private annotations', () =>
  local(async (root) => {
    const state = replaceStoreSnapshot(createDefaultState(), {
      store: 'steam',
      syncedAt: now,
      refs: [original],
    }).state;
    state.games[0].notes = 'PRIVATE_NOTE_MARKER';
    state.games[0].aliases = ['PRIVATE_ALIAS_MARKER'];
    state.productAnnotations = [{ store: 'steam', storeId: '10', ignored: true }];
    await publishSnapshot(await createInputSnapshot(state, now), root);
    const own = parsePicsApp(
      '10',
      { appinfo: { common: { name: 'Official metadata title', type: 'Game', oslist: 'windows' } } },
      now,
    );
    const neighbour = parsePicsApp(
      '20',
      { appinfo: { common: { name: 'Unowned neighbour', type: 'Game' } } },
      now,
    );
    await collect({
      root,
      catalogsFactory: () => ({ configured: { igdb: false, rawg: false } }),
      pics: async () => ({
        products: [own.product, neighbour.product],
        platforms: [own.platform],
        packages: [parsePicsPackage('30', { packageinfo: { appids: { 0: 10, 1: 20 } } }, now)],
        issues: [],
      }),
    });
    const report = await readJson(join(root, 'review.json'));
    assert.equal(report.unknown[0].metadata[0].title, 'Official metadata title');
    assert.equal(report.unknown[0].officialPlatforms[0].windows, true);
    assert.equal(report.unknown[0].relatedProducts[0].storeId, '20');
    assert.equal(report.unknown[0].relatedProducts[0].hasOwnedFootprint, false);
    const serialized = JSON.stringify(report);
    for (const field of [
      'PRIVATE_NOTE_MARKER',
      'PRIVATE_ALIAS_MARKER',
      'productAnnotations',
      state.games[0].id,
    ])
      assert.equal(serialized.includes(field), false);
    assert.equal(report.counts.products, 1);
    assert.equal(report.counts.games, 0);
  }));
test('LLM claims cannot approve; independent review ledger is required and rechecked', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    await collect({ root, pics: noPics, catalogsFactory: fakeCatalogs });
    const staged = CollectedSchema.parse(await readJson(join(root, 'collected.json')));
    const proposal = {
      id: randomUUID(),
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id: 1 },
      evidenceUrls: ['https://www.igdb.com/games/fictional-alpha'],
      rationale: 'Human must verify',
      origin: 'llm',
    };
    const proposals = join(root, 'llm.json');
    await atomicWrite(proposals, {
      version: 1,
      inputHash: input.inputHash,
      proposals: [{ ...proposal, approved: true }],
    });
    await assert.rejects(
      validate({ root, proposalsPath: proposals, catalogsFactory: fakeCatalogs }),
    );
    staged.registry.matches = [];
    staged.registry.proposals = [proposal];
    await atomicWrite(join(root, 'collected.json'), staged);
    await assert.rejects(approve(proposal.id, { root, catalogsFactory: fakeCatalogs }), /human/u);
    assert.equal((await readJson(join(root, 'collected.json'))).registry.matches.length, 0);
    await approve(proposal.id, { root, human: true, catalogsFactory: fakeCatalogs });
    await validate({ root, catalogsFactory: fakeCatalogs });
    assert.equal(
      (await readJson(join(root, 'result.json'))).registry.matches[0].method,
      'human-review',
    );
    assert.equal((await readJson(join(root, 'result.json'))).registry.reviews[0].reviewer, 'human');
  }));
test('fresh candidate existence checks do not assert identity, classification or ownership', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    const catalogs = () => ({ ...fakeCatalogs(), exactSteam: async () => [] });
    await collect({ root, pics: noPics, catalogsFactory: catalogs });
    const candidates = [1, 2, 3].map((id) => ({
      id: randomUUID(),
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id },
      origin: 'llm',
      rationale: 'Needs human identity review',
      evidenceUrls: [`https://www.igdb.com/games/fictional-${id}`],
    }));
    const path = join(root, 'llm.json');
    await atomicWrite(path, { version: 1, inputHash: input.inputHash, proposals: candidates });
    await validate({
      root,
      proposalsPath: path,
      catalogsFactory: () => ({
        ...catalogs(),
        get: async (identity, fresh) => {
          assert.equal(fresh, true);
          if (identity.id === 2) throw new SourceError('IGDB', 'ID not found');
          if (identity.id === 3) throw new SourceError('IGDB', 'network unavailable');
          return game();
        },
      }),
    });
    const result = await readJson(join(root, 'result.json'));
    assert.deepEqual(
      result.registry.candidateChecks.map((item) => item.outcome),
      ['exists', 'missing', 'unavailable'],
    );
    assert.equal(result.registry.matches.length, 0);
    const review = await readJson(join(root, 'review.json'));
    assert.equal(review.counts.games, 0);
    assert.equal(review.counts.unknown, 1);
    assert.deepEqual((await readJson(join(root, 'snapshot.json'))).products, input.products);
  }));
test('review counts group editions and detects a snapshot change during validation', () =>
  local(async (root) => {
    const input = await createInputSnapshot(
      replaceStoreSnapshot(createDefaultState(), {
        store: 'steam',
        syncedAt: now,
        refs: [original, { ...original, storeId: '20' }],
      }).state,
      now,
    );
    await publishSnapshot(input, root);
    const edition = CatalogRecordSchema.parse({
      ...game(),
      identity: { provider: 'igdb', id: 2 },
      kind: 'edition',
      versionParent: { provider: 'igdb', id: 1 },
      externalRefs: [{ store: 'steam', storeId: '20' }],
    });
    const catalogs = () => ({
      ...fakeCatalogs(),
      exactSteam: async () => [game(), edition],
      get: async (identity) => (identity.id === 2 ? edition : game()),
    });
    await collect({ root, pics: noPics, catalogsFactory: catalogs });
    const counts = await validate({ root, catalogsFactory: catalogs });
    assert.equal(counts.games, 1);
    assert.equal(counts.gameProducts, 2);
    const previous = await readFile(join(root, 'result.json'), 'utf8');
    const changed = {
      ...input,
      createdAt: '2026-10-09T11:00:00.000Z',
      products: [...input.products, { ...input.products[0], storeId: '30' }],
    };
    changed.inputHash = await contentHash(changed.products);
    await assert.rejects(
      validate({
        root,
        catalogsFactory: () => ({
          ...catalogs(),
          get: async (identity) => {
            await publishSnapshot(changed, root);
            return identity.id === 2 ? edition : game();
          },
        }),
      }),
      /Input changed/u,
    );
    assert.equal(await readFile(join(root, 'result.json'), 'utf8'), previous);
  }));
test('an abandoned lock without its owner receipt is recoverable after the grace period', () =>
  local(async (root) => {
    const lock = join(root, 'runner.lock');
    await mkdir(lock);
    await assert.rejects(
      withLock(root, 'runner', () => undefined),
      /Another/u,
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    assert.equal(await withLock(root, 'runner', () => 'recovered'), 'recovered');
  }));
test('a live runner keeps its lock past the recovery grace period', () =>
  local(async (root) => {
    const lock = join(root, 'runner.lock');
    await mkdir(lock);
    await atomicWrite(join(lock, 'owner.json'), { pid: process.pid });
    const old = new Date(Date.now() - 120_000);
    await utimes(lock, old, old);
    await assert.rejects(
      withLock(root, 'runner', () => assert.fail('live lock was stolen')),
      /Another/u,
    );
    assert.equal((await readJson(join(lock, 'owner.json'))).pid, process.pid);
  }));
test('review rejects an expected snapshot changed while waiting for the runner', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    await assert.rejects(
      approve(randomUUID(), {
        root,
        human: true,
        expectedInputHash: 'a'.repeat(64),
        catalogsFactory: () => assert.fail('stale review reached catalogs'),
      }),
      /stale/u,
    );
  }));
test('confirmed catalog deletion and changed external links move the owned footprint to Unknown', async () => {
  for (const reason of ['deleted', 'changed-link'])
    await local(async (root) => {
      const input = await makeInput();
      await publishSnapshot(input, root);
      await collect({ root, pics: noPics, catalogsFactory: fakeCatalogs });
      assert.equal((await validate({ root, catalogsFactory: fakeCatalogs })).games, 1);
      const counts = await validate({
        root,
        catalogsFactory: () => ({
          ...fakeCatalogs(),
          get: async () => {
            if (reason === 'deleted') throw new SourceError('IGDB', 'ID not found');
            return { ...game(), externalRefs: [{ store: 'steam', storeId: '20' }] };
          },
        }),
      });
      assert.equal(counts.unknown, 1);
      assert.equal(counts.games, 0);
      const result = await readJson(join(root, 'result.json'));
      assert.equal(result.registry.matches.length, 0);
      assert.ok(
        result.registry.issues.some(
          (issue) =>
            issue.reason === (reason === 'deleted' ? 'catalog-not-found' : 'conflicting-evidence'),
        ),
      );
      assert.deepEqual((await readJson(join(root, 'snapshot.json'))).products, input.products);
    });
});
test('a full recollection distinguishes a known ID deletion, a changed link and an unavailable catalog', async () => {
  for (const outcome of ['deleted', 'changed-link', 'outage', 'unconfigured'])
    await local(async (root) => {
      const input = await makeInput();
      await publishSnapshot(input, root);
      await collect({ root, pics: noPics, catalogsFactory: fakeCatalogs });
      await validate({ root, catalogsFactory: fakeCatalogs });
      const previous = await readFile(join(root, 'result.json'), 'utf8');
      const factory = () => ({
        ...fakeCatalogs(),
        configured: { igdb: outcome !== 'unconfigured', rawg: false },
        exactSteam: async () => [],
        get: async () => {
          if (outcome === 'deleted') throw new SourceError('IGDB', 'ID not found');
          if (outcome === 'outage') throw new SourceError('IGDB', 'network unavailable');
          return { ...game(), externalRefs: [{ store: 'steam', storeId: '20' }] };
        },
      });
      await collect({ root, pics: noPics, catalogsFactory: factory });
      if (['outage', 'unconfigured'].includes(outcome)) {
        await assert.rejects(validate({ root, catalogsFactory: factory }), /unchanged/u);
        assert.equal(await readFile(join(root, 'result.json'), 'utf8'), previous);
      } else {
        const counts = await validate({ root, catalogsFactory: factory });
        assert.equal(counts.games, 0);
        assert.equal(counts.unknown, 1);
        const result = await readJson(join(root, 'result.json'));
        assert.ok(
          result.registry.issues.some(
            (issue) =>
              issue.catalog?.id === 1 &&
              issue.reason ===
                (outcome === 'deleted' ? 'catalog-not-found' : 'conflicting-evidence'),
          ),
        );
      }
    });
});
test('edition parents are fetched again; definite absence differs from a catalog outage', async () => {
  for (const outcome of ['exists', 'missing', 'outage'])
    await local(async (root) => {
      const input = await makeInput();
      await publishSnapshot(input, root);
      const edition = CatalogRecordSchema.parse({
        ...game(),
        identity: { provider: 'igdb', id: 2 },
        kind: 'edition',
        versionParent: { provider: 'igdb', id: 1 },
      });
      const catalogs = () => ({
        ...fakeCatalogs(),
        exactSteam: async () => [edition],
        get: async (identity) => (identity.id === 2 ? edition : { ...game(), externalRefs: [] }),
      });
      await collect({ root, pics: noPics, catalogsFactory: catalogs });
      await validate({ root, catalogsFactory: catalogs });
      const previous = await readFile(join(root, 'result.json'), 'utf8');
      const seen = [];
      const factory = () => ({
        ...catalogs(),
        get: async (identity, fresh) => {
          seen.push([identity.id, fresh]);
          if (identity.id === 2) return edition;
          if (outcome === 'missing') throw new SourceError('IGDB', 'ID not found');
          if (outcome === 'outage') throw new SourceError('IGDB', 'network unavailable');
          return { ...game(), externalRefs: [] };
        },
      });
      if (outcome === 'outage') {
        await assert.rejects(validate({ root, catalogsFactory: factory }));
        assert.equal(await readFile(join(root, 'result.json'), 'utf8'), previous);
      } else {
        const counts = await validate({ root, catalogsFactory: factory });
        assert.equal(counts.games, outcome === 'exists' ? 1 : 0);
        assert.equal(counts.unknown, outcome === 'exists' ? 0 : 1);
      }
      assert.ok(seen.some(([id, fresh]) => id === 1 && fresh === true));
    });
});
test('an explicit human review resolves a lost automatic link without clearing unrelated positive conflicts', () =>
  local(async (root) => {
    const input = await makeInput();
    await publishSnapshot(input, root);
    await collect({ root, pics: noPics, catalogsFactory: fakeCatalogs });
    await validate({ root, catalogsFactory: fakeCatalogs });
    const changed = () => ({
      ...fakeCatalogs(),
      exactSteam: async () => [],
      get: async () => ({ ...game(), externalRefs: [] }),
    });
    await collect({ root, pics: noPics, catalogsFactory: changed });
    const staged = await readJson(join(root, 'collected.json'));
    const id = randomUUID();
    staged.registry.proposals.push({
      id,
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id: 1 },
      origin: 'llm',
      rationale: 'Requires human confirmation',
      evidenceUrls: ['https://www.igdb.com/games/fictional-alpha'],
    });
    await atomicWrite(join(root, 'collected.json'), staged);
    assert.equal((await validate({ root, catalogsFactory: changed })).games, 0);
    await approve(id, { root, human: true, catalogsFactory: changed });
    assert.equal((await validate({ root, catalogsFactory: changed })).games, 1);
    const reviewed = await readJson(join(root, 'collected.json'));
    reviewed.registry.issues.push({
      store: 'steam',
      storeId: '10',
      reason: 'conflicting-evidence',
      message: 'Another positive identity disagrees',
    });
    await atomicWrite(join(root, 'collected.json'), reviewed);
    assert.equal((await validate({ root, catalogsFactory: changed })).games, 0);
    assert.deepEqual((await readJson(join(root, 'snapshot.json'))).products, input.products);
  }));
test('PICS extracts product types, exact package membership and per-product official OS only', async () => {
  const parsed = parsePicsApp(
    '10',
    { appinfo: { common: { name: 'Alpha', type: 'Game', oslist: 'windows,linux' } } },
    now,
  );
  assert.equal(parsed.product.kind, 'game');
  assert.equal(parsed.platform.macos, false);
  const dlc = parsePicsApp(
    '20',
    { appinfo: { common: { name: 'Alpha DLC', type: 'DLC' }, extended: { dlcforappid: '10' } } },
    now,
  );
  assert.equal(dlc.product.parentStoreId, '10');
  assert.equal(dlc.platform, undefined);
  assert.equal(
    parsePicsApp('10', { missingToken: true, appinfo: { common: { name: 'Partial' } } }, now),
    undefined,
  );
  assert.equal(
    parsePicsApp('10', { appinfo: { common: { type: 'Tool' } } }, now).product.kind,
    'tool',
  );
  assert.equal(
    parsePicsApp('10', { appinfo: { common: { type: 'Unknown' } } }, now).product.titleStatus,
    'unresolved',
  );
  assert.deepEqual(
    parsePicsPackage(
      '817628',
      { packageinfo: { appids: { 0: 1546970, 1: 1546990, 2: 1547000, 3: 3575160 } } },
      now,
    ).appIds,
    ['1546970', '1546990', '1547000', '3575160'],
  );
  assert.equal(parsePicsPackage('50', { missingToken: true }, now), undefined);
  const callbacks = new Map();
  let ended = false;
  const fake = {
    on: (event, fn) => callbacks.set(event, fn),
    once: (event, fn) => callbacks.set(event, fn),
    logOn: (args) => {
      assert.deepEqual(args, { anonymous: true });
      callbacks.get('loggedOn')();
    },
    getProductInfo: (apps, _packages, tokens) => {
      assert.equal(tokens, false);
      return Promise.resolve({
        apps: Object.fromEntries(
          apps.map((id) => [id, { appinfo: { common: { name: 'Alpha', type: 'Game' } } }]),
        ),
      });
    },
    logOff: () => {
      ended = true;
    },
  };
  const result = await collectPics([{ store: 'steam', storeId: '10' }], [], () => fake);
  assert.equal(result.products.length, 1);
  assert.equal(ended, true);
});
test('catalog identity rules reject guessed namespace/ASIN mappings and merge editions only', () => {
  const dlc = parseIgdbGame(
    {
      id: 3,
      name: 'Fixture DLC',
      url: 'https://www.igdb.com/games/fixture-dlc',
      game_type: { type: 'DLC / Add-on' },
      parent_game: 1,
    },
    [],
    now,
  );
  assert.equal(dlc.kind, 'component');
  assert.equal(dlc.dependency, 'base-game');
  const products = [
    { ...original, kind: 'game', publicUrl: 'https://store.steampowered.com/app/10/Alpha/' },
    { store: 'gog', storeId: '100', publicUrl: 'https://www.gog.com/game/alpha' },
    { store: 'epic', storeId: 'namespace:20' },
    { store: 'amazon', storeId: '20' },
  ];
  assert.deepEqual(
    exactExternalRefs(
      [
        {
          uid: '10',
          external_game_source: { name: 'steam' },
          url: 'https://store.steampowered.com/app/11/',
        },
      ],
      products,
    ),
    [],
  );
  assert.deepEqual(
    exactExternalRefs(
      [
        { uid: '100', external_game_source: { name: 'gog' } },
        { uid: '20', external_game_source: { name: 'amazon_asin' } },
        { uid: '20', external_game_source: { name: 'epic_game_store' } },
      ],
      products,
    ),
    [],
  );
  assert.equal(
    exactExternalRefs(
      [
        {
          uid: 'alpha',
          url: 'https://www.gog.com/game/alpha',
          external_game_source: { name: 'gog' },
        },
      ],
      products,
    )[0].storeId,
    '100',
  );
  const raw = {
    id: 1,
    name: 'Alpha',
    url: 'https://www.igdb.com/games/alpha',
    game_type: { type: 'Main Game' },
    version_parent: 2,
    external_games: [{ uid: '10', external_game_source: { name: 'steam' } }],
  };
  assert.equal(parseIgdbGame(raw, products, now).kind, 'edition');
  assert.equal(
    parseIgdbGame({ ...raw, game_type: { type: 'Remaster' } }, products, now).kind,
    'remaster',
  );
  assert.equal(
    parseIgdbGame({ ...raw, version_parent: undefined, game_type: { type: 'Mod' } }, products, now)
      .dependency,
    'unknown',
  );
  assert.equal(storeUrlKey('https://store.epicgames.com/en-US/p/alpha?lang=en'), 'epic:alpha');
  assert.equal(storeUrlKey('https://api.rawg.io/api/games?key=synthetic'), undefined);
  const links = [{ url: 'https://store.steampowered.com/app/10/' }];
  assert.equal(
    parseRawgGame({ id: 2, name: 'Alpha Deluxe', slug: 'alpha' }, links, products, now).kind,
    'unknown',
  );
  products[0].classification = {
    kind: 'game',
    source: 'store-metadata',
    confidence: 'primary',
    evidenceUrls: ['https://store.steampowered.com/app/10/'],
  };
  assert.equal(
    parseRawgGame({ id: 2, name: 'Alpha', slug: 'alpha' }, links, products, now).kind,
    'game',
  );
});
test('network failure errors exclude URL credentials and response content', async () => {
  await assert.rejects(
    requestJson('RAWG', 'https://api.rawg.io/api/games?key=synthetic-secret', {}, async () => {
      throw new Error('synthetic-secret');
    }),
    (error) => !error.message.includes('synthetic-secret'),
  );
  await assert.rejects(
    requestJson(
      'RAWG',
      'https://api.rawg.io/api/games',
      {},
      async () => new Response('sensitive body', { status: 403 }),
    ),
    /HTTP 403/u,
  );
  const catalogs = await createCatalogs([], async () => undefined);
  assert.deepEqual(catalogs.configured, { igdb: false, rawg: false });
  await assert.rejects(catalogs.get({ provider: 'igdb', id: 1 }), /not configured/u);
});

test('local JSON reads reject symlinks and oversized documents while preserving saved data', () =>
  local(async (root) => {
    const original = join(root, 'saved.json');
    await atomicWrite(original, { value: 'fictional preserved snapshot' });
    assert.deepEqual(await readJson(original), { value: 'fictional preserved snapshot' });
    assert.equal(await readJson(join(root, 'missing.json'), true), undefined);
    const link = join(root, 'swapped.json');
    await symlink(original, link);
    await assert.rejects(readJson(link), { code: 'ELOOP' });
    const oversized = join(root, 'oversized.json');
    const file = await open(oversized, 'wx');
    try {
      await file.truncate(MAX_DOCUMENT_BYTES + 1);
    } finally {
      await file.close();
    }
    await assert.rejects(readJson(oversized), /size limit/u);
    await assert.rejects(readJson(root), /size limit/u);
    assert.deepEqual(await readJson(original), { value: 'fictional preserved snapshot' });
  }));
