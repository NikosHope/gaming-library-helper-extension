import { browser } from 'wxt/browser';
import { captureBattleNetSnapshot, BATTLENET_GAMES_URL } from '../adapters/battlenet';
import { CaptureRequestSchema } from '../core/messages';

export default defineContentScript({
  matches: ['https://account.battle.net/games'],
  runAt: 'document_idle',
  main() {
    let inFlight: Promise<unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    browser.runtime.onMessage.addListener((raw: unknown, sender) => {
      if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
        return undefined;
      if (!CaptureRequestSchema.safeParse(raw).success || location.href !== BATTLENET_GAMES_URL)
        return undefined;
      if (!inFlight) {
        inFlight = (async () => {
          const syncedAt = new Date().toISOString();
          const refs = await captureBattleNetSnapshot(document);
          return (await browser.runtime.sendMessage({
            type: 'library:replaceSnapshot',
            store: 'battlenet',
            syncedAt,
            refs,
          })) as unknown;
        })().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    });
  },
});
