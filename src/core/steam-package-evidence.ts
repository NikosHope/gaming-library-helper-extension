import { z } from 'zod/v3';
import type { LibraryState, StoreGameRef } from './schema';
import { refKind } from './products';

const IdSchema = z.string().regex(/^[1-9]\d*$/u);
const AppSchema = z
  .object({
    entity: z.literal('app'),
    id: IdSchema,
    title: z.string().min(1),
    type: z.enum(['game', 'dlc']),
  })
  .strict();
const PackageSchema = z
  .object({ entity: z.literal('package'), id: IdSchema, title: z.string().min(1) })
  .strict();
const RecordSchema = z
  .object({
    appId: IdSchema,
    sourceName: z.string().min(1),
    sourceType: z.literal('unknown'),
    classification: z.literal('unresolved'),
    relationshipType: z.literal('shared_package_with'),
    associatedApps: z.array(AppSchema).min(1),
    evidencePackage: PackageSchema,
    parentAppId: z.null(),
    source: z.literal('steamdb'),
    confidence: z.literal('community'),
    checkedAt: z.string().date(),
    retrieval: z.literal('public-page-snapshot'),
    evidenceUrl: z.string().url(),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((record, context) => {
    const expected = `https://steamdb.info/sub/${record.evidencePackage.id}/`;
    if (![expected, `${expected}info/`].includes(record.evidenceUrl))
      context.addIssue({
        code: 'custom',
        message: 'Package evidence URL must match its namespaced ID',
      });
    if (record.sourceName !== `SteamDB Unknown App ${record.appId}`)
      context.addIssue({
        code: 'custom',
        message: 'Unknown source label must preserve its app ID',
      });
    const ids = record.associatedApps.map((app) => app.id);
    if (ids.includes(record.appId) || new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        message: 'Association cannot rename itself or repeat an app ID',
      });
  });
export const SteamPackageEvidenceCatalogSchema = z
  .object({
    version: z.literal(1),
    records: z
      .array(RecordSchema)
      .refine(
        (records) => new Set(records.map((record) => record.appId)).size === records.length,
        'Duplicate unknown app IDs',
      ),
  })
  .strict();
export type SteamPackageEvidence = z.infer<typeof RecordSchema>;

function app(id: number, title: string, type: 'game' | 'dlc' = 'dlc'): z.infer<typeof AppSchema> {
  return { entity: 'app', id: String(id), title, type };
}
function shared(
  ids: number[],
  packageId: number,
  title: string,
  apps: z.infer<typeof AppSchema>[],
  indexed = false,
): SteamPackageEvidence[] {
  return ids.map((id) => ({
    appId: String(id),
    sourceName: `SteamDB Unknown App ${id}`,
    sourceType: 'unknown',
    classification: 'unresolved',
    relationshipType: 'shared_package_with',
    associatedApps: apps,
    evidencePackage: { entity: 'package', id: String(packageId), title },
    parentAppId: null,
    source: 'steamdb',
    confidence: 'community',
    checkedAt: '2026-10-09',
    retrieval: 'public-page-snapshot',
    evidenceUrl: `https://steamdb.info/sub/${packageId}/${indexed ? 'info/' : ''}`,
    notes: `Public package co-membership only. Own title, purpose and parent remain unknown.${indexed ? ' The retrieved page was indexed earlier; membership may be stale.' : ''}`,
  }));
}
// Public facts verified against the user's report and SteamDB package pages, not an owned-library seed.
// Keep observations separate from classifications; later app metadata must not erase this history.
const catalog = SteamPackageEvidenceCatalogSchema.parse({
  version: 1,
  records: [
    ...shared([479950], 15726, 'Magicka: Aspiring Musician Robes', [
      app(73096, 'Magicka: Aspiring Musician Robes'),
    ]),
    ...shared([480010], 8484, 'Magicka: Final Frontier', [app(73035, 'Magicka: Final Frontier')]),
    ...shared([480030], 8489, 'Magicka: Frozen Lake', [app(73037, 'Magicka: Frozen Lake')]),
    ...shared([480060], 11587, 'Magicka: Gamer Bundle', [app(73057, 'Magicka: Gamer Bundle')]),
    ...shared([480080], 15728, 'Magicka: Heirlooms Item Pack', [
      app(73098, 'Magicka: Heirlooms Item Pack'),
    ]),
    ...shared([480100], 12434, 'Magicka: Holiday Spirit Item Pack', [
      app(73091, 'Magicka: Holiday Spirit Item Pack'),
    ]),
    ...shared([480110], 12435, 'Magicka: Horror Props Item Pack', [
      app(73092, 'Magicka: Horror Props Item Pack'),
    ]),
    ...shared([480130], 7974, 'Magicka: Marshlands', [app(73033, 'Magicka: Marshlands')]),
    ...shared([480150], 15725, 'Magicka: Mega Villain Robes', [
      app(73095, 'Magicka: Mega Villain Robes'),
    ]),
    ...shared([480200], 8491, 'Magicka: Party Robes', [
      app(73054, 'Magicka: Party Robes'),
      app(73055, 'Magicka: Tank Robe'),
      app(73056, 'Magicka: Support Robe'),
      app(813830, 'Magicka: Party Robes DLC'),
    ]),
    ...shared([480210], 15727, 'Magicka: Peculiar Gadgets Item Pack', [
      app(73097, 'Magicka: Peculiar Gadgets Item Pack'),
    ]),
    ...shared([480250], 15099, 'Magicka: The Other Side of the Coin', [
      app(73093, 'Magicka: The Other Side of the Coin'),
      app(73094, 'Magicka: Pieces Challengepack Evil hideouts'),
      app(73099, 'Mirror Crystal Cavern Hideout'),
      app(73110, 'Volcano Hideout'),
    ]),
    ...shared([480270], 12433, 'Magicka: The Stars Are Left', [
      app(73058, 'Magicka: The Stars Are Left'),
    ]),
    ...shared([480280], 8486, 'Magicka: The Watchtower', [app(73036, 'Magicka: The Watchtower')]),
    ...shared([480310], 7815, 'Magicka: Vietnam', [app(42918, 'Magicka: Vietnam')]),
    ...shared([478730], 28173, 'Knights of Pen and Paper', [
      app(231740, 'Knights of Pen and Paper +1 Edition', 'game'),
    ]),
    ...shared([481050], 12566, 'Magicka: Wizard Wars Base Game', [
      app(202090, 'Magicka: Wizard Wars', 'game'),
    ]),
    ...shared([484710], 14284, 'Warlock Master of the Arcane', [
      app(203630, 'Warlock - Master of the Arcane', 'game'),
    ]),
    ...shared([550502], 133810, 'Tyranny - Standard Edition', [
      app(362960, 'Tyranny', 'game'),
      app(546190, 'Tyranny - Ringtones'),
    ]),
    ...shared([830670], 220633, 'Pillars of Eternity - Definitive Edition', [
      app(291650, 'Pillars of Eternity', 'game'),
    ]),
    ...shared([849500], 258527, 'Pillars of Eternity II: Deadfire - Obsidian Edition', [
      app(560130, 'Pillars of Eternity II: Deadfire', 'game'),
    ]),
    ...shared(
      [3575130, 3575340],
      12072,
      'L.A. Noire Complete Edition',
      [app(110800, 'L.A. Noire', 'game'), app(110810, 'L.A. Noire: DLC Bundle')],
      true,
    ),
    ...shared([3575160], 817628, 'Grand Theft Auto: The Trilogy - The Definitive Edition', [
      app(1546970, 'Grand Theft Auto III - The Definitive Edition', 'game'),
      app(1546990, 'Grand Theft Auto: Vice City - The Definitive Edition', 'game'),
      app(1547000, 'Grand Theft Auto: San Andreas - The Definitive Edition', 'game'),
    ]),
  ],
});

/** Public observations only. This catalog cannot create ownership or mutate source classifications. */
export function steamPackageEvidenceCatalog() {
  return structuredClone(catalog);
}
export function steamPackageEvidenceForRef(
  ref: Pick<StoreGameRef, 'store' | 'storeId'>,
): SteamPackageEvidence | undefined {
  if (ref.store !== 'steam') return undefined;
  const record = catalog.records.find((record) => record.appId === ref.storeId);
  return record ? structuredClone(record) : undefined;
}
export function unknownSteamProducts(state: LibraryState, query = '') {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return state.games
    .flatMap((game) => {
      const ref = game.storeRefs.steam;
      if (!ref || refKind(ref) !== 'unknown') return [];
      const evidence = steamPackageEvidenceForRef(ref);
      const row = {
        canonicalId: game.id,
        appId: ref.storeId,
        providerTitle: ref.title,
        titleStatus: ref.titleStatus,
        classification: 'unknown' as const,
        evidence,
      };
      const searchable = [
        row.providerTitle,
        row.appId,
        evidence?.sourceName,
        evidence?.evidencePackage.id,
        evidence?.evidencePackage.title,
        ...(evidence?.associatedApps.map((app) => `${app.id} ${app.title}`) ?? []),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery) ? [row] : [];
    })
    .sort((a, b) => Number(a.appId) - Number(b.appId));
}
