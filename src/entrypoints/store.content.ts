import { browser } from 'wxt/browser';
import { captureGogSnapshot } from '../adapters/gog';
import {
  collectGogCandidates,
  collectSteamCandidates,
  currentStore,
  type DomGameCandidate,
} from '../adapters/page-dom';
import { captureSteamSnapshot } from '../adapters/steam';
import { findGameForPage, otherStore } from '../core/library';
import { CaptureRequestSchema } from '../core/messages';
import { LibraryStateSchema, PriceQuoteSchema, type LibraryState } from '../core/schema';
import { decideVisibility } from '../core/visibility';

const BADGE_CLASS = 'glh-ownership-badge';
const PRICE_CLASS = 'glh-price-badge';

function installStyles(): void {
  if (document.getElementById('glh-styles')) return;
  const style = document.createElement('style');
  style.id = 'glh-styles';
  style.textContent = `
    .${BADGE_CLASS}, .${PRICE_CLASS} {
      display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 3px 7px;
      border-radius: 999px; font: 600 11px/1.2 system-ui, sans-serif; vertical-align: middle;
      text-decoration: none !important; box-sizing: border-box;
    }
    .${BADGE_CLASS} { color: #072916; background: #70e19c; border: 1px solid #27a75a; }
    .${PRICE_CLASS} { color: #10243b; background: #9bd0ff; border: 1px solid #3a8ac7; }
    [data-glh-highlighted="true"] { outline: 3px solid #70e19c !important; outline-offset: -3px; }
  `;
  document.head.append(style);
}

function candidatesFor(store: 'steam' | 'gog'): DomGameCandidate[] {
  return store === 'steam' ? collectSteamCandidates(document) : collectGogCandidates(document);
}

function resetCandidate(candidate: DomGameCandidate): void {
  candidate.element
    .querySelectorAll(`.${BADGE_CLASS}, .${PRICE_CLASS}`)
    .forEach((node) => node.remove());
  candidate.element.removeAttribute('data-glh-highlighted');
  if (candidate.element.dataset.glhHidden === 'true') {
    candidate.element.style.removeProperty('display');
    delete candidate.element.dataset.glhHidden;
  }
}

function addOwnershipBadge(candidate: DomGameCandidate, label: string): void {
  const badge = document.createElement('span');
  badge.className = BADGE_CLASS;
  badge.textContent = label;
  candidate.titleElement.append(badge);
}

function addPriceBadge(candidate: DomGameCandidate, quote: unknown): void {
  const parsed = PriceQuoteSchema.safeParse(quote);
  if (!parsed.success) return;
  const value = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: parsed.data.currency,
  }).format(parsed.data.amount);
  const link = document.createElement('a');
  link.className = PRICE_CLASS;
  link.href = parsed.data.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = `${parsed.data.store.toUpperCase()}: ${value}`;
  link.title = `Price from IsThereAnyDeal, fetched ${new Date(parsed.data.fetchedAt).toLocaleString()}`;
  candidate.titleElement.append(link);
}

async function decorate(state: LibraryState): Promise<void> {
  const store = currentStore();
  if (!store) return;
  installStyles();

  for (const candidate of candidatesFor(store)) {
    resetCandidate(candidate);
    const game = findGameForPage(state, candidate);
    const decision = decideVisibility(game, candidate, state.settings);
    if (decision.hide) {
      candidate.element.style.setProperty('display', 'none', 'important');
      candidate.element.dataset.glhHidden = 'true';
      continue;
    }
    if (decision.highlight && game) {
      const opposite = otherStore(store);
      candidate.element.dataset.glhHighlighted = 'true';
      addOwnershipBadge(candidate, `Owned on ${opposite.toUpperCase()}`);
    }

    if (
      candidate.isDetailPage &&
      state.settings.prices.enabled &&
      !decision.otherStoreOwned &&
      candidate.element.dataset.glhPriceRequested !== 'true'
    ) {
      candidate.element.dataset.glhPriceRequested = 'true';
      try {
        const quote = (await browser.runtime.sendMessage({
          type: 'price:get',
          title: candidate.title,
          currentStore: store,
          steamAppId: store === 'steam' ? candidate.storeId : undefined,
        })) as unknown;
        addPriceBadge(candidate, quote);
      } catch {
        delete candidate.element.dataset.glhPriceRequested;
      }
    }
  }
}

async function loadView(): Promise<LibraryState> {
  return LibraryStateSchema.parse(await browser.runtime.sendMessage({ type: 'view:get' }));
}

async function captureCurrentStore(): Promise<unknown> {
  const store = currentStore();
  if (!store) throw new Error('Open a Steam Store or GOG tab first');
  const refs = store === 'steam' ? await captureSteamSnapshot() : await captureGogSnapshot();
  const result = (await browser.runtime.sendMessage({
    type: 'library:replaceSnapshot',
    store,
    syncedAt: new Date().toISOString(),
    refs,
  })) as unknown;
  await decorate(await loadView());
  return result;
}

export default defineContentScript({
  matches: ['https://store.steampowered.com/*', 'https://www.gog.com/*', 'https://gog.com/*'],
  runAt: 'document_idle',
  main() {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadView()
          .then(decorate)
          .catch(() => undefined);
      }, 200);
    };

    // Firefox runtime listeners intentionally return a Promise for async responses.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    browser.runtime.onMessage.addListener((raw: unknown) => {
      if (!CaptureRequestSchema.safeParse(raw).success) return undefined;
      return captureCurrentStore();
    });
    browser.storage.onChanged.addListener(scheduleRefresh);
    new MutationObserver(scheduleRefresh).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    scheduleRefresh();
  },
});
