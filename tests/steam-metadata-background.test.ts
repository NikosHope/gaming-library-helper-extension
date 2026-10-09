import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: mocks.api }));
const key = 'gaming-library-helper/steam-metadata';
const checkedAt = '2026-10-08T16:00:00.000Z';
const snapshot = {
  version: 1 as const,
  source: 'valve-pics-anonymous' as const,
  checkedAt,
  apps: [{ id: 10, type: 'game' as const, name: 'Fictional Alpha' }],
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const name of Object.keys(mocks.stored)) delete mocks.stored[name];
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(checkedAt));
});
describe('Steam metadata persistence', () => {
  it('does not overwrite unsupported cache versions', async () => {
    const { importSteamMetadata } = await import('../src/background/steam-metadata');
    mocks.stored[key] = { version: 9, existing: 'preserved' };
    await expect(importSteamMetadata(snapshot)).rejects.toThrow(/preserved/u);
    expect(mocks.stored[key]).toEqual({ version: 9, existing: 'preserved' });
    expect(mocks.api.storage.local.set).not.toHaveBeenCalled();
  });
  it('serializes overlapping imports without changing library or credential storage', async () => {
    const { importSteamMetadata } = await import('../src/background/steam-metadata');
    await Promise.all([
      importSteamMetadata(snapshot),
      importSteamMetadata({ ...snapshot, apps: [{ id: 20, type: 'dlc' }] }),
    ]);
    expect(Object.keys(mocks.stored)).toEqual([key]);
    expect(mocks.stored[key]).toMatchObject({
      version: 1,
      apps: [
        { id: 10, name: 'Fictional Alpha' },
        { id: 20, type: 'dlc' },
      ],
    });
  });
});
