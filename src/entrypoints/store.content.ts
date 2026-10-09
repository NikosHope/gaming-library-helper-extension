import { browser } from 'wxt/browser';
import { captureGogSnapshot } from '../adapters/gog';
import { captureEpicSnapshot } from '../adapters/epic';
import {
  collectGogCandidates,
  collectSteamCandidates,
  currentStore,
  type DomGameCandidate,
} from '../adapters/page-dom';
import { captureSteamSnapshot } from '../adapters/steam';
import { findGameForPage, ownedOnOtherStores } from '../core/library';
import { CaptureRequestSchema } from '../core/messages';
import { LibraryStateSchema, type LibraryState } from '../core/schema';
import { decideVisibility } from '../core/visibility';

const BADGE_CLASS = 'glh-ownership-badge';
let pageObserver: MutationObserver | undefined;

function installStyles(): void {
  if (document.getElementById('glh-styles')) return;
  const style = document.createElement('style');
  style.id = 'glh-styles';
  style.textContent = `
    .${BADGE_CLASS} {
      display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 3px 7px;
      border-radius: 999px; font: 600 11px/1.2 system-ui, sans-serif; vertical-align: middle;
      text-decoration: none !important; box-sizing: border-box;
    }
    .${BADGE_CLASS} { color: #072916; background: #70e19c; border: 1px solid #27a75a; }
    [data-glh-highlighted="true"] { outline: 3px solid #70e19c !important; outline-offset: -3px; }
  `;
  document.head.append(style);
}

function candidatesFor(store: 'steam' | 'gog'): DomGameCandidate[] {
  return store === 'steam' ? collectSteamCandidates(document) : collectGogCandidates(document);
}

function resetCandidate(candidate: DomGameCandidate): void {
  candidate.element.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
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

function decorate(state: LibraryState): void {
  const store = currentStore();
  if (!store) return;
  pageObserver?.disconnect();
  try {
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
        const opposite = ownedOnOtherStores(game, store)
          .map((value) =>
            value === 'battlenet'
              ? 'Battle.net'
              : value === 'amazon'
                ? 'Amazon Games'
                : value.toUpperCase(),
          )
          .join(', ');
        candidate.element.dataset.glhHighlighted = 'true';
        addOwnershipBadge(candidate, `Owned on ${opposite}`);
      }
    }
  } finally {
    pageObserver?.observe(document.documentElement, { childList: true, subtree: true });
  }
}

async function loadView(): Promise<LibraryState> {
  return LibraryStateSchema.parse(await browser.runtime.sendMessage({ type: 'view:get' }));
}

async function performCapture(): Promise<unknown> {
  const store = location.hostname === 'store.epicgames.com' ? 'epic' : currentStore();
  if (!store) throw new Error('Open a supported store tab first');
  const syncedAt = new Date().toISOString();
  const refs =
    store === 'steam'
      ? await captureSteamSnapshot(fetch, (appIds) =>
          browser.runtime.sendMessage({ type: 'steam:catalog', appIds }),
        )
      : store === 'gog'
        ? await captureGogSnapshot()
        : await captureEpicSnapshot();
  const result = (await browser.runtime.sendMessage({
    type: 'library:replaceSnapshot',
    store,
    syncedAt,
    refs,
  })) as unknown;
  decorate(await loadView());
  return result;
}

let captureInFlight: Promise<unknown> | undefined;

function captureCurrentStore(): Promise<unknown> {
  if (captureInFlight) return captureInFlight;
  captureInFlight = performCapture().finally(() => {
    captureInFlight = undefined;
  });
  return captureInFlight;
}

export default defineContentScript({
  matches: [
    'https://store.steampowered.com/*',
    'https://www.gog.com/*',
    'https://gog.com/*',
    'https://store.epicgames.com/*',
  ],
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
    if (!currentStore()) return;
    browser.storage.onChanged.addListener(scheduleRefresh);
    pageObserver = new MutationObserver(scheduleRefresh);
    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    scheduleRefresh();
  },
});
