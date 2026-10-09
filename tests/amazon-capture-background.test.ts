import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  refresh: vi.fn(),
  capture: vi.fn(),
  stored: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: mock.get, set: mock.set } } },
}));
vi.mock('../src/background/amazon-auth', () => ({ refreshAmazonAccess: mock.refresh }));
vi.mock('../src/adapters/amazon', () => ({ captureAmazonSnapshot: mock.capture }));
import { captureAmazonLibrary } from '../src/background/amazon-capture';
beforeEach(() => {
  vi.clearAllMocks();
  mock.stored = new Map();
  mock.get.mockImplementation((key: string) => Promise.resolve({ [key]: mock.stored.get(key) }));
  mock.set.mockImplementation((values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) mock.stored.set(key, structuredClone(value));
    return Promise.resolve();
  });
  mock.refresh.mockResolvedValue('synthetic-token');
  mock.capture.mockResolvedValue([
    {
      store: 'amazon',
      storeId: 'fictional-product',
      title: 'Fictional App Game',
      titleStatus: 'resolved',
      owned: true,
      ignoredAtSource: false,
      importedAt: '2026-10-08T16:00:00Z',
    },
  ]);
});
it('commits only the complete app snapshot and never credentials, preserving it after a failure', async () => {
  expect(await captureAmazonLibrary()).toEqual({ ok: true, gameCount: 1 });
  const before = JSON.stringify([...mock.stored]);
  expect(before).toContain('fictional-product');
  expect(before).not.toContain('synthetic-token');
  expect(mock.capture).toHaveBeenCalledWith('synthetic-token');
  mock.capture.mockRejectedValueOnce(new Error('synthetic-private-error'));
  await expect(captureAmazonLibrary()).rejects.toThrow();
  expect(JSON.stringify([...mock.stored])).toBe(before);
});
