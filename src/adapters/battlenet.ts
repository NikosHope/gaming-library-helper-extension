import { z } from 'zod/v3';
import { normalizeTitle } from '../core/normalize';
import type { StoreGameRef } from '../core/schema';

export const BATTLENET_ORIGIN = 'https://account.battle.net/*';
export const BATTLENET_GAMES_URL = 'https://account.battle.net/games';
const MAX_ROWS = 2_000;
const AccountSchema = z.object({
  titleId: z.number().int().positive().safe(),
  localizedGameName: z.string().trim().min(1).max(1_000),
  gameAccountStatus: z.enum(['Good', 'Trial']),
});
const PayloadSchema = z.object({ gameAccounts: z.array(AccountSchema).max(MAX_ROWS) });
type Account = z.infer<typeof AccountSchema>;
export type BattleNetSnapshotRef = Omit<StoreGameRef, 'store'> & { store: 'battlenet' };
type TitleRow = { title: string; icon: string; status?: string };
type TitleCells = { modern: TitleRow[]; classic: TitleRow[] };

// Public product identities adapted from MIT PlayniteExtensions, commit 886468f65724e6fd104f3a09847a17ba57cfb430.
// Copyright (c) 2020 Josef Nemec; see docs/licenses/playnite-extensions-MIT.txt.
// The live account page now uses shared SVG icons, so an icon alone cannot identify an edition.
const CLASSIC_PRODUCTS = [
  { id: 'D2', title: 'Diablo II', icons: ['diablo-ii.svg', 'd2dv-32.4PqK2.png'] },
  {
    id: 'D2X',
    title: 'Diablo II: Lord of Destruction',
    icons: ['diablo-ii.svg', 'd2xp.1gR7W.png'],
    parent: 'D2',
  },
  { id: 'W3C', title: 'Warcraft III: Reign of Chaos', icons: ['warcraft-iii.svg'] },
  {
    id: 'W3CX',
    title: 'Warcraft III: The Frozen Throne',
    icons: ['warcraft-iii-reforged.svg'],
    parent: 'W3C',
  },
] as const;

function unsupported(): Error {
  return new Error(
    'Battle.net game data is incomplete or unsupported. Open Games & Subscriptions, wait for both game lists, then retry. The previous library is unchanged.',
  );
}

/** Read only title spans, icon URLs and modern statuses. Never read a row/cell's aggregate text. */
export function readBattleNetTitleCells(document: Document): TitleCells | undefined {
  const read = (kind: 'game-accounts' | 'classic-game-accounts'): TitleRow[] | undefined => {
    const section = document.querySelector(`[data-blz-addressable-by="${kind}"]`);
    if (!section || section.querySelector('[class*="spinner"]')) return undefined;
    const rows = [...section.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    // An absent/empty classic card cannot distinguish zero licenses from a failed account request.
    if (!rows.length) return undefined;
    if (rows.length > MAX_ROWS) throw unsupported();
    return rows.map((row) => {
      const cells = row.querySelectorAll(':scope > td');
      const title = cells[1]?.querySelector(':scope > span.text-light')?.textContent?.trim();
      const image = cells[0]?.querySelector('img')?.getAttribute('src');
      const icon = image?.split('/').at(-1);
      const status =
        kind === 'game-accounts' ? cells[2]?.querySelector('span')?.textContent?.trim() : undefined;
      if (!title || title.length > 1_000 || !icon || !/^[A-Za-z0-9_.-]{1,100}$/u.test(icon))
        throw unsupported();
      if (kind === 'game-accounts' && status !== 'Active' && status !== 'Starter Edition')
        throw unsupported();
      return { title, icon, ...(status ? { status } : {}) };
    });
  };
  const modern = read('game-accounts');
  const classic = read('classic-game-accounts');
  return modern && classic ? { modern, classic } : undefined;
}

export function buildBattleNetSnapshot(
  payload: unknown,
  cells: TitleCells,
  importedAt: string,
): BattleNetSnapshotRef[] {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success || !cells.classic.length || cells.classic.length > MAX_ROWS)
    throw unsupported();
  const accounts = parsed.data.gameAccounts;
  const signature = (title: string, status: string): string => `${normalizeTitle(title)}|${status}`;
  const expected = accounts
    .map((account) =>
      signature(
        account.localizedGameName,
        account.gameAccountStatus === 'Good' ? 'Active' : 'Starter Edition',
      ),
    )
    .sort();
  const rendered = cells.modern.map((row) => signature(row.title, row.status ?? '')).sort();
  if (JSON.stringify(expected) !== JSON.stringify(rendered)) throw unsupported();

  const titles = new Map<number, string>();
  const refs = new Map<string, BattleNetSnapshotRef>();
  for (const account of accounts) {
    const title = normalizeTitle(account.localizedGameName);
    if (titles.has(account.titleId) && titles.get(account.titleId) !== title) throw unsupported();
    titles.set(account.titleId, title);
    if (account.gameAccountStatus === 'Trial') continue;
    const ref = modernRef(account, importedAt);
    refs.set(ref.storeId, ref);
  }
  for (const row of cells.classic) {
    const product = CLASSIC_PRODUCTS.find(
      (candidate) =>
        normalizeTitle(candidate.title) === normalizeTitle(row.title) &&
        candidate.icons.some((icon) => icon === row.icon),
    );
    if (!product) throw unsupported();
    const parentId = 'parent' in product ? product.parent : undefined;
    const parent = CLASSIC_PRODUCTS.find((candidate) => candidate.id === parentId);
    const ref: BattleNetSnapshotRef = {
      store: 'battlenet',
      storeId: `classic:${product.id}`,
      title: row.title,
      titleStatus: 'resolved',
      url: BATTLENET_GAMES_URL,
      owned: true,
      ignoredAtSource: false,
      importedAt,
      classification: {
        kind: parent ? 'component' : 'game',
        source: 'reviewed-rule',
        confidence: 'primary',
        evidenceUrls: [
          BATTLENET_GAMES_URL,
          ...(parentId === 'D2'
            ? ['https://classic.battle.net/diablo2exp/faq/expansion.shtml']
            : parentId === 'W3C'
              ? ['https://worldofwarcraft.blizzard.com/en-gb/story/timeline/chapter-5']
              : []),
        ],
        ...(parent
          ? {
              componentType: 'dlc' as const,
              parent: {
                store: 'battlenet' as const,
                storeId: `classic:${parent.id}`,
                title: parent.title,
                evidenceUrl: BATTLENET_GAMES_URL,
              },
            }
          : {}),
      },
    };
    // Several license keys for one product produce one product reference; keys are never read.
    refs.set(ref.storeId, ref);
  }
  return [...refs.values()];
}

function modernRef(account: Account, importedAt: string): BattleNetSnapshotRef {
  return {
    store: 'battlenet',
    storeId: `title:${account.titleId}`,
    title: account.localizedGameName,
    titleStatus: 'resolved',
    url: BATTLENET_GAMES_URL,
    owned: true,
    ignoredAtSource: false,
    importedAt,
    classification: {
      kind: 'game',
      source: 'store-metadata',
      confidence: 'primary',
      evidenceUrls: [BATTLENET_GAMES_URL],
    },
  };
}

export async function captureBattleNetSnapshot(
  document: Document,
  fetcher: typeof fetch = fetch,
): Promise<BattleNetSnapshotRef[]> {
  const importedAt = new Date().toISOString();
  let payload: unknown;
  try {
    const response = await fetcher('https://account.battle.net/api/games-and-subs', {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw unsupported();
    payload = (await response.json()) as unknown;
  } catch {
    throw new Error(
      'Battle.net access failed. Sign in in its account tab, then retry. The previous library is unchanged.',
    );
  }
  const deadline = Date.now() + 15_000;
  do {
    const cells = readBattleNetTitleCells(document);
    if (cells) return buildBattleNetSnapshot(payload, cells, importedAt);
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  throw unsupported();
}
