import type { LibraryState, Store } from '../core/schema';
import {
  projectLibrary,
  productKey,
  catalogKey,
  type CatalogGameView,
  type ProductDisposition,
} from '../core/reconciliation';
import { PublicEvidenceUrlSchema, type Proposal } from '../core/reconciliation-schema';
import { isProductIgnored, type StoreProduct } from '../core/annotations';

export const STORE_NAMES: Record<Store, string> = {
  steam: 'Steam',
  gog: 'GOG',
  epic: 'Epic Games',
  amazon: 'Amazon Games',
  battlenet: 'Battle.net',
};
export type LibraryPanel = 'games' | 'unknown' | 'technical';
export interface CatalogRenderOptions {
  panel: LibraryPanel;
  query: string;
  page: number;
  canReview: boolean;
  pendingReviews: ReadonlySet<string>;
  onIgnored: (products: StoreProduct[], ignored: boolean) => Promise<void>;
  onApprove: (proposal: Proposal, independence: boolean) => Promise<void>;
}
export const LIBRARY_PAGE_SIZE = 100;

const text = (document: Document, tag: string, value: string, className?: string): HTMLElement => {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
};
function cell(document: Document, row: HTMLTableRowElement): HTMLTableCellElement {
  const element = document.createElement('td');
  row.append(element);
  return element;
}
function link(document: Document, label: string, url: string): HTMLElement {
  if (!PublicEvidenceUrlSchema.safeParse(url).success) return text(document, 'span', label);
  const anchor = document.createElement('a');
  anchor.textContent = label;
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}
function details(document: Document, label: string, key: string): HTMLDetailsElement {
  const element = document.createElement('details');
  element.dataset.key = key;
  element.append(text(document, 'summary', label));
  return element;
}
function matchesQuery(values: (string | undefined)[], query: string): boolean {
  return !query || values.some((value) => value?.toLocaleLowerCase().includes(query));
}
function productText(item: ProductDisposition, state: LibraryState): string[] {
  const key = productKey(item.footprint);
  return [
    key,
    STORE_NAMES[item.footprint.store],
    item.footprint.title,
    item.reason,
    item.footprint.sourceType ?? '',
    ...item.packageIds,
    ...state.registry.proposals
      .filter((proposal) => productKey(proposal) === key)
      .flatMap((proposal) => [catalogKey(proposal.candidate), proposal.rationale]),
  ];
}
export function librarySummary(state: LibraryState): {
  games: number;
  products: number;
  unknown: number;
  technical: number;
  shared: number;
  stores: Record<Store, number>;
} {
  const projection = projectLibrary(state);
  const stores: Record<Store, number> = { steam: 0, gog: 0, epic: 0, amazon: 0, battlenet: 0 };
  for (const game of projection.games)
    for (const store of new Set(game.products.map((item) => item.footprint.store))) stores[store]++;
  return {
    games: projection.games.length,
    products:
      projection.games.reduce((count, game) => count + game.products.length, 0) +
      projection.unknown.length +
      projection.technical.length,
    unknown: projection.unknown.length,
    technical: projection.technical.length,
    shared: projection.games.filter(
      (game) => new Set(game.products.map((item) => item.footprint.store)).size > 1,
    ).length,
    stores,
  };
}
function officialOs(
  document: Document,
  state: LibraryState,
  item: ProductDisposition,
): HTMLElement {
  const container = document.createElement('div');
  const observations = state.registry.platforms
    .filter((entry) => productKey(entry) === productKey(item.footprint))
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  const latest = observations[0];
  container.append(
    text(
      document,
      'p',
      `${STORE_NAMES[item.footprint.store]} · ${item.footprint.storeId}`,
      'product-label',
    ),
  );
  if (!latest) {
    container.append(text(document, 'p', 'Official OS unknown', 'hint'));
    return container;
  }
  const labels = [
    ['windows', 'Windows'],
    ['macos', 'macOS'],
    ['linux', 'Linux'],
  ] as const;
  for (const [field, label] of labels)
    container.append(
      text(
        document,
        'span',
        `${label}: ${latest[field] === true ? 'yes' : latest[field] === false ? 'no' : 'unknown'}`,
        'os-label',
      ),
    );
  container.append(
    link(
      document,
      `Official product evidence · ${new Date(latest.checkedAt).toLocaleDateString()}`,
      latest.evidenceUrl,
    ),
  );
  return container;
}
function sourceDetails(
  document: Document,
  state: LibraryState,
  item: ProductDisposition,
): HTMLElement {
  const footprint = item.footprint;
  const container = document.createElement('div');
  container.className = 'product-detail';
  container.append(
    text(document, 'p', `${STORE_NAMES[footprint.store]} · ${footprint.storeId}`, 'product-label'),
  );
  container.append(text(document, 'p', `Original title: ${footprint.title}`, 'hint'));
  container.append(
    text(
      document,
      'p',
      isProductIgnored(state, footprint) ? 'Product ignored locally' : 'Product visible locally',
      'hint',
    ),
  );
  const observations = state.registry.products.filter(
    (entry) => productKey(entry) === productKey(footprint),
  );
  const observed = observations.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (observed && observed.title !== footprint.title)
    container.append(text(document, 'p', `Metadata title: ${observed.title}`, 'hint'));
  container.append(
    text(
      document,
      'p',
      `Store type: ${footprint.sourceType ?? observed?.sourceType ?? 'not supplied'} · computed role: ${item.role}${item.inferred ? ' (inferred)' : ''}`,
      'hint',
    ),
  );
  if (item.record)
    container.append(
      link(
        document,
        `${catalogKey(item.record.identity)} · ${item.record.kind} · checked ${new Date(item.record.checkedAt).toLocaleDateString()}`,
        item.record.url,
      ),
    );
  if (footprint.observedAt)
    container.append(
      text(
        document,
        'p',
        `Ownership observed: ${new Date(footprint.observedAt).toLocaleString()}`,
        'hint',
      ),
    );
  if (footprint.publicUrl) container.append(link(document, 'Store product', footprint.publicUrl));
  if (footprint.store === 'steam') {
    container.append(
      link(document, 'Steam', `https://store.steampowered.com/app/${footprint.storeId}/`),
    );
    container.append(
      link(
        document,
        'SteamDB · manual inspection',
        `https://steamdb.info/app/${footprint.storeId}/`,
      ),
    );
  }
  for (const source of state.games.filter((game) =>
    Object.values(game.storeRefs).some((ref) => productKey(ref) === productKey(footprint)),
  )) {
    const annotation = details(
      document,
      'Local source record and annotations',
      `source:${source.id}:${productKey(footprint)}`,
    );
    annotation.append(text(document, 'p', `UUID: ${source.id}`, 'hint'));
    annotation.append(
      text(
        document,
        'p',
        source.ignored ? 'Original record: ignored' : 'Original record: not ignored',
        'hint',
      ),
    );
    if (source.notes) annotation.append(text(document, 'p', source.notes, 'local-notes'));
    if (source.aliases.length)
      annotation.append(text(document, 'p', `Local aliases: ${source.aliases.join(', ')}`, 'hint'));
    if (source.launchPaths.length || source.performance.length)
      annotation.append(
        text(
          document,
          'p',
          `${source.launchPaths.length} saved launch paths · ${source.performance.length} performance assessments`,
          'hint',
        ),
      );
    container.append(annotation);
  }
  return container;
}
function packageDetails(
  document: Document,
  state: LibraryState,
  item: ProductDisposition,
): HTMLElement {
  const container = document.createElement('div');
  for (const packageId of item.packageIds) {
    const observation = state.registry.packages
      .filter((entry) => entry.packageId === packageId)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
    if (!observation) continue;
    const panel = details(
      document,
      `Steam package ${packageId} · ${observation.complete ? 'complete' : 'partial'} observation`,
      `package:${productKey(item.footprint)}:${packageId}`,
    );
    panel.append(
      link(
        document,
        `Package evidence · ${observation.checkedAt.slice(0, 10)}`,
        observation.evidenceUrl,
      ),
    );
    panel.append(
      text(document, 'p', 'Package neighbours do not add ownership or rename this app.', 'hint'),
    );
    for (const appId of observation.appIds) {
      const product = state.registry.products.find(
        (entry) => entry.store === 'steam' && entry.storeId === appId,
      );
      panel.append(
        text(
          document,
          'p',
          `steam:${appId}${product?.titleStatus === 'resolved' ? ` · ${product.title}` : ''}`,
          'hint',
        ),
      );
    }
    container.append(panel);
  }
  return container;
}
function proposalDetails(
  document: Document,
  state: LibraryState,
  item: ProductDisposition,
  options: CatalogRenderOptions,
): HTMLElement {
  const container = document.createElement('div');
  const proposals = state.registry.proposals.filter(
    (proposal) => productKey(proposal) === productKey(item.footprint),
  );
  for (const proposal of proposals) {
    const record = state.registry.records.find(
      (entry) => catalogKey(entry.identity) === catalogKey(proposal.candidate),
    );
    const panel = details(
      document,
      `${catalogKey(proposal.candidate)}${record ? ` · ${record.title}` : ''}`,
      `proposal:${proposal.id}`,
    );
    panel.append(text(document, 'p', proposal.rationale, 'hint'));
    const check = state.registry.candidateChecks.find((entry) => entry.proposalId === proposal.id);
    panel.append(
      text(
        document,
        'p',
        `ID check: ${check?.outcome ?? 'not checked'} · ${proposal.origin}. This is a candidate, not a confirmed identity.`,
        'hint',
      ),
    );
    for (const [index, url] of proposal.evidenceUrls.entries())
      panel.append(link(document, `Evidence ${index + 1}`, url));
    let independence: HTMLInputElement | undefined;
    if (proposal.independence) {
      panel.append(
        text(
          document,
          'p',
          `Proposed launch requirements: ${proposal.independence.kind} · ${proposal.independence.dependency}`,
          'hint',
        ),
      );
      for (const url of proposal.independence.evidenceUrls)
        panel.append(link(document, 'Launch evidence', url));
      const label = document.createElement('label');
      label.className = 'checkbox hint';
      independence = document.createElement('input');
      independence.type = 'checkbox';
      label.append(
        independence,
        text(document, 'span', 'I also confirm these launch requirements'),
      );
      panel.append(label);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.disabled =
      !options.canReview || check?.outcome !== 'exists' || options.pendingReviews.has(proposal.id);
    button.textContent = options.pendingReviews.has(proposal.id)
      ? 'Decision recorded'
      : `Confirm ${catalogKey(proposal.candidate)}`;
    button.addEventListener('click', () => {
      button.disabled = true;
      void options.onApprove(proposal, independence?.checked ?? false).catch(() => {
        button.disabled = false;
      });
    });
    panel.append(button);
    container.append(panel);
  }
  if (!proposals.length)
    container.append(
      text(document, 'p', 'No verified candidate yet. Run local reconciliation.', 'hint'),
    );
  return container;
}
function gameRow(
  document: Document,
  state: LibraryState,
  game: CatalogGameView,
  options: CatalogRenderOptions,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  const name = cell(document, row);
  const record = state.registry.records.find((entry) => catalogKey(entry.identity) === game.key);
  name.append(text(document, 'strong', game.title));
  if (record) name.append(link(document, `${catalogKey(game.identity)} · confirmed`, record.url));
  const ignored = game.products.some((item) => isProductIgnored(state, item.footprint));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'small';
  button.textContent = ignored ? 'Unignore game' : 'Ignore game';
  button.addEventListener('click', () => {
    button.disabled = true;
    void options
      .onIgnored(
        game.products.map((item) => ({
          store: item.footprint.store,
          storeId: item.footprint.storeId,
        })),
        !ignored,
      )
      .catch(() => {
        button.disabled = false;
      });
  });
  name.append(button);
  const products = cell(document, row);
  const stores = [...new Set(game.products.map((item) => STORE_NAMES[item.footprint.store]))];
  const panel = details(
    document,
    `${stores.join(' + ')} · ${game.products.length} owned products`,
    `game:${game.key}`,
  );
  for (const product of game.products) panel.append(sourceDetails(document, state, product));
  if (game.components.length) {
    panel.append(text(document, 'p', 'Owned components', 'product-label'));
    for (const component of game.components)
      panel.append(sourceDetails(document, state, component));
  }
  products.append(panel);
  const platforms = cell(document, row);
  for (const product of game.products) platforms.append(officialOs(document, state, product));
  return row;
}
export function renderCatalogLibrary(
  document: Document,
  state: LibraryState,
  options: CatalogRenderOptions,
): { total: number; pages: number; page: number } {
  const projection = projectLibrary(state);
  const query = options.query.trim().toLocaleLowerCase();
  const all =
    options.panel === 'games'
      ? projection.games.filter((game) =>
          matchesQuery(
            [
              game.title,
              game.key,
              ...game.products.flatMap((item) => productText(item, state)),
              ...game.components.flatMap((item) => productText(item, state)),
            ],
            query,
          ),
        )
      : projection[options.panel].filter((item) => matchesQuery(productText(item, state), query));
  const pages = Math.max(1, Math.ceil(all.length / LIBRARY_PAGE_SIZE));
  const page = Math.min(Math.max(0, options.page), pages - 1);
  const target = document.getElementById(`panel-${options.panel}`);
  if (!target) throw new Error('Library panel is missing');
  const open = new Set(
    [...target.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
      (element) => element.dataset.key,
    ),
  );
  for (const panel of ['games', 'unknown', 'technical'] as const) {
    const node = document.getElementById(`panel-${panel}`);
    if (!node) throw new Error('Library panel is missing');
    node.hidden = panel !== options.panel;
  }
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const heading = document.createElement('tr');
  head.append(heading);
  table.append(head);
  const titles =
    options.panel === 'games'
      ? ['Game / catalog', 'Owned products', 'Official OS']
      : options.panel === 'unknown'
        ? ['Original record', 'Why unresolved', 'Evidence / candidates']
        : ['Original record', 'Computed role', 'Technical evidence'];
  for (const title of titles) heading.append(text(document, 'th', title));
  const body = document.createElement('tbody');
  table.append(body);
  for (const item of all.slice(page * LIBRARY_PAGE_SIZE, (page + 1) * LIBRARY_PAGE_SIZE)) {
    if ('products' in item) body.append(gameRow(document, state, item, options));
    else {
      const row = document.createElement('tr');
      body.append(row);
      const name = cell(document, row);
      name.append(text(document, 'strong', item.footprint.title));
      const source = details(
        document,
        `${STORE_NAMES[item.footprint.store]} · ${item.footprint.storeId}`,
        `product:${productKey(item.footprint)}`,
      );
      source.append(sourceDetails(document, state, item));
      name.append(source);
      const reason = cell(document, row);
      reason.append(
        text(
          document,
          'p',
          options.panel === 'unknown'
            ? item.reason
            : `${item.role}${item.inferred ? ' (inferred)' : ''}`,
          'hint',
        ),
      );
      if (options.panel === 'technical') reason.append(text(document, 'p', item.reason, 'hint'));
      const evidence = cell(document, row);
      if (options.panel === 'unknown')
        evidence.append(proposalDetails(document, state, item, options));
      evidence.append(packageDetails(document, state, item));
      if (options.panel === 'technical') evidence.append(officialOs(document, state, item));
    }
  }
  target.replaceChildren(table);
  for (const element of target.querySelectorAll<HTMLDetailsElement>('details'))
    if (open.has(element.dataset.key)) element.open = true;
  if (!all.length) {
    const message =
      options.panel === 'games' && !projection.games.length
        ? 'No confirmed catalog games yet. Your original records are preserved in Unknown and Technical records.'
        : 'No records match this filter.';
    target.append(text(document, 'p', message, 'empty-state hint'));
  }
  return { total: all.length, pages, page };
}
