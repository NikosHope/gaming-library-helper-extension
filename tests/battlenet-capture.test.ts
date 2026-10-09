import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBattleNetSnapshot,
  captureBattleNetSnapshot,
  readBattleNetTitleCells,
} from '../src/adapters/battlenet';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const payload = (): unknown => JSON.parse(fixture('battlenet-games.json')) as unknown;
const doc = (): Document => parseHTML(fixture('battlenet-games.html')).document;
const date = '2026-10-09T05:00:00.000Z';
afterEach(() => vi.useRealTimers());

describe('Battle.net key-free complete capture', () => {
  it('reads only allowed title descendants and ignores private account/key cells', () => {
    const document = doc();
    for (const row of document.querySelectorAll<HTMLTableRowElement>('tr')) {
      const cells = row.querySelectorAll(':scope > td');
      Object.defineProperty(row, 'textContent', {
        get: () => {
          throw new Error('row text must not be read');
        },
      });
      Object.defineProperty(cells[1], 'textContent', {
        get: () => {
          throw new Error('aggregate title cell must not be read');
        },
      });
      if (row.closest('[data-blz-addressable-by="classic-game-accounts"]')) {
        Object.defineProperty(cells[2], 'textContent', {
          get: () => {
            throw new Error('key cell must not be read');
          },
        });
      }
    }
    const cells = readBattleNetTitleCells(document)!;
    const refs = buildBattleNetSnapshot(payload(), cells, date);
    expect(refs).toHaveLength(10);
    expect(refs.map((ref) => ref.storeId)).toContain('title:1146246220');
    expect(refs.some((ref) => ref.storeId === 'title:5730135')).toBe(false);
    expect(JSON.stringify(refs)).not.toMatch(/synthetic|account-name|key/u);
    expect(
      refs.filter((ref) => ref.classification?.kind === 'component').map((ref) => ref.storeId),
    ).toEqual(['classic:D2X', 'classic:W3CX']);
    expect(refs.find((ref) => ref.storeId === 'classic:W3C')?.title).toContain('Reign of Chaos');
    expect(refs.some((ref) => ref.title === 'Warcraft III: Reforged')).toBe(false);
  });

  it('deduplicates regional active accounts and repeated classic licenses by public product identity', () => {
    const data = payload() as { gameAccounts: Record<string, unknown>[] };
    data.gameAccounts.push({ ...data.gameAccounts[1] });
    const cells = readBattleNetTitleCells(doc())!;
    cells.modern.push({ ...cells.modern[1]! });
    cells.classic.push({ ...cells.classic[0]! });
    expect(buildBattleNetSnapshot(data, cells, date)).toHaveLength(10);
  });

  it.each(['classic-game-accounts', 'game-accounts'])(
    'never treats a missing or loading %s card as an empty complete library',
    (kind) => {
      const document = doc();
      document.querySelector(`[data-blz-addressable-by="${kind}"]`)!.remove();
      expect(readBattleNetTitleCells(document)).toBeUndefined();
      const loading = doc();
      const spinner = loading.createElement('div');
      spinner.className = 'spinner-border';
      loading.querySelector(`[data-blz-addressable-by="${kind}"]`)!.append(spinner);
      expect(readBattleNetTitleCells(loading)).toBeUndefined();
    },
  );

  it('rejects changed selectors, unknown classics, mismatched lists, and unknown account statuses', () => {
    const broken = doc();
    broken.querySelector('span.text-light')!.className = 'changed';
    expect(() => readBattleNetTitleCells(broken)).toThrow(/unsupported/u);
    const cells = readBattleNetTitleCells(doc())!;
    cells.classic[0]!.title = 'Unknown classic';
    expect(() => buildBattleNetSnapshot(payload(), cells, date)).toThrow(/unsupported/u);
    const mismatch = readBattleNetTitleCells(doc())!;
    mismatch.modern.pop();
    expect(() => buildBattleNetSnapshot(payload(), mismatch, date)).toThrow(/unsupported/u);
    const data = payload() as { gameAccounts: Record<string, unknown>[] };
    data.gameAccounts[0]!.gameAccountStatus = 'Unknown';
    expect(() => buildBattleNetSnapshot(data, readBattleNetTitleCells(doc())!, date)).toThrow(
      /unsupported/u,
    );
  });

  it('rejects identity conflicts and row overflow instead of saving a partial snapshot', () => {
    const data = payload() as { gameAccounts: Record<string, unknown>[] };
    data.gameAccounts[2]!.titleId = data.gameAccounts[1]!.titleId;
    expect(() => buildBattleNetSnapshot(data, readBattleNetTitleCells(doc())!, date)).toThrow(
      /unsupported/u,
    );
    const document = doc();
    const body = document.querySelector('[data-blz-addressable-by="classic-game-accounts"] tbody')!;
    const row = body.firstElementChild!;
    for (let i = 0; i < 2_000; i++) body.append(row.cloneNode(true));
    expect(() => readBattleNetTitleCells(document)).toThrow(/unsupported/u);
  });

  it('requests only the fixed key-free endpoint without credential extraction or redirect forwarding', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    const refs = await captureBattleNetSnapshot(doc(), fetcher);
    expect(refs).toHaveLength(10);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://account.battle.net/api/games-and-subs',
      expect.objectContaining({ credentials: 'include', redirect: 'error', cache: 'no-store' }),
    );
    const denied = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(captureBattleNetSnapshot(doc(), denied)).rejects.toThrow(/Sign in/u);
  });

  it('bounds waiting for classic licenses and rejects the whole capture on timeout', async () => {
    vi.useFakeTimers();
    const document = doc();
    document.querySelector('[data-blz-addressable-by="classic-game-accounts"]')!.remove();
    const capture = captureBattleNetSnapshot(
      document,
      vi.fn().mockResolvedValue(Response.json(payload())),
    );
    const assertion = expect(capture).rejects.toThrow(/previous library is unchanged/u);
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });
});
