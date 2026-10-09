// Synthetic IDs/titles. GOG pagination and game/availability field names were observed
// in the authenticated Firefox account endpoint on 2026-10-08. No account data is retained.
export const STEAM_OWNERSHIP = {
  rgOwnedApps: [20, '10', 20],
  rgIgnoredApps: { '20': 0 },
};
// Valve StoreBrowse field names/types were checked against public catalog responses.
// IDs and titles remain fictional.
export const STEAM_ITEMS = [
  { id: 20, appid: 20, item_type: 0, success: 1, type: 0, name: 'Sample Beta' },
  { id: 10, appid: 10, item_type: 0, success: 1, type: 0, name: 'Sample Alpha' },
];
export const GOG_PAGES = [
  {
    page: 1,
    totalPages: 2,
    totalProducts: 3,
    products: [
      {
        id: 30,
        title: 'Sample Gamma',
        url: '/game/sample_gamma',
        isHidden: true,
        isGame: true,
        isMovie: false,
        availability: { isAvailableInAccount: true },
      },
      {
        id: 10,
        title: 'Sample Alpha',
        isGame: true,
        isMovie: false,
        availability: { isAvailableInAccount: true },
      },
    ],
  },
  {
    page: 2,
    totalPages: 2,
    totalProducts: 3,
    products: [
      {
        id: '20',
        title: 'Sample Beta',
        isGame: true,
        isMovie: false,
        availability: { isAvailableInAccount: true },
      },
    ],
  },
];
