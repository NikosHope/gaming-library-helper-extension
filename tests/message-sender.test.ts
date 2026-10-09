import { describe, expect, it } from 'vitest';
import {
  requireExtensionPage,
  requireSteamStore,
  senderStore,
} from '../src/background/message-sender';
import { RuntimeRequestSchema } from '../src/core/messages';

const root = 'moz-extension://our-extension/';

describe('privileged extension messages', () => {
  it('accepts the actual options page, including when Firefox supplies a tab', () => {
    expect(() => requireExtensionPage({ url: root + 'options.html', tab: {} }, root)).not.toThrow();
    expect(() => requireExtensionPage({ url: root + 'popup.html' }, root)).not.toThrow();
  });

  it.each([
    {},
    { url: 'https://store.steampowered.com/', tab: {} },
    { url: 'https://www.gog.com/' },
    { url: 'moz-extension://other-extension/options.html' },
    { url: 'moz-extension://our-extension.attacker/options.html' },
    { tab: { url: root + 'options.html' }, url: 'https://www.gog.com/frame' },
  ])('rejects a missing, foreign, or web-page sender', (sender) => {
    expect(() => requireExtensionPage(sender, root)).toThrow(
      /only available from an extension page/u,
    );
  });

  it('validates explicit sync requests and rejects malformed schedule input', () => {
    expect(RuntimeRequestSchema.safeParse({ type: 'sync:runNow' }).success).toBe(true);
    expect(
      RuntimeRequestSchema.safeParse({
        type: 'sync:configure',
        settings: { version: 1, enabled: true, stores: ['gog'], intervalHours: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('public Steam catalog messages', () => {
  it('permits the HTTPS store sender and bounded positive app IDs', () => {
    expect(() =>
      requireSteamStore({ url: 'https://store.steampowered.com/app/10/' }),
    ).not.toThrow();
    expect(
      RuntimeRequestSchema.safeParse({ type: 'steam:catalog', appIds: [10, 20] }).success,
    ).toBe(true);
  });

  it.each([
    {},
    { url: root + 'options.html' },
    { url: 'https://www.gog.com/' },
    { url: 'http://store.steampowered.com/' },
    { url: 'https://store.steampowered.com.attacker.example/' },
    // Fictional basic-auth URL verifies that credential-bearing senders are rejected.
    // secretlint-disable-next-line @secretlint/secretlint-rule-basicauth
    { url: 'https://user:pass@store.steampowered.com/' },
    { url: 'https://store.steampowered.com:8443/' },
    { url: 'not a URL', tab: { url: 'https://store.steampowered.com/' } },
  ])('rejects a missing or foreign caller before public metadata access', (sender) => {
    expect(() => requireSteamStore(sender)).toThrow(/only available from a Steam Store tab/u);
  });

  it.for([[], [0], [-1], [true], ['10'], [10, 10], Array.from({ length: 101 }, (_, i) => i + 1)])(
    'rejects unbounded or malformed app-ID requests',
    (appIds) => {
      expect(RuntimeRequestSchema.safeParse({ type: 'steam:catalog', appIds }).success).toBe(false);
    },
  );
});

describe('store snapshot senders', () => {
  it.each([
    ['https://store.steampowered.com/app/10/', 'steam'],
    ['https://www.gog.com/account', 'gog'],
    ['https://store.epicgames.com/en-US/', 'epic'],
    ['https://account.battle.net/games', 'battlenet'],
  ])('recognizes only a supported HTTPS origin: %s', (url, store) => {
    expect(senderStore({ url })).toBe(store);
  });
  it.each([
    {},
    { tab: { url: 'https://store.epicgames.com/' } },
    { url: 'http://store.epicgames.com/' },
    { url: 'https://store.epicgames.com:8443/' },
    // Fictional basic-auth URL verifies that credential-bearing senders are rejected.
    // secretlint-disable-next-line @secretlint/secretlint-rule-basicauth
    { url: 'https://user:pass@store.epicgames.com/' },
    { url: 'https://store.epicgames.com.attacker.example/' },
    { url: 'not a URL' },
    { url: 'https://account.battle.net/overview' },
    { url: 'https://account.battle.net/games?code=synthetic' },
    { url: 'https://account.battle.net/games#synthetic' },
    { url: 'https://account.battle.net.attacker.example/games' },
  ])('rejects missing, credential-bearing, or lookalike sender origins', (sender) => {
    expect(senderStore(sender)).toBeUndefined();
  });
});
