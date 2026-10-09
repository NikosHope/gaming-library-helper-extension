import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';

// Response/pagination contract adapted from MIT PlayniteExtensions.
// Copyright (c) 2020 Josef Nemec; see docs/licenses/playnite-extensions-MIT.txt.

const EntitlementSchema = z.object({
  id: z.string().min(1).max(500),
  state: z.string().min(1).max(100),
  product: z.object({
    id: z.string().min(1).max(500),
    title: z.string().trim().min(1).max(1_000),
    type: z.string().min(1).max(100).nullish(),
    productLine: z.string().min(1).max(100),
  }),
});
const PageSchema = z.object({
  entitlements: z.array(EntitlementSchema),
  nextToken: z.string().max(4_096).nullish(),
});
export type AmazonEntitlement = z.infer<typeof EntitlementSchema>;

async function requestAmazonPage(
  accessToken: string,
  nextToken: string | null,
  hardwareHash: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher('https://gaming.amazon.com/api/distribution/entitlements', {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Encoding': 'amz-1.0',
        'X-Amz-Target':
          'com.amazon.animusdistributionservice.entitlement.AnimusEntitlementsService.GetEntitlements',
        'x-amzn-token': accessToken,
      },
      body: JSON.stringify({
        Operation: 'GetEntitlements',
        clientId: 'Sonic',
        syncPoint: 0,
        nextToken,
        maxResults: 500,
        keyId: 'd5dc8b8b-86c8-4fc4-ae93-18c0def5314d',
        hardwareHash,
        productIdFilter: null,
        disableStateFilter: true,
      }),
    });
    if (!response.ok) throw new Error();
  } catch {
    throw new Error(
      'Amazon Games could not be read. Reconnect from settings; your saved library is unchanged.',
    );
  }
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new Error('Amazon Games returned unreadable data. Your saved library is unchanged.');
  }
  return payload;
}

/** Only the background supplies its authorized Amazon token. No caller-supplied URL/headers. */
export async function readAmazonEntitlements(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AmazonEntitlement[]> {
  const rows: AmazonEntitlement[] = [];
  const ids = new Map<string, string>();
  const cursors = new Set<string>();
  const deadline = Date.now() + 120_000;
  const hardwareHash = crypto.randomUUID().replaceAll('-', '');
  let nextToken: string | null = null;
  for (let page = 0; page < 100; page++) {
    if (Date.now() >= deadline)
      throw new Error('Amazon Games took too long. Retry; your saved library is unchanged.');
    const payload = await requestAmazonPage(accessToken, nextToken, hardwareHash, fetcher);
    const parsed = PageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.entitlements.length > 500)
      throw new Error(
        'Amazon Games returned an unsupported library. Your saved library is unchanged.',
      );
    for (const row of parsed.data.entitlements) {
      const fingerprint = JSON.stringify(row);
      if (ids.has(row.id)) {
        if (ids.get(row.id) !== fingerprint)
          throw new Error(
            'Amazon Games returned conflicting entries. Your saved library is unchanged.',
          );
        continue;
      }
      ids.set(row.id, fingerprint);
      rows.push(row);
      if (rows.length > 20_000)
        throw new Error('Amazon Games exceeded the entry limit. Your saved library is unchanged.');
    }
    nextToken = parsed.data.nextToken ?? null;
    if (!nextToken) {
      if (!rows.length)
        throw new Error(
          'Amazon Games returned an empty library. Check the account before retrying.',
        );
      return rows;
    }
    if (!parsed.data.entitlements.length || cursors.has(nextToken))
      throw new Error('Amazon Games pagination is incomplete. Your saved library is unchanged.');
    cursors.add(nextToken);
  }
  throw new Error('Amazon Games exceeded the page limit. Your saved library is unchanged.');
}

export async function captureAmazonSnapshot(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<StoreGameRef[]> {
  const importedAt = new Date().toISOString();
  const rows = await readAmazonEntitlements(accessToken, fetcher);
  const refs = new Map<string, StoreGameRef>();
  for (const row of rows) {
    if (row.product.productLine === 'Twitch:FuelEntitlement' || row.state !== 'LIVE') continue;
    if (row.product.productLine !== 'Sonic:Game')
      throw new Error(
        'Amazon Games returned an unknown product category. Your saved library is unchanged.',
      );
    const ref: StoreGameRef = {
      store: 'amazon',
      storeId: row.product.id,
      title: row.product.title,
      titleStatus: 'resolved',
      owned: true,
      ignoredAtSource: false,
      importedAt,
    };
    const prior = refs.get(ref.storeId);
    if (prior && prior.title !== ref.title)
      throw new Error(
        'Amazon Games returned conflicting product titles. Your saved library is unchanged.',
      );
    refs.set(ref.storeId, ref);
  }
  if (!refs.size)
    throw new Error('Amazon Games returned no live app games. Your saved library is unchanged.');
  return [...refs.values()].sort((a, b) => a.storeId.localeCompare(b.storeId));
}

export async function summarizeAmazonSource(rows: AmazonEntitlement[]) {
  const count = (field: (row: AmazonEntitlement) => string) => {
    const result = new Map<string, number>();
    for (const row of rows) {
      const raw = field(row);
      const key = /^[A-Za-z0-9_:#./-]{1,100}$/u.test(raw) ? raw : 'unclassified';
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return Object.fromEntries(result);
  };
  const products = [...new Set(rows.map((row) => row.product.id))].sort();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(products.join('\n')),
  );
  return {
    entries: rows.length,
    products: products.length,
    states: count((row) => row.state),
    types: count((row) => row.product.type ?? 'unspecified'),
    productLines: count((row) => row.product.productLine),
    idHash: [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(''),
  };
}

/** Reports schema/category information only, never titles, IDs, cursors, or authentication data. */
export async function diagnoseAmazonSource(accessToken: string, fetcher: typeof fetch = fetch) {
  const payload = await requestAmazonPage(
    accessToken,
    null,
    crypto.randomUUID().replaceAll('-', ''),
    fetcher,
  );
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const rows: unknown[] = Array.isArray(root.entitlements) ? root.entitlements : [];
  const parsed = PageSchema.safeParse(payload);
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const valueType = (value: unknown) =>
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const count = (reader: (row: Record<string, unknown>) => unknown) => {
    const counts = new Map<string, number>();
    for (const row of rows.slice(0, 20_000)) {
      const value = reader(object(row));
      const key =
        typeof value === 'string' && /^[A-Za-z0-9_:#./-]{1,100}$/u.test(value)
          ? value
          : 'type:' + valueType(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Object.fromEntries(counts);
  };
  const issuePaths = parsed.success
    ? []
    : [
        ...new Set(
          parsed.error.issues.map(
            (issue) =>
              issue.path.map((part) => (typeof part === 'number' ? '[]' : part)).join('.') +
              ':' +
              issue.code,
          ),
        ),
      ].slice(0, 30);
  const first = object(rows[0]);
  const product = object(first.product);
  return {
    schemaAccepted: parsed.success,
    entitlementsArray: Array.isArray(root.entitlements),
    pageEntries: rows.length,
    nextTokenPresent: Object.hasOwn(root, 'nextToken'),
    nextTokenType: valueType(root.nextToken),
    issues: issuePaths,
    fieldTypes: {
      id: valueType(first.id),
      state: valueType(first.state),
      productId: valueType(product.id),
      title: valueType(product.title),
      type: valueType(product.type),
      productLine: valueType(product.productLine),
    },
    states: count((row) => row.state),
    types: count((row) => object(row.product).type),
    productLines: count((row) => object(row.product).productLine),
  };
}
