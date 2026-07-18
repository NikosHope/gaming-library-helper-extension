import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ browser }) => ({
    name: 'Gaming Library Helper',
    description:
      'Shows Steam and GOG ownership, cross-store prices, ignored games, and device performance notes.',
    permissions: ['storage'],
    host_permissions: [
      'https://store.steampowered.com/*',
      'https://www.gog.com/*',
      'https://gog.com/*',
      'https://embed.gog.com/*',
    ],
    optional_host_permissions: [
      'https://api.isthereanydeal.com/*',
      'https://api.steampowered.com/*',
    ],
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'gaming-library-helper@nikita.local',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
                optional: ['websiteContent', 'authenticationInfo'],
              },
            },
          }
        : undefined,
  }),
});
