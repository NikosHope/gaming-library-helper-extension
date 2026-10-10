import { browser } from 'wxt/browser';
import { applyAcceptedResult, contentHash, createInputSnapshot } from '../core/reconciliation';
import { AcceptedResultSchema } from '../core/reconciliation-schema';
import {
  BridgeStatusSchema,
  NativeResponseSchema,
  NativeRequestSchema,
  NATIVE_HOST,
  CHUNK_CHARACTERS,
  MAX_EXCHANGE_BYTES,
  type BridgeStatus,
  type NativeRequest,
  type NativeResponse,
} from '../core/native-protocol';
import { loadState, updateState } from '../core/storage';

const KEY = 'gaming-library-helper/reconciliation';
export const RECONCILIATION_ALARM = 'gaming-library-helper/reconciliation';
let queue: Promise<unknown> = Promise.resolve();
let statusQueue: Promise<unknown> = Promise.resolve();
let activeClient: ReturnType<typeof nativeClient> | undefined;
export async function bridgeStatus(): Promise<BridgeStatus> {
  const stored = await browser.storage.local.get(KEY);
  return BridgeStatusSchema.parse(stored[KEY] ?? { version: 1 });
}
function saveStatus(status: BridgeStatus, changeControl = false): Promise<BridgeStatus> {
  const operation = statusQueue.then(async () => {
    const current = await bridgeStatus();
    if (!changeControl && !current.enabled) return current;
    const parsed = BridgeStatusSchema.parse(
      changeControl
        ? { ...current, enabled: status.enabled, outcome: status.outcome }
        : { ...current, ...status, enabled: current.enabled },
    );
    await browser.storage.local.set({ [KEY]: parsed });
    return parsed;
  });
  statusQueue = operation.catch(() => undefined);
  return operation;
}
export async function configureBridge(enabled: boolean): Promise<BridgeStatus> {
  if (enabled && !(await browser.permissions.contains({ permissions: ['nativeMessaging'] })))
    throw new Error('Allow Native Messaging using Connect in settings');
  const current = await bridgeStatus();
  await saveStatus({ ...current, enabled, outcome: enabled ? 'waiting' : 'disabled' }, true);
  if (!enabled) activeClient?.close();
  await restoreBridgeAlarm();
  return enabled ? refreshBridge() : bridgeStatus();
}
export async function restoreBridgeAlarm(): Promise<void> {
  const status = await bridgeStatus();
  if (status.enabled) await browser.alarms.create(RECONCILIATION_ALARM, { periodInMinutes: 15 });
  else await browser.alarms.clear(RECONCILIATION_ALARM);
}
export interface NativePort {
  postMessage(message: NativeRequest): void;
  disconnect(this: void): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}
export function nativeClient(
  port: NativePort,
  timeout = 50_000,
): { request: (message: NativeRequest) => Promise<NativeResponse>; close: () => void } {
  let pending:
    | {
        resolve: (value: NativeResponse) => void;
        reject: (reason: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let disconnected = false;
  let closed = false;
  const onMessage = (raw: unknown) => {
    if (!pending) return;
    const active = pending;
    pending = undefined;
    clearTimeout(active.timer);
    const response = NativeResponseSchema.safeParse(raw);
    if (response.success) active.resolve(response.data);
    else active.reject(new Error('Invalid native response'));
  };
  const onDisconnect = () => {
    disconnected = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Local runner unavailable'));
      pending = undefined;
    }
  };
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  return {
    request: (message) =>
      new Promise((resolve, reject) => {
        if (disconnected || pending) {
          reject(new Error('Native connection unavailable or busy'));
          return;
        }
        pending = {
          resolve,
          reject,
          timer: setTimeout(() => {
            pending = undefined;
            reject(new Error('Local runner timed out'));
          }, timeout),
        };
        try {
          port.postMessage(NativeRequestSchema.parse(message));
        } catch {
          clearTimeout(pending.timer);
          pending = undefined;
          reject(new Error('Native message failed'));
        }
      }),
    close: () => {
      if (closed) return;
      closed = true;
      onDisconnect();
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      port.disconnect();
    },
  };
}
async function refresh(): Promise<BridgeStatus> {
  const status = await bridgeStatus();
  if (!status.enabled) return status;
  const attempted: BridgeStatus = { ...status, lastAttemptAt: new Date().toISOString() };
  if (!(await browser.permissions.contains({ permissions: ['nativeMessaging'] })))
    return saveStatus({ ...attempted, outcome: 'unavailable' });
  let client: ReturnType<typeof nativeClient> | undefined;
  try {
    client = nativeClient(browser.runtime.connectNative(NATIVE_HOST));
    activeClient = client;
    const snapshot = await createInputSnapshot(await loadState());
    const json = JSON.stringify(snapshot);
    if (new TextEncoder().encode(json).byteLength > MAX_EXCHANGE_BYTES)
      throw new Error('Snapshot too large');
    const begin = await client.request({
      op: 'publish:begin',
      inputHash: snapshot.inputHash,
      characters: json.length,
    });
    if (begin.status !== 'ok') throw new Error('Snapshot rejected');
    if (begin.changed !== false) {
      for (let offset = 0; offset < json.length; offset += CHUNK_CHARACTERS) {
        if (
          (
            await client.request({
              op: 'publish:chunk',
              offset,
              data: json.slice(offset, offset + CHUNK_CHARACTERS),
            })
          ).status !== 'ok'
        )
          throw new Error('Snapshot chunk rejected');
      }
      if ((await client.request({ op: 'publish:commit' })).status !== 'ok')
        throw new Error('Snapshot rejected');
    }
    attempted.publishedHash = snapshot.inputHash;
    let text = '';
    let hash: string | undefined;
    let total: number | undefined;
    do {
      const response = await client.request({
        op: 'result:read',
        inputHash: snapshot.inputHash,
        offset: text.length,
      });
      if (response.status === 'waiting') return saveStatus({ ...attempted, outcome: 'waiting' });
      if (response.status === 'error' && response.code === 'stale-input')
        return saveStatus({ ...attempted, outcome: 'stale' });
      if (
        response.status !== 'chunk' ||
        response.offset !== text.length ||
        (hash && hash !== response.hash) ||
        (total !== undefined && total !== response.total) ||
        !response.data.length ||
        response.total > MAX_EXCHANGE_BYTES
      )
        return saveStatus({ ...attempted, outcome: 'invalid-result' });
      hash = response.hash;
      total = response.total;
      text += response.data;
      if (text.length > total || new TextEncoder().encode(text).byteLength > MAX_EXCHANGE_BYTES)
        return saveStatus({ ...attempted, outcome: 'invalid-result' });
    } while (text.length < total);
    const result = AcceptedResultSchema.parse(JSON.parse(text) as unknown);
    if (hash !== (await contentHash(result)))
      return saveStatus({ ...attempted, outcome: 'invalid-result' });
    const current = await loadState();
    if ((await createInputSnapshot(current)).inputHash !== result.inputHash)
      return saveStatus({ ...attempted, outcome: 'stale' });
    if (
      hash !== attempted.importedHash ||
      (await contentHash(current.registry)) !== (await contentHash(result.registry))
    ) {
      // updateState re-reads inside its queue; a new connector snapshot cannot race this patch.
      await updateState(async (current) => {
        const next = await applyAcceptedResult(current, result);
        if (!(await bridgeStatus()).enabled) throw new Error('Bridge disabled');
        return next;
      });
      attempted.importedHash = hash;
      attempted.lastImportAt = new Date().toISOString();
    }
    return saveStatus({ ...attempted, outcome: 'connected' });
  } catch {
    return saveStatus({ ...attempted, outcome: 'unavailable' });
  } finally {
    client?.close();
    activeClient = undefined;
  }
}
export function refreshBridge(): Promise<BridgeStatus> {
  const operation = queue.then(refresh);
  queue = operation.catch(() => undefined);
  return operation;
}
export async function approveBridgeReview(
  proposalId: string,
  independence: boolean,
): Promise<BridgeStatus> {
  const status = await bridgeStatus();
  if (
    !status.enabled ||
    !(await browser.permissions.contains({ permissions: ['nativeMessaging'] }))
  )
    throw new Error('Connect the local runner first');
  const client = nativeClient(browser.runtime.connectNative(NATIVE_HOST));
  try {
    const input = await createInputSnapshot(await loadState());
    if (
      (
        await client.request({
          op: 'review:approve',
          inputHash: input.inputHash,
          proposalId,
          independence,
        })
      ).status !== 'ok'
    )
      throw new Error('Review could not be rechecked. Run collect and retry');
  } finally {
    client.close();
  }
  return bridgeStatus();
}
