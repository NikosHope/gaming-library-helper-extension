import SteamUser from 'steam-user';
import { steamPackageEvidenceCatalog } from '../../src/core/steam-package-evidence.ts';
import {
  PackageObservationSchema,
  ProductObservationSchema,
  PlatformObservationSchema,
} from '../../src/core/reconciliation-schema.ts';

function bounded(promise, milliseconds = 45_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Anonymous Valve PICS timed out')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
const idsFrom = (value) =>
  Object.values(value ?? {})
    .map(String)
    .filter((id) => /^[1-9]\d*$/u.test(id) && Number.isSafeInteger(Number(id)));
export function parsePicsApp(id, item, checkedAt) {
  const common = item?.appinfo?.common;
  if (!common || item.missingToken) return undefined;
  const sourceType = String(common.type ?? '').toLowerCase();
  const kind =
    sourceType === 'game'
      ? 'game'
      : ['dlc', 'demo', 'mod', 'beta'].includes(sourceType)
        ? 'component'
        : ['tool', 'application', 'software', 'config', 'dedicatedserver'].includes(sourceType)
          ? 'tool'
          : 'unknown';
  const title =
    typeof common.name === 'string' && common.name.trim() ? common.name.trim() : `Steam App ${id}`;
  const sourceUrl = `https://store.steampowered.com/app/${id}/`;
  const parent = String(common.parent ?? item.appinfo.extended?.dlcforappid ?? '');
  const product = ProductObservationSchema.parse({
    store: 'steam',
    storeId: String(id),
    title,
    titleStatus: common.name ? 'resolved' : 'unresolved',
    kind,
    source: 'valve-pics',
    ...(sourceType ? { sourceType } : {}),
    sourceUrl,
    checkedAt,
    ...(kind !== 'unknown'
      ? {
          classification: {
            kind,
            source: 'store-metadata',
            confidence: 'primary',
            evidenceUrls: [sourceUrl],
            ...(kind === 'component'
              ? {
                  componentType: ['dlc', 'demo', 'beta'].includes(sourceType)
                    ? sourceType
                    : 'other',
                }
              : {}),
          },
        }
      : {}),
    ...(kind === 'component' && /^[1-9]\d*$/u.test(parent) && parent !== String(id)
      ? { parentStoreId: parent }
      : {}),
  });
  const os =
    typeof common.oslist === 'string' ? common.oslist.split(',').map((value) => value.trim()) : [];
  const platform = os.length
    ? PlatformObservationSchema.parse({
        store: 'steam',
        storeId: String(id),
        windows: os.includes('windows'),
        macos: os.includes('macos'),
        linux: os.includes('linux'),
        evidenceUrl: sourceUrl,
        checkedAt,
      })
    : undefined;
  return { product, platform };
}
export function parsePicsPackage(id, item, checkedAt) {
  if (!item?.packageinfo || item.missingToken) return undefined;
  const appIds = [...new Set(idsFrom(item.packageinfo.appids))];
  if (!appIds.length) return undefined;
  return PackageObservationSchema.parse({
    packageId: String(id),
    appIds,
    source: 'valve-pics',
    complete: true,
    evidenceUrl: `https://store.steampowered.com/sub/${id}/`,
    checkedAt,
  });
}
export async function collectPics(
  products,
  extraPackages = [],
  createClient = () =>
    new SteamUser({
      protocol: SteamUser.EConnectionProtocol.WebSocket,
      dataDirectory: null,
      machineIdType: SteamUser.EMachineIDType.None,
      autoRelogin: false,
      enablePicsCache: false,
      picsCacheAll: false,
      changelistUpdateInterval: 0,
    }),
) {
  const checkedAt = new Date().toISOString();
  const seeds = steamPackageEvidenceCatalog().records;
  const ownedIds = new Set(
    products.filter((item) => item.store === 'steam').map((item) => item.storeId),
  );
  const packages = [
    ...new Set([
      ...seeds.filter((item) => ownedIds.has(item.appId)).map((item) => item.evidencePackage.id),
      ...extraPackages,
    ]),
  ];
  const apps = [
    ...new Set([
      ...ownedIds,
      ...seeds
        .filter((item) => ownedIds.has(item.appId))
        .flatMap((item) => item.associatedApps.map((app) => app.id)),
    ]),
  ];
  if (
    ![...apps, ...packages].every(
      (id) => /^[1-9]\d*$/u.test(id) && Number.isSafeInteger(Number(id)),
    )
  )
    throw new Error('PICS accepts numeric app/package IDs only');
  if (!apps.length && !packages.length)
    return { products: [], packages: [], platforms: [], issues: [] };
  const client = createClient();
  const observations = { products: [], packages: [], platforms: [], issues: [] };
  let failed;
  client.on('error', () => {
    failed = new Error('Anonymous Valve PICS disconnected');
  });
  try {
    await bounded(
      new Promise((resolve, reject) => {
        client.once('loggedOn', resolve);
        client.once('error', () => reject(new Error('Anonymous Valve PICS login failed')));
        client.logOn({ anonymous: true });
      }),
    );
    for (let offset = 0; offset < apps.length; offset += 100) {
      if (failed) throw failed;
      // inclTokens=false: no personal login, token dump, metadata access-key request or persistence.
      const response = await bounded(
        client.getProductInfo(apps.slice(offset, offset + 100).map(Number), [], false),
      );
      for (const id of apps.slice(offset, offset + 100)) {
        const parsed = parsePicsApp(id, response.apps?.[id], checkedAt);
        if (parsed) {
          observations.products.push(parsed.product);
          if (parsed.platform) observations.platforms.push(parsed.platform);
        } else if (ownedIds.has(id))
          observations.issues.push({
            store: 'steam',
            storeId: id,
            reason: 'source-unavailable',
            message: response.apps?.[id]?.missingToken
              ? 'Valve requires unavailable metadata access; product identity remains unknown'
              : 'Valve returned no public app metadata',
          });
      }
    }
    for (let offset = 0; offset < packages.length; offset += 100) {
      if (failed) throw failed;
      const response = await bounded(
        client.getProductInfo([], packages.slice(offset, offset + 100).map(Number), false),
      );
      for (const id of packages.slice(offset, offset + 100)) {
        const parsed = parsePicsPackage(id, response.packages?.[id], checkedAt);
        if (parsed) observations.packages.push(parsed);
      }
    }
    // Resolve public parents of components and newly discovered package neighbours; never add ownership.
    const neighbours = [
      ...new Set([
        ...observations.packages.flatMap((pkg) => pkg.appIds),
        ...observations.products.flatMap((item) =>
          item.parentStoreId ? [item.parentStoreId] : [],
        ),
      ]),
    ]
      .filter((id) => !apps.includes(id))
      .slice(0, 10_000);
    for (let offset = 0; offset < neighbours.length; offset += 100) {
      const response = await bounded(
        client.getProductInfo(neighbours.slice(offset, offset + 100).map(Number), [], false),
      );
      for (const id of neighbours.slice(offset, offset + 100)) {
        const parsed = parsePicsApp(id, response.apps?.[id], checkedAt);
        if (parsed) observations.products.push(parsed.product);
      }
    }
    return observations;
  } finally {
    client.logOff();
  }
}
