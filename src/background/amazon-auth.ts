import { browser } from 'wxt/browser';
import { firefoxPermissions } from './firefox-api';
import {
  AMAZON_ORIGINS,
  AmazonCredentialSchema,
  AmazonAuthOutcomeSchema,
  AmazonPendingSchema,
  amazonCallbackCode,
  createAmazonChallenge,
  exchangeAmazonCode,
  refreshAmazonCredential,
} from '../adapters/amazon-auth';

const VAULT_KEY = 'gaming-library-helper/amazon-credential';
const PENDING_KEY = 'gaming-library-helper/amazon-auth-pending';
const OUTCOME_KEY = 'gaming-library-helper/amazon-auth-outcome';
let authQueue: Promise<unknown> = Promise.resolve();
let refreshInFlight: Promise<string> | undefined;
let startingAuth: Promise<{ started: true }> | undefined;

export async function amazonAuthStatus() {
  const [stored, pending, outcome, permitted] = await Promise.all([
    browser.storage.local.get(VAULT_KEY),
    browser.storage.session.get(PENDING_KEY),
    browser.storage.local.get(OUTCOME_KEY),
    firefoxPermissions.contains({
      origins: AMAZON_ORIGINS,
      data_collection: ['authenticationInfo'],
    }),
  ]);
  const flow = AmazonPendingSchema.safeParse(pending[PENDING_KEY]);
  const result = AmazonAuthOutcomeSchema.safeParse(outcome[OUTCOME_KEY]);
  return {
    connected: permitted && AmazonCredentialSchema.safeParse(stored[VAULT_KEY]).success,
    waiting: flow.success && flow.data.expiresAt > Date.now(),
    failed: result.success && result.data.outcome === 'failure',
  };
}

async function performStartAmazonAuth(): Promise<{ started: true }> {
  if (
    !(await firefoxPermissions.contains({
      origins: AMAZON_ORIGINS,
      data_collection: ['authenticationInfo'],
    }))
  )
    throw new Error('Amazon access is required. Use Connect from settings.');
  const vault = await browser.storage.local.get(VAULT_KEY);
  if (vault[VAULT_KEY] !== undefined && !AmazonCredentialSchema.safeParse(vault[VAULT_KEY]).success)
    throw new Error('Unsupported saved Amazon credentials. Existing data has been preserved.');
  const stored = await browser.storage.session.get(PENDING_KEY);
  const existing = AmazonPendingSchema.safeParse(stored[PENDING_KEY]);
  if (stored[PENDING_KEY] !== undefined && !existing.success)
    throw new Error('Unsupported pending Amazon sign-in. Existing data has been preserved.');
  if (existing.success && existing.data.expiresAt > Date.now()) return { started: true };
  const challenge = await createAmazonChallenge();
  const tab = await browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  if (tab.id === undefined) throw new Error('Could not open Amazon sign-in. Retry from settings.');
  const pending = AmazonPendingSchema.parse({
    version: 1,
    tabId: tab.id,
    verifier: challenge.verifier,
    state: challenge.state,
    deviceSerial: challenge.deviceSerial,
    clientId: challenge.clientId,
    expiresAt: Date.now() + 10 * 60_000,
  });
  await browser.storage.session.set({ [PENDING_KEY]: pending });
  await browser.tabs.update(tab.id, { url: challenge.url });
  return { started: true };
}

export function startAmazonAuth(): Promise<{ started: true }> {
  if (startingAuth) return startingAuth;
  startingAuth = performStartAmazonAuth().finally(() => {
    startingAuth = undefined;
  });
  return startingAuth;
}

async function finishAmazonAuth(tabId: number, rawUrl: string): Promise<void> {
  const stored = await browser.storage.session.get(PENDING_KEY);
  const parsed = AmazonPendingSchema.safeParse(stored[PENDING_KEY]);
  if (!parsed.success || parsed.data.tabId !== tabId) return;
  if (
    !(await firefoxPermissions.contains({
      origins: AMAZON_ORIGINS,
      data_collection: ['authenticationInfo'],
    }))
  ) {
    await browser.storage.session.remove(PENDING_KEY);
    await browser.tabs.update(tabId, { url: browser.runtime.getURL('/options.html') });
    return;
  }
  const code = amazonCallbackCode(parsed.data, rawUrl, Date.now());
  if (!code) return;
  await browser.storage.session.remove(PENDING_KEY);
  // Clear the sensitive callback before an extension page can be inspected.
  await browser.tabs.update(tabId, { url: browser.runtime.getURL('/options.html') });
  const credential = await exchangeAmazonCode(parsed.data, code);
  await browser.storage.local.set({
    [VAULT_KEY]: credential,
    [OUTCOME_KEY]: { version: 1, outcome: 'success' },
  });
}

export function receiveAmazonNavigation(tabId: number, rawUrl: string): void {
  const operation = authQueue.then(() => finishAmazonAuth(tabId, rawUrl));
  authQueue = operation.catch(async () => {
    await browser.storage.local
      .set({ [OUTCOME_KEY]: { version: 1, outcome: 'failure' } })
      .catch(() => undefined);
  });
}

async function performRefresh(): Promise<string> {
  if (
    !(await firefoxPermissions.contains({
      origins: AMAZON_ORIGINS,
      data_collection: ['authenticationInfo'],
    }))
  )
    throw new Error('Amazon access is required. Use Connect from settings.');
  const stored = await browser.storage.local.get(VAULT_KEY);
  const parsed = AmazonCredentialSchema.safeParse(stored[VAULT_KEY]);
  if (!parsed.success) throw new Error('Connect Amazon Games from extension settings.');
  const refreshed = await refreshAmazonCredential(parsed.data);
  await browser.storage.local.set({ [VAULT_KEY]: refreshed });
  return refreshed.accessToken;
}

export function refreshAmazonAccess(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performRefresh().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}
