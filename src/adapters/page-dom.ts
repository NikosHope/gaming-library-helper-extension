import type { PageCandidate } from '../core/library';

export interface DomGameCandidate extends PageCandidate {
  element: HTMLElement;
  titleElement: HTMLElement;
  isDetailPage: boolean;
}

function steamAppId(url: string): string | undefined {
  return /\/app\/(\d+)/u.exec(url)?.[1];
}

function storeText(element: Element | null): string | undefined {
  if (!element) return undefined;
  if (!element.querySelector('.glh-ownership-badge'))
    return element.textContent?.trim() || undefined;
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('.glh-ownership-badge').forEach((badge) => badge.remove());
  return copy.textContent?.trim() || undefined;
}

function textFrom(root: Element, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = storeText(root.querySelector<HTMLElement>(selector));
    if (text) return text;
  }
  const imageAlt = root.querySelector<HTMLImageElement>('img[alt]')?.alt.trim();
  return imageAlt || undefined;
}

function uniqueByElement(candidates: DomGameCandidate[]): DomGameCandidate[] {
  const seen = new Set<HTMLElement>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.element)) return false;
    seen.add(candidate.element);
    return true;
  });
}

export function collectSteamCandidates(document: Document): DomGameCandidate[] {
  const candidates: DomGameCandidate[] = [];
  const detailId = steamAppId(location.href);
  const detailTitle = document.querySelector<HTMLElement>('.apphub_AppName');
  const cleanDetailTitle = storeText(detailTitle);
  if (detailId && detailTitle && cleanDetailTitle) {
    candidates.push({
      store: 'steam',
      storeId: detailId,
      title: cleanDetailTitle,
      element: detailTitle.closest<HTMLElement>('.apphub_AppName') ?? detailTitle,
      titleElement: detailTitle,
      isDetailPage: true,
    });
  }

  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'a.search_result_row, a[data-ds-appid], a[href*="/app/"]',
  );
  for (const anchor of anchors) {
    const id = anchor.dataset.dsAppid?.split(',')[0] ?? steamAppId(anchor.href);
    if (!id) continue;
    const title = textFrom(anchor, [
      '.title',
      '.tab_item_name',
      '[class*="StoreSaleWidgetTitle"]',
      '[class*="CapsuleTitle"]',
    ]);
    if (!title) continue;
    const titleElement =
      anchor.querySelector<HTMLElement>(
        '.title, .tab_item_name, [class*="StoreSaleWidgetTitle"], [class*="CapsuleTitle"]',
      ) ?? anchor;
    candidates.push({
      store: 'steam',
      storeId: id,
      title,
      element: anchor,
      titleElement,
      isDetailPage: false,
    });
  }
  return uniqueByElement(candidates);
}

function gogProductId(element: HTMLElement): string | undefined {
  const raw =
    element.dataset.productId ??
    element.getAttribute('product-id') ??
    element.querySelector<HTMLElement>('[data-product-id]')?.dataset.productId;
  return raw || undefined;
}

export function collectGogCandidates(document: Document): DomGameCandidate[] {
  const candidates: DomGameCandidate[] = [];
  const isDetail =
    /^\/[^/]*game\//u.test(location.pathname) || location.pathname.includes('/game/');
  const detailTitle = document.querySelector<HTMLElement>('h1');
  const cleanDetailTitle = storeText(detailTitle);
  if (isDetail && detailTitle && cleanDetailTitle) {
    candidates.push({
      store: 'gog',
      title: cleanDetailTitle,
      element: detailTitle,
      titleElement: detailTitle,
      isDetailPage: true,
    });
  }

  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/game/"]');
  for (const anchor of anchors) {
    const root =
      anchor.closest<HTMLElement>('[data-product-id], .product-tile, [class*="product-tile"]') ??
      anchor;
    const title = textFrom(root, [
      '.product-tile__title',
      '[data-testid*="title"]',
      '[class*="ProductTitle"]',
      '[class*="title"]',
    ]);
    if (!title) continue;
    const titleElement =
      root.querySelector<HTMLElement>(
        '.product-tile__title, [data-testid*="title"], [class*="ProductTitle"], [class*="title"]',
      ) ?? anchor;
    const storeId = gogProductId(root);
    candidates.push({
      store: 'gog',
      ...(storeId ? { storeId } : {}),
      title,
      element: root,
      titleElement,
      isDetailPage: false,
    });
  }
  return uniqueByElement(candidates);
}

export function currentStore(): 'steam' | 'gog' | undefined {
  if (location.hostname === 'store.steampowered.com') return 'steam';
  if (location.hostname === 'www.gog.com' || location.hostname === 'gog.com') return 'gog';
  return undefined;
}
