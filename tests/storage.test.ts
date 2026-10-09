import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDefaultState } from '../src/core/defaults';

const mock = vi.hoisted(
  (): {
    value: unknown;
    get: Mock<(key: string) => Promise<Record<string, unknown>>>;
    set: Mock<(values: Record<string, unknown>) => Promise<void>>;
  } => ({
    value: undefined,
    get: vi.fn(),
    set: vi.fn(),
  }),
);
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: mock.get, set: mock.set } } },
}));
import { loadState, updateState } from '../src/core/storage';

beforeEach(() => {
  mock.value = undefined;
  mock.get.mockImplementation((key: string) => Promise.resolve({ [key]: mock.value }));
  mock.set.mockClear();
  mock.set.mockResolvedValue(undefined);
});

describe('library storage preservation', () => {
  it('creates an initial library only when no previous value exists', async () => {
    expect(await loadState()).toEqual(createDefaultState());
  });

  it.each([null, { version: 99, games: [] }, { version: 3, games: 'damaged' }])(
    'preserves an unsupported saved value instead of overwriting it with defaults',
    async (value) => {
      mock.value = value;
      await expect(updateState((state) => state)).rejects.toThrow(/existing data is unchanged/u);
      expect(mock.set).not.toHaveBeenCalled();
      expect(mock.value).toEqual(value);
    },
  );

  it('upgrades a v3 library without resetting its saved settings or device notes', async () => {
    const current = createDefaultState();
    current.settings.hideIgnored = false;
    current.devices[0]!.notes = 'My existing device note';
    mock.value = { ...current, version: 3 };
    expect(await updateState((state) => state)).toEqual(current);
    expect(mock.set).toHaveBeenCalledWith({ 'gaming-library-helper/state': current });
  });
});
