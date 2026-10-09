import { browser as wxtBrowser } from 'wxt/browser';

// WXT exposes Chromium's common types; these two documented Firefox extensions use its native API.
export const firefoxPermissions = wxtBrowser.permissions as unknown as typeof browser.permissions;
export const firefoxTabUpdates = wxtBrowser.tabs
  .onUpdated as unknown as typeof browser.tabs.onUpdated;
