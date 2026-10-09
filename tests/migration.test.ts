import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { replaceStoreSnapshot } from '../src/core/library';
import { migrateLibraryState } from '../src/core/migration';

describe('migrateLibraryState', () => {
  it('migrates v1 runner and scaler strings into a traced current launch path', () => {
    const current = createDefaultState();
    const legacy = {
      ...current,
      version: 1,
      games: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          displayTitle: 'Example Game',
          normalizedTitle: 'example game',
          aliases: [],
          ignored: false,
          notes: '',
          storeRefs: {},
          performance: [
            {
              deviceId: 'steam-deck-lcd-docked',
              status: 'possible',
              resolution: { width: 1920, height: 1080 },
              baseFps: 40,
              framePacing: 'unknown',
              vrr: 'available',
              upscaler: 'Gamescope FSR',
              operatingSystem: 'SteamOS',
              runner: 'Proton',
              settings: '',
              confidence: 'medium',
              notes: '',
            },
          ],
        },
      ],
    };

    const migrated = migrateLibraryState(legacy);
    expect(migrated?.version).toBe(5);
    expect(migrated?.games[0]?.launchPaths[0]).toMatchObject({
      platform: 'steamos',
      executionKind: 'compatibility-layer',
      osCompatibilityLayers: ['Proton'],
    });
    expect(migrated?.games[0]?.performance[0]).toMatchObject({
      outputResolution: { width: 1920, height: 1080 },
      upscaling: { enabled: true, technology: 'other', notes: 'Gamescope FSR' },
    });
  });

  it.each([1, 2, 3])(
    'migrates v%s without price credentials or cache and preserves library records',
    (version) => {
      const current = replaceStoreSnapshot(createDefaultState(), {
        store: 'steam',
        syncedAt: '2026-10-07T20:00:00.000Z',
        refs: [
          {
            store: 'steam',
            storeId: '10',
            title: 'Sample game',
            titleStatus: 'resolved',
            owned: true,
            ignoredAtSource: false,
            importedAt: '2026-10-07T20:00:00.000Z',
          },
        ],
      }).state;
      current.games[0]!.notes = 'Keep my note';
      current.games[0]!.ignored = true;
      current.games[0]!.aliases = ['An explicit alias'];
      current.settings.hideIgnored = false;
      const legacy = {
        ...current,
        version,
        settings: {
          ...current.settings,
          prices: {
            enabled: true,
            country: 'CA',
            apiKey: 'synthetic-retired-key',
          },
        },
        priceCache: { retired: { provider: 'itad', arbitrary: 'discarded-quote' } },
      };
      const before = structuredClone(legacy);
      const migrated = migrateLibraryState(legacy);
      expect(migrated).toEqual(current);
      expect(migrated).not.toHaveProperty('priceCache');
      expect(migrated?.settings).not.toHaveProperty('prices');
      expect(JSON.stringify(migrated)).not.toContain('synthetic-retired-key');
      expect(legacy).toEqual(before);
    },
  );

  it('returns undefined for unknown storage shapes', () => {
    expect(migrateLibraryState({ version: 99 })).toBeUndefined();
  });

  it('does not reinterpret new provider records as an older schema', () => {
    const state = createDefaultState();
    expect(
      migrateLibraryState({
        ...state,
        version: 3,
        snapshots: {
          epic: { syncedAt: '2026-10-08T08:00:00.000Z', gameCount: 1, unresolvedCount: 0 },
        },
      }),
    ).toBeUndefined();
  });

  it('accepts an already-current state without changing it', () => {
    const current = createDefaultState();
    expect(migrateLibraryState(current)).toEqual(current);
  });

  it.each([
    ['Linux', 'linux'],
    ['macOS', 'macos'],
    ['Windows 11', 'windows'],
    ['Mystery OS', 'unknown'],
  ] as const)('maps legacy %s evidence to %s', (operatingSystem, platform) => {
    const current = createDefaultState();
    const migrated = migrateLibraryState({
      ...current,
      version: 1,
      games: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          displayTitle: 'Legacy Game',
          normalizedTitle: 'legacy game',
          aliases: [],
          ignored: false,
          notes: '',
          storeRefs: {},
          performance: [
            {
              deviceId: 'legacy-device',
              status: 'unlikely',
              resolution: { width: 1280, height: 720 },
              framePacing: 'unknown',
              vrr: 'unknown',
              operatingSystem,
              settings: '',
              confidence: 'low',
              notes: '',
            },
          ],
        },
      ],
    });
    expect(migrated?.games[0]?.launchPaths[0]).toMatchObject({
      platform,
      status: 'unknown',
      executionKind: 'unknown',
      osCompatibilityLayers: [],
    });
    expect(migrated?.games[0]?.performance[0]).toMatchObject({
      upscaling: { enabled: false, technology: 'none', integration: 'none' },
      frameGeneration: { enabled: false, technology: 'none', integration: 'none' },
    });
  });
});
