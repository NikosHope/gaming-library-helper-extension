import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  zip: {
    // WXT excludes tests and dotfiles by default; the reviewer must reproduce all checks.
    includeSources: [
      'tests/**',
      'scripts/**/*.test.mjs',
      '.gitignore',
      '.prettierrc.json',
      '.prettierignore',
      '.secretlintrc.json',
      '.nvmrc',
      '.gitattributes',
      '.github/**',
      '.husky/pre-commit',
      '.husky/pre-push',
    ],
    excludeSources: [
      'artifacts/**',
      'exports/**',
      'downloads/**',
      'coverage/**',
      '*.log',
      '.env*',
      '*.pem',
      '*.key',
    ],
    exclude: ['acceptance-*.html', 'acceptance-*.js', 'verified-steam-metadata.json'],
  },
  manifest: ({ browser }) => ({
    name: 'Gaming Library Helper',
    description: 'Shows Steam and GOG ownership, ignored games, and device performance notes.',
    permissions: ['storage', 'alarms'],
    optional_permissions: ['nativeMessaging'],
    optional_host_permissions: [
      'https://api.steampowered.com/*',
      'https://api.steamcmd.net/*',
      'https://store.epicgames.com/*',
      'https://www.amazon.com/*',
      'https://api.amazon.com/*',
      'https://gaming.amazon.com/*',
      'https://account.battle.net/*',
    ],
    host_permissions: [
      'https://store.steampowered.com/*',
      'https://www.gog.com/*',
      'https://gog.com/*',
      'https://embed.gog.com/*',
    ],
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'gaming-library-helper@nikita.local',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
                optional: ['authenticationInfo', 'websiteContent'],
              },
            },
          }
        : undefined,
  }),
});
