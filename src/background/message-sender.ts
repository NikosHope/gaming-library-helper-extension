export interface MessageSender {
  url?: string | undefined;
  tab?: { url?: string | undefined } | undefined;
}

export function requireExtensionPage(sender: MessageSender, extensionRoot: string): void {
  // Browser-supplied sender metadata cannot be replaced by a message payload.
  if (!sender.url?.startsWith(extensionRoot)) {
    throw new Error('This operation is only available from an extension page');
  }
}

export function requireSteamStore(sender: MessageSender): void {
  try {
    const url = new URL(sender.url ?? '');
    if (url.origin === 'https://store.steampowered.com' && !url.username && !url.password) return;
  } catch {
    // A missing or malformed browser-supplied URL is not a trusted Steam caller.
  }
  throw new Error('Public Steam catalog requests are only available from a Steam Store tab');
}

export function senderStore(sender: MessageSender): Store | undefined {
  try {
    const url = new URL(sender.url ?? '');
    if (url.username || url.password) return undefined;
    if (url.origin === 'https://account.battle.net') {
      return url.pathname === '/games' && !url.search && !url.hash ? 'battlenet' : undefined;
    }
    const stores: Readonly<Record<string, Store>> = {
      'https://store.steampowered.com': 'steam',
      'https://www.gog.com': 'gog',
      'https://gog.com': 'gog',
      'https://store.epicgames.com': 'epic',
    };
    return stores[url.origin];
  } catch {
    return undefined;
  }
}
import type { Store } from '../core/schema';
