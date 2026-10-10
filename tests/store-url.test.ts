import { describe, expect, it } from 'vitest';
import { storeUrlKey } from '../src/core/store-url';

describe('exact public store locators', () => {
  it.each([
    ['https://store.steampowered.com/app/10/Alpha/?l=english', 'steam:10'],
    ['https://www.gog.com/en/game/alpha', 'gog:alpha'],
    ['https://gog.com/game/alpha/', 'gog:alpha'],
    ['https://store.epicgames.com/en-US/p/alpha?lang=en', 'epic:alpha'],
    ['https://eu.shop.battle.net/en-gb/product/alpha', 'battlenet:product/alpha'],
    ['https://us.shop.battle.net/product/alpha', 'battlenet:product/alpha'],
  ])('identifies %s independently of locale/display text', (url, expected) => {
    expect(storeUrlKey(url)).toBe(expected);
  });
  it.each([
    undefined,
    'untrusted',
    'http://www.gog.com/game/alpha',
    'https://www.gog.com/game/alpha?token=synthetic',
    'https://www.gog.com:444/game/alpha',
    'https://www.gog.com/account/game/alpha',
    'https://store.steampowered.com/sub/10/',
    'https://store.epicgames.com/en-US/',
    'https://us.shop.battle.net/',
    'https://us.shop.battle.net/en-us/family/diablo',
    'https://example.org/game/alpha',
  ])('rejects a non-product or unsafe locator %s', (url) => {
    expect(storeUrlKey(url)).toBeUndefined();
  });
});
