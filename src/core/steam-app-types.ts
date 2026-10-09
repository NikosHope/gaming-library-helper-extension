// EStoreAppType from Valve's public StoreBrowse protocol; these are not EAppType bit flags.
export const STEAM_STORE_APP_TYPES = {
  game: 0,
  demo: 1,
  mod: 2,
  movie: 3,
  dlc: 4,
  guide: 5,
  software: 6,
  video: 7,
  series: 8,
  episode: 9,
  hardware: 10,
  music: 11,
  beta: 12,
  tool: 13,
  advertising: 14,
} as const;

export const STEAM_METADATA_APP_TYPES: Readonly<Record<string, number>> = {
  ...STEAM_STORE_APP_TYPES,
  application: STEAM_STORE_APP_TYPES.software,
  // PICS config has no StoreBrowse equivalent. Treat it conservatively as a generic utility.
  config: STEAM_STORE_APP_TYPES.tool,
};
