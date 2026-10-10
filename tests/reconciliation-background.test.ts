import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { replaceStoreSnapshot } from '../src/core/library';
import { acceptedResult, contentHash, createInputSnapshot } from '../src/core/reconciliation';
import { CHUNK_CHARACTERS, type NativeRequest } from '../src/core/native-protocol';
import type { NativePort } from '../src/background/reconciliation';

const mocks = vi.hoisted(() => {
  const stored: Record<string, unknown> = {};
  return {
    stored,
    api: {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: structuredClone(stored[key]) })),
          set: vi.fn((values: Record<string, unknown>) => {
            Object.assign(stored, structuredClone(values));
            return Promise.resolve();
          }),
        },
      },
      permissions: { contains: vi.fn(() => Promise.resolve(true)) },
      alarms: { create: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve(true)) },
      runtime: { connectNative: vi.fn<() => NativePort>() },
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: mocks.api }));
const key = 'gaming-library-helper/reconciliation';
const libraryKey = 'gaming-library-helper/state';
function port(
  handler: (request: NativeRequest) => unknown,
): NativePort & { emit: (message: unknown) => void; drop: () => void } {
  const messages = new Set<(message: unknown) => void>();
  const disconnects = new Set<() => void>();
  return {
    postMessage: (request) => {
      const response = handler(request);
      if (response !== undefined)
        queueMicrotask(() => messages.forEach((listener) => listener(response)));
    },
    emit: (message) => messages.forEach((listener) => listener(message)),
    drop: () => disconnects.forEach((listener) => listener()),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (listener) => {
        messages.add(listener);
      },
      removeListener: (listener) => {
        messages.delete(listener);
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnects.add(listener);
      },
      removeListener: (listener) => {
        disconnects.delete(listener);
      },
    },
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.api.permissions.contains.mockResolvedValue(true);
  for (const name of Object.keys(mocks.stored)) delete mocks.stored[name];
});
describe('optional native reconciliation', () => {
  it('restores the same registry after a backup import and detects an input change during exchange', async () => {
    const bridge = await import('../src/background/reconciliation');
    const source = createDefaultState();
    const input = await createInputSnapshot(source);
    const result = acceptedResult(input, {
      ...source.registry,
      records: [
        {
          identity: { provider: 'igdb', id: 1 },
          title: 'Alpha',
          kind: 'game',
          dependency: 'none',
          independenceEvidence: [],
          url: 'https://www.igdb.com/games/alpha',
          checkedAt: '2026-10-09T10:00:00.000Z',
          externalRefs: [],
        },
      ],
    });
    const text = JSON.stringify(result);
    const hash = await contentHash(result);
    mocks.stored[libraryKey] = source;
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting', importedHash: hash };
    const handler = (request: NativeRequest) =>
      request.op === 'result:read'
        ? { status: 'chunk', offset: request.offset, total: text.length, data: text, hash }
        : { status: 'ok', changed: false };
    mocks.api.runtime.connectNative.mockReturnValue(port(handler));
    expect((await bridge.refreshBridge()).outcome).toBe('connected');
    expect((mocks.stored[libraryKey] as typeof source).registry).toEqual(result.registry);
    const changed = replaceStoreSnapshot(source, {
      store: 'steam',
      syncedAt: '2026-10-09T11:00:00.000Z',
      refs: [
        {
          store: 'steam',
          storeId: '10',
          title: 'Alpha',
          titleStatus: 'resolved',
          owned: true,
          ignoredAtSource: false,
          importedAt: '2026-10-09T11:00:00.000Z',
        },
      ],
    }).state;
    mocks.api.runtime.connectNative.mockReturnValue(
      port((request) => {
        if (request.op === 'result:read') mocks.stored[libraryKey] = changed;
        return handler(request);
      }),
    );
    expect((await bridge.refreshBridge()).outcome).toBe('stale');
    expect(mocks.stored[libraryKey]).toEqual(changed);
  });
  it('does not resurrect a disabled connection while a result is in flight', async () => {
    const bridge = await import('../src/background/reconciliation');
    const source = createDefaultState();
    mocks.stored[libraryKey] = source;
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.api.runtime.connectNative.mockReturnValue(
      port((request) => {
        if (request.op === 'result:read') {
          started();
          return undefined;
        }
        return { status: 'ok', changed: false };
      }),
    );
    const refreshing = bridge.refreshBridge();
    await ready;
    expect((await bridge.configureBridge(false)).enabled).toBe(false);
    expect((await refreshing).outcome).toBe('disabled');
    expect(mocks.stored[libraryKey]).toEqual(source);
  });
  it('stays disabled until consent, restores alarms after restart and handles revoked permission', async () => {
    const bridge = await import('../src/background/reconciliation');
    expect((await bridge.refreshBridge()).outcome).toBe('disabled');
    expect(mocks.api.runtime.connectNative).not.toHaveBeenCalled();
    mocks.api.permissions.contains.mockResolvedValue(false);
    await expect(bridge.configureBridge(true)).rejects.toThrow(/Allow/u);
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
    expect((await bridge.refreshBridge()).outcome).toBe('unavailable');
    await bridge.restoreBridgeAlarm();
    expect(mocks.api.alarms.create).toHaveBeenCalled();
    await bridge.configureBridge(false);
    expect(mocks.api.alarms.clear).toHaveBeenCalled();
  });
  it('preserves the library if host is missing, rejects invalid native responses and handles timeout/disconnect', async () => {
    const bridge = await import('../src/background/reconciliation');
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
    mocks.stored[libraryKey] = createDefaultState();
    const before = structuredClone(mocks.stored[libraryKey]);
    mocks.api.runtime.connectNative.mockImplementation(() => {
      throw new Error('missing');
    });
    expect((await bridge.refreshBridge()).outcome).toBe('unavailable');
    expect(mocks.stored[libraryKey]).toEqual(before);
    const invalid = port(() => ({ status: 'untrusted' }));
    const client = bridge.nativeClient(invalid);
    await expect(client.request({ op: 'publish:commit' })).rejects.toThrow(/Invalid/u);
    client.close();
    vi.useFakeTimers();
    const idle = port(() => undefined);
    const slow = bridge.nativeClient(idle, 20);
    const timeout = expect(slow.request({ op: 'publish:commit' })).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(20);
    await timeout;
    const disconnected = expect(slow.request({ op: 'publish:commit' })).rejects.toThrow(
      /unavailable/u,
    );
    idle.drop();
    await disconnected;
    await expect(slow.request({ op: 'publish:commit' })).rejects.toThrow(/unavailable/u);
    slow.close();
  });
  it('publishes sanitized chunks and imports a result without changing ownership or annotations', async () => {
    const bridge = await import('../src/background/reconciliation');
    const state = replaceStoreSnapshot(createDefaultState(), {
      store: 'steam',
      syncedAt: '2026-10-09T10:00:00.000Z',
      refs: [
        {
          store: 'steam',
          storeId: '10',
          title: 'Alpha',
          titleStatus: 'resolved',
          owned: true,
          ignoredAtSource: false,
          importedAt: '2026-10-09T10:00:00.000Z',
        },
      ],
    }).state;
    state.games[0]!.notes = 'Private annotation';
    const input = await createInputSnapshot(state);
    const result = acceptedResult(input, state.registry);
    const text = JSON.stringify(result);
    const hash = await contentHash(result);
    let sent = '';
    const ops: string[] = [];
    const connection = port((request) => {
      ops.push(request.op);
      if (request.op === 'publish:chunk') sent += request.data;
      if (request.op === 'result:read')
        return {
          status: 'chunk',
          data: text.slice(request.offset, request.offset + CHUNK_CHARACTERS),
          offset: request.offset,
          total: text.length,
          hash,
        };
      return { status: 'ok', changed: true };
    });
    mocks.api.runtime.connectNative.mockReturnValue(connection);
    mocks.stored[libraryKey] = state;
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
    expect((await bridge.refreshBridge()).outcome).toBe('connected');
    expect(sent).not.toContain('Private annotation');
    expect(JSON.parse(sent) as unknown).toMatchObject({ inputHash: input.inputHash });
    expect((mocks.stored[libraryKey] as typeof state).games).toEqual(state.games);
    expect(ops).toContain('publish:commit');
    expect(connection.disconnect).toHaveBeenCalled();
    const imports = mocks.api.storage.local.set.mock.calls.filter(
      ([value]) => libraryKey in value,
    ).length;
    await bridge.refreshBridge();
    expect(
      mocks.api.storage.local.set.mock.calls.filter(([value]) => libraryKey in value),
    ).toHaveLength(imports);
  });
  it.each(['waiting', 'stale-input', 'bad-offset', 'bad-hash', 'empty'] as const)(
    'preserves the last registry on %s',
    async (kind) => {
      const bridge = await import('../src/background/reconciliation');
      const state = createDefaultState();
      mocks.stored[libraryKey] = state;
      mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
      const input = await createInputSnapshot(state);
      const text = JSON.stringify(acceptedResult(input, state.registry));
      mocks.api.runtime.connectNative.mockReturnValue(
        port((request) => {
          if (request.op !== 'result:read') return { status: 'ok', changed: false };
          if (kind === 'waiting') return { status: 'waiting' };
          if (kind === 'stale-input') return { status: 'error', code: 'stale-input' };
          return {
            status: 'chunk',
            data: kind === 'empty' ? '' : text,
            offset: kind === 'bad-offset' ? 1 : 0,
            total: text.length,
            hash: 'a'.repeat(64),
          };
        }),
      );
      expect((await bridge.refreshBridge()).outcome).toBe(
        kind === 'waiting' ? 'waiting' : kind === 'stale-input' ? 'stale' : 'invalid-result',
      );
      expect(mocks.stored[libraryKey]).toEqual(state);
    },
  );
  it('rechecks a manual review through the host and rejects use while disconnected', async () => {
    const bridge = await import('../src/background/reconciliation');
    await expect(bridge.approveBridgeReview(crypto.randomUUID(), false)).rejects.toThrow(
      /Connect/u,
    );
    mocks.stored[key] = { version: 1, enabled: true, outcome: 'waiting' };
    mocks.api.runtime.connectNative.mockReturnValue(
      port(() => ({ status: 'error', code: 'review-failed' })),
    );
    await expect(bridge.approveBridgeReview(crypto.randomUUID(), false)).rejects.toThrow(
      /rechecked/u,
    );
    mocks.api.runtime.connectNative.mockReturnValue(port(() => ({ status: 'ok' })));
    expect((await bridge.approveBridgeReview(crypto.randomUUID(), false)).enabled).toBe(true);
  });
});
