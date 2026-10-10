import { RegistrySchema } from './reconciliation-schema';
import type { DeviceProfile, LibraryState, Settings } from './schema';

export const DEFAULT_SETTINGS: Settings = {
  highlightOwnedOnOtherStore: true,
  hideOwnedOnOtherStore: false,
  hideIgnored: true,
};

export const DEFAULT_DEVICES: DeviceProfile[] = [
  {
    id: 'steam-deck-lcd-docked',
    name: 'Steam Deck LCD — Docked',
    hardware: 'Steam Deck LCD APU, docked to an external display',
    memoryGb: 16,
    operatingSystems: ['SteamOS'],
    cpuArchitecture: 'x86_64',
    graphicsApis: ['Vulkan'],
    displayMode: 'docked-external',
    notes:
      'Track native Linux and Proton separately. Gamescope FSR is a compositor upscaler; community lsfg-vk is a separate Vulkan frame-generation layer. FEX is normally irrelevant on this x86_64 device.',
  },
  {
    id: 'macbook-pro-m5-24gb',
    name: 'Apple MacBook Pro M5 — 24 GB',
    hardware: 'Apple M5, unified memory',
    memoryGb: 24,
    operatingSystems: ['macOS'],
    cpuArchitecture: 'arm64',
    graphicsApis: ['Metal'],
    displayMode: 'either',
    notes:
      'Keep native Apple silicon, community source ports, Rosetta, CrossOver/Wine, GPTK, and graphics translation as separate paths.',
  },
];

export function createDefaultState(): LibraryState {
  return {
    version: 6,
    productAnnotations: [],
    registry: RegistrySchema.parse({ version: 1 }),
    games: [],
    snapshots: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    devices: structuredClone(DEFAULT_DEVICES),
  };
}
