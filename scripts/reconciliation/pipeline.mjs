import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  RegistrySchema,
  CollectedSchema,
  ProposalFileSchema,
  ReviewReceiptSchema,
  AcceptedResultSchema,
} from '../../src/core/reconciliation-schema.ts';
import {
  acceptedResult,
  catalogKey,
  productKey,
  validateRegistry,
  classifyFootprints,
  projectFootprints,
} from '../../src/core/reconciliation.ts';
import {
  currentInput,
  assertCurrent,
  atomicWrite,
  readJson,
  privateRoot,
  withLock,
} from './io.mjs';
import { collectPics } from './pics.mjs';
import { steamPackageEvidenceCatalog } from '../../src/core/steam-package-evidence.ts';
import { createCatalogs } from './catalogs.mjs';

const missingIdentity = (error) => error?.status === 404 || error?.status === 'ID not found';
function missingIssue(registry, products, message = 'Catalog identity no longer exists') {
  for (const product of products)
    registry.issues.push({
      store: product.store,
      storeId: product.storeId,
      reason: 'catalog-not-found',
      message,
      ...(product.catalog ? { provider: product.catalog.provider, catalog: product.catalog } : {}),
    });
}

const putRecord = (registry, record) => {
  registry.records = registry.records.filter(
    (item) => catalogKey(item.identity) !== catalogKey(record.identity),
  );
  registry.records.push(record);
};
function attachExact(registry, record, products) {
  putRecord(registry, record);
  for (const product of products) {
    const external = record.externalRefs.find((ref) => productKey(ref) === productKey(product));
    if (
      !external ||
      registry.matches.some(
        (match) =>
          productKey(match) === productKey(product) &&
          catalogKey(match.catalog) === catalogKey(record.identity),
      )
    )
      continue;
    registry.matches.push({
      store: product.store,
      storeId: product.storeId,
      catalog: record.identity,
      method: external.url ? 'store-url' : 'external-id',
      evidenceUrls: [record.url, ...(external.url ? [external.url] : [])],
      verifiedAt: record.checkedAt,
    });
  }
}
async function parents(registry, catalogs, fresh = false, verified = new Set()) {
  const missing = new Set();
  for (let depth = 0; depth < 12; depth++) {
    const ids = [
      ...new Map(
        registry.records
          .flatMap((record) => [record.versionParent, record.parent].filter(Boolean))
          .filter(
            (identity) =>
              !missing.has(catalogKey(identity)) &&
              !verified.has(catalogKey(identity)) &&
              (fresh ||
                !registry.records.some(
                  (record) => catalogKey(record.identity) === catalogKey(identity),
                )),
          )
          .map((id) => [catalogKey(id), id]),
      ).values(),
    ];
    if (!ids.length) {
      // An explicit absent parent invalidates its descendants, including existing cached records.
      for (let pass = 0; pass < registry.records.length + 1; pass++) {
        const dependent = registry.records.filter(
          (record) =>
            [record.parent, record.versionParent].some((id) => id && missing.has(catalogKey(id))) &&
            !missing.has(catalogKey(record.identity)),
        );
        if (!dependent.length) break;
        for (const record of dependent) missing.add(catalogKey(record.identity));
      }
      const discarded = registry.matches.filter((match) => missing.has(catalogKey(match.catalog)));
      missingIssue(
        registry,
        discarded,
        'Catalog parent identity is absent; relationship remains Unknown',
      );
      registry.matches = registry.matches.filter(
        (match) => !missing.has(catalogKey(match.catalog)),
      );
      registry.records = registry.records.filter(
        (record) => !missing.has(catalogKey(record.identity)),
      );
      return;
    }
    for (const identity of ids) {
      try {
        putRecord(registry, await catalogs.get(identity, fresh));
        verified.add(catalogKey(identity));
      } catch (error) {
        if (!missingIdentity(error)) throw error;
        missing.add(catalogKey(identity));
      }
    }
  }
  throw new Error('Catalog relationship depth exceeded');
}
function effectiveProducts(input, registry) {
  const index = new Map(input.products.map((item) => [productKey(item), item]));
  for (const observed of registry.products) {
    const original = index.get(productKey(observed));
    index.set(
      productKey(observed),
      original
        ? {
            ...original,
            ...(original.titleStatus === 'unresolved'
              ? { title: observed.title, titleStatus: observed.titleStatus }
              : {}),
            ...(original.kind === 'unknown' || !original.classification
              ? { kind: observed.kind, classification: observed.classification }
              : {}),
          }
        : observed,
    );
  }
  return [...index.values()];
}
function sourceIssue(registry, products, message, provider) {
  for (const product of products)
    registry.issues.push({
      store: product.store,
      storeId: product.storeId,
      reason: 'source-unavailable',
      message,
      ...(product.catalog
        ? { provider: product.catalog.provider, catalog: product.catalog }
        : provider
          ? { provider }
          : {}),
    });
}
export async function collect({
  root = privateRoot,
  packages = [],
  pics = collectPics,
  catalogsFactory = createCatalogs,
  progress = () => undefined,
} = {}) {
  return withLock(root, 'runner', async () => {
    const input = await currentInput(root);
    const registry = RegistrySchema.parse({ version: 1 });
    progress({ phase: 'pics', products: input.products.length });
    try {
      Object.assign(registry, await pics(input.products, packages));
    } catch {
      sourceIssue(
        registry,
        input.products.filter((item) => item.store === 'steam'),
        'Anonymous Valve PICS unavailable; previous accepted registry is preserved until validation',
        'valve',
      );
    }
    const seeds = steamPackageEvidenceCatalog().records;
    for (const seed of seeds.filter((item) =>
      input.products.some((product) => product.store === 'steam' && product.storeId === item.appId),
    )) {
      if (registry.packages.some((pkg) => pkg.packageId === seed.evidencePackage.id)) continue;
      const related = seeds.filter((item) => item.evidencePackage.id === seed.evidencePackage.id);
      registry.packages.push({
        packageId: seed.evidencePackage.id,
        appIds: [
          ...new Set(
            related.flatMap((item) => [item.appId, ...item.associatedApps.map((app) => app.id)]),
          ),
        ],
        source: 'manual-observation',
        complete: false,
        evidenceUrl: seed.evidenceUrl,
        checkedAt: `${seed.checkedAt}T00:00:00.000Z`,
      });
    }
    const products = effectiveProducts(input, registry);
    const catalogs = await catalogsFactory(products);
    const previous = await readJson(join(root, 'result.json'), true);
    // Reuse human choices as choices, never as an unverified catalog response. They are re-fetched below.
    if (previous)
      for (const review of AcceptedResultSchema.parse(previous).registry.reviews) {
        if (input.products.some((item) => productKey(item) === productKey(review)))
          registry.reviews.push({ ...review, inputHash: input.inputHash });
      }
    const previousMatches = previous
      ? AcceptedResultSchema.parse(previous).registry.matches.filter((match) =>
          input.products.some((item) => productKey(item) === productKey(match)),
        )
      : [];
    for (const provider of ['igdb', 'rawg']) {
      progress({ phase: provider, configured: catalogs.configured[provider] });
      if (!catalogs.configured[provider]) {
        for (const product of input.products)
          registry.issues.push({
            store: product.store,
            storeId: product.storeId,
            reason: 'catalog-not-configured',
            provider,
            message: `${provider.toUpperCase()} credential is not configured in macOS Keychain`,
          });
        continue;
      }
      if (provider === 'igdb') {
        try {
          for (const record of await catalogs.exactSteam(
            products.filter((item) => item.store === 'steam').map((item) => item.storeId),
          ))
            attachExact(registry, record, products);
        } catch {
          sourceIssue(registry, input.products, 'IGDB exact Steam lookup unavailable', 'igdb');
        }
      }
      for (const match of previousMatches.filter(
        (item) => item.catalog.provider === provider && item.method !== 'human-review',
      )) {
        try {
          const record = await catalogs.get(match.catalog);
          attachExact(registry, record, products);
          if (!record.externalRefs.some((ref) => productKey(ref) === productKey(match)))
            registry.issues.push({
              store: match.store,
              storeId: match.storeId,
              provider,
              catalog: match.catalog,
              reason: 'conflicting-evidence',
              evidenceType: 'exact-link-changed',
              message: 'Previously accepted catalog no longer confirms this exact store ID/URL',
            });
        } catch (error) {
          if (missingIdentity(error)) missingIssue(registry, [match]);
          else
            sourceIssue(
              registry,
              [match],
              'Previously verified catalog identity is temporarily unavailable',
            );
        }
      }
      for (const review of registry.reviews.filter((item) => item.catalog.provider === provider)) {
        try {
          const record = await catalogs.get(review.catalog);
          applyIndependence(record, review);
          putRecord(registry, record);
          registry.matches.push({
            store: review.store,
            storeId: review.storeId,
            catalog: review.catalog,
            method: 'human-review',
            evidenceUrls: review.evidenceUrls,
            reviewId: review.reviewId,
            verifiedAt: record.checkedAt,
          });
        } catch (error) {
          if (missingIdentity(error)) missingIssue(registry, [review]);
          else
            sourceIssue(
              registry,
              [review],
              `${provider.toUpperCase()} cannot recheck a previously reviewed ID`,
            );
        }
      }
      const unresolved = products.filter(
        (item) =>
          !registry.matches.some((match) => productKey(match) === productKey(item)) &&
          !['tool', 'auxiliary'].includes(item.kind),
      );
      let count = 0;
      for (const product of unresolved) {
        try {
          const candidates = await catalogs.search(product, provider);
          for (const proposal of candidates) {
            registry.proposals.push(proposal);
            // A search result stays a proposal unless its fetched record proves an exact external ID/URL.
            const record = await catalogs.get(proposal.candidate);
            attachExact(registry, record, products);
            if (record.externalRefs.some((ref) => productKey(ref) === productKey(product)))
              registry.proposals = registry.proposals.filter((item) => item.id !== proposal.id);
            else
              registry.candidateChecks.push({
                proposalId: proposal.id,
                outcome: 'exists',
                checkedAt: record.checkedAt,
              });
          }
        } catch {
          sourceIssue(
            registry,
            [product],
            `${provider.toUpperCase()} candidate lookup or store links unavailable`,
            provider,
          );
        }
        if (++count % 25 === 0) {
          progress({ phase: provider, checked: count, remaining: unresolved.length - count });
          await atomicWrite(join(root, 'collected-progress.json'), {
            version: 1,
            inputHash: input.inputHash,
            createdAt: new Date().toISOString(),
            registry,
          });
        }
      }
    }
    // Missing parent metadata makes the dependent match Unknown, not a fabricated edition merge.
    try {
      await parents(registry, catalogs);
    } catch {
      const missing = registry.records.filter((record) =>
        [record.parent, record.versionParent].some(
          (id) =>
            id && !registry.records.some((item) => catalogKey(item.identity) === catalogKey(id)),
        ),
      );
      for (const record of missing) {
        sourceIssue(
          registry,
          registry.matches.filter(
            (match) => catalogKey(match.catalog) === catalogKey(record.identity),
          ),
          'Catalog parent unavailable; relationship cannot be accepted',
        );
        registry.matches = registry.matches.filter(
          (match) => catalogKey(match.catalog) !== catalogKey(record.identity),
        );
        registry.records = registry.records.filter(
          (item) => catalogKey(item.identity) !== catalogKey(record.identity),
        );
      }
    }
    for (const product of input.products)
      if (!registry.matches.some((match) => productKey(match) === productKey(product)))
        registry.issues.push({
          store: product.store,
          storeId: product.storeId,
          reason: registry.proposals.some((item) => productKey(item) === productKey(product))
            ? 'catalog-candidates'
            : 'catalog-not-confirmed',
          message: 'No verified catalog identity; review candidates and original store ID',
        });
    const collected = CollectedSchema.parse({
      version: 1,
      inputHash: input.inputHash,
      createdAt: new Date().toISOString(),
      registry,
    });
    await assertCurrent(input.inputHash, root);
    await atomicWrite(join(root, 'collected.json'), collected);
    await atomicWrite(join(root, 'proposals.json'), {
      version: 1,
      inputHash: input.inputHash,
      proposals: registry.proposals,
    });
    await writeReview(input, registry, root);
    return {
      inputHash: input.inputHash,
      products: input.products.length,
      matches: registry.matches.length,
      proposals: registry.proposals.length,
      issues: registry.issues.length,
    };
  });
}
function applyIndependence(record, receipt) {
  if (!receipt.dependency) return;
  if (!receipt.kind || !receipt.evidenceUrls.length)
    throw new Error('Human launch-requirement evidence is missing');
  if (!['unknown', 'mod', 'game', 'standalone-expansion'].includes(record.kind))
    throw new Error('Human launch review cannot overwrite a component/edition/remake relationship');
  record.kind = receipt.kind;
  record.dependency = receipt.dependency;
  record.independenceEvidence = receipt.evidenceUrls;
}
export async function validate({
  root = privateRoot,
  proposalsPath,
  catalogsFactory = createCatalogs,
} = {}) {
  return withLock(root, 'runner', async () => {
    const input = await currentInput(root);
    const collected = CollectedSchema.parse(await readJson(join(root, 'collected.json')));
    if (collected.inputHash !== input.inputHash)
      throw new Error('Collected metadata is stale; collect again');
    const registry = collected.registry;
    const previous = await readJson(join(root, 'result.json'), true);
    if (previous) {
      const previousResult = AcceptedResultSchema.parse(previous);
      const missing = previousResult.registry.matches.filter(
        (match) =>
          input.products.some((item) => productKey(item) === productKey(match)) &&
          !registry.matches.some(
            (next) =>
              productKey(next) === productKey(match) &&
              catalogKey(next.catalog) === catalogKey(match.catalog),
          ),
      );
      if (
        missing.some(
          (match) =>
            registry.issues.some(
              (issue) =>
                productKey(issue) === productKey(match) &&
                (!issue.provider || issue.provider === match.catalog.provider) &&
                ['source-unavailable', 'catalog-not-configured'].includes(issue.reason),
            ) &&
            !registry.issues.some(
              (issue) =>
                productKey(issue) === productKey(match) &&
                issue.catalog &&
                catalogKey(issue.catalog) === catalogKey(match.catalog) &&
                ['catalog-not-found', 'conflicting-evidence'].includes(issue.reason),
            ),
        )
      )
        throw new Error(
          'Catalog outage prevents rechecking a previously accepted identity. Last accepted registry is unchanged',
        );
    }
    if (proposalsPath) {
      const additions = ProposalFileSchema.parse(await readJson(proposalsPath));
      if (additions.inputHash !== input.inputHash)
        throw new Error('LLM proposals belong to another snapshot');
      for (const proposal of additions.proposals) {
        if (!input.products.some((item) => productKey(item) === productKey(proposal)))
          throw new Error('Proposal has no owned footprint');
        const existing = registry.proposals.find((item) => item.id === proposal.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(proposal))
          throw new Error('Proposal ID cannot be reused for different evidence');
        if (!existing) registry.proposals.push(proposal);
      }
    }
    const catalogs = await catalogsFactory(effectiveProducts(input, registry));
    const verified = new Map();
    const accepted = [];
    for (const match of registry.matches) {
      let record = verified.get(catalogKey(match.catalog));
      try {
        if (!record) {
          record = await catalogs.get(match.catalog, true);
          verified.set(catalogKey(match.catalog), record);
        }
      } catch (error) {
        if (missingIdentity(error)) {
          missingIssue(registry, [match]);
          registry.records = registry.records.filter(
            (item) => catalogKey(item.identity) !== catalogKey(match.catalog),
          );
          continue;
        }
        throw new Error(
          'Catalog ID or relationship could not be revalidated. Last accepted registry is unchanged',
          { cause: error },
        );
      }
      putRecord(registry, record);
      if (
        match.method !== 'human-review' &&
        !record.externalRefs.some((ref) => productKey(ref) === productKey(match))
      ) {
        registry.issues.push({
          store: match.store,
          storeId: match.storeId,
          reason: 'conflicting-evidence',
          provider: match.catalog.provider,
          catalog: match.catalog,
          evidenceType: 'exact-link-changed',
          message: 'Previously accepted catalog no longer confirms this exact store ID/URL',
        });
        continue;
      }
      if (match.method === 'human-review') {
        const receipt = registry.reviews.find((item) => item.reviewId === match.reviewId);
        if (!receipt || receipt.inputHash !== input.inputHash)
          throw new Error('Review ledger mismatch');
        applyIndependence(record, receipt);
      }
      accepted.push({ ...match, verifiedAt: record.checkedAt });
    }
    registry.matches = accepted;
    const candidateRecords = new Map();
    registry.candidateChecks = [];
    for (const proposal of registry.proposals) {
      try {
        let record =
          verified.get(catalogKey(proposal.candidate)) ??
          candidateRecords.get(catalogKey(proposal.candidate));
        if (!record) {
          record = await catalogs.get(proposal.candidate, true);
          candidateRecords.set(catalogKey(proposal.candidate), record);
        }
        putRecord(registry, record);
        registry.candidateChecks.push({
          proposalId: proposal.id,
          outcome: 'exists',
          checkedAt: record.checkedAt,
        });
      } catch (error) {
        registry.candidateChecks.push({
          proposalId: proposal.id,
          outcome:
            error.status === 404 || error.status === 'ID not found' ? 'missing' : 'unavailable',
          checkedAt: new Date().toISOString(),
        });
      }
    }
    await parents(
      registry,
      catalogs,
      true,
      new Set([...verified.keys(), ...candidateRecords.keys()]),
    );
    validateRegistry(registry);
    await assertCurrent(input.inputHash, root);
    const result = acceptedResult(input, registry);
    // Keep snapshot publication and this final freshness check in one critical section.
    await withLock(root, 'snapshot', async () => {
      await assertCurrent(input.inputHash, root);
      await atomicWrite(join(root, 'result.json'), result);
    });
    await atomicWrite(join(root, 'collected.json'), { ...collected, registry });
    await atomicWrite(join(root, 'proposals.json'), {
      version: 1,
      inputHash: input.inputHash,
      proposals: registry.proposals,
    });
    return writeReview(input, registry, root);
  });
}
export async function approve(
  proposalId,
  {
    root = privateRoot,
    human = false,
    independence = false,
    expectedInputHash,
    catalogsFactory = createCatalogs,
  } = {},
) {
  if (!human)
    throw new Error(
      'Approval requires a separate explicit human decision; LLM proposal flags are not confirmation',
    );
  return withLock(root, 'runner', async () => {
    const input = await currentInput(root);
    if (expectedInputHash !== undefined && input.inputHash !== expectedInputHash)
      throw new Error('Review is stale; publish and review the current Firefox snapshot');
    const collected = CollectedSchema.parse(await readJson(join(root, 'collected.json')));
    if (collected.inputHash !== input.inputHash) throw new Error('Review is stale; collect again');
    const proposal = collected.registry.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error('Review candidate not found');
    if (!input.products.some((item) => productKey(item) === productKey(proposal)))
      throw new Error('Candidate has no current owned footprint');
    const catalogs = await catalogsFactory(effectiveProducts(input, collected.registry));
    const record = await catalogs.get(proposal.candidate, true);
    const source = effectiveProducts(input, collected.registry).find(
      (item) => productKey(item) === productKey(proposal),
    );
    const officialGame =
      record.identity.provider === 'rawg' &&
      record.kind === 'unknown' &&
      source?.kind === 'game' &&
      source.classification?.source === 'store-metadata' &&
      source.classification.confidence === 'primary';
    const receipt = ReviewReceiptSchema.parse({
      reviewId: randomUUID(),
      proposalId,
      inputHash: input.inputHash,
      approvedAt: new Date().toISOString(),
      reviewer: 'human',
      store: proposal.store,
      storeId: proposal.storeId,
      catalog: proposal.candidate,
      evidenceUrls: [
        ...new Set([
          ...proposal.evidenceUrls,
          ...(independence && proposal.independence ? proposal.independence.evidenceUrls : []),
        ]),
      ],
      ...(independence && proposal.independence
        ? { kind: proposal.independence.kind, dependency: proposal.independence.dependency }
        : officialGame
          ? {
              kind: 'game',
              dependency: 'none',
              evidenceUrls: [
                ...new Set([...proposal.evidenceUrls, ...source.classification.evidenceUrls]),
              ],
            }
          : {}),
    });
    if (independence && !proposal.independence)
      throw new Error('No launch-requirement evidence in this proposal');
    applyIndependence(record, receipt);
    putRecord(collected.registry, record);
    await parents(collected.registry, catalogs);
    collected.registry.reviews.push(receipt);
    // This explicit human decision can replace a lost automatic store link. Other positive
    // ID/type conflicts still remain Unknown; only these individually tagged changes are cleared.
    const resolvedChanges = collected.registry.issues.filter(
      (issue) =>
        productKey(issue) === productKey(proposal) && issue.evidenceType === 'exact-link-changed',
    );
    collected.registry.matches = collected.registry.matches.filter(
      (match) =>
        !resolvedChanges.some(
          (issue) =>
            issue.catalog &&
            productKey(match) === productKey(issue) &&
            match.method !== 'human-review' &&
            catalogKey(match.catalog) === catalogKey(issue.catalog),
        ),
    );
    collected.registry.issues = collected.registry.issues.filter(
      (issue) => !resolvedChanges.includes(issue),
    );
    collected.registry.matches = collected.registry.matches.filter(
      (match) =>
        productKey(match) !== productKey(proposal) ||
        catalogKey(match.catalog) !== catalogKey(proposal.candidate),
    );
    collected.registry.matches.push({
      store: proposal.store,
      storeId: proposal.storeId,
      catalog: proposal.candidate,
      method: 'human-review',
      reviewId: receipt.reviewId,
      verifiedAt: record.checkedAt,
      evidenceUrls: receipt.evidenceUrls,
    });
    collected.registry.proposals = collected.registry.proposals.filter(
      (item) => item.id !== proposalId,
    );
    collected.registry.candidateChecks = collected.registry.candidateChecks.filter(
      (item) => item.proposalId !== proposalId,
    );
    validateRegistry(collected.registry);
    await withLock(root, 'snapshot', async () => {
      await assertCurrent(input.inputHash, root);
      await atomicWrite(join(root, 'collected.json'), collected);
    });
    return {
      reviewId: receipt.reviewId,
      proposalId,
      message: 'Human decision recorded. Run validate to publish the rechecked registry.',
    };
  });
}
export async function writeReview(input, registry, root) {
  const rows = classifyFootprints(input.products, registry);
  const ownedKeys = new Set(input.products.map(productKey));
  const groupBy = (entries, key) => {
    const index = new Map();
    for (const entry of entries) {
      const id = key(entry);
      const values = index.get(id) ?? [];
      values.push(entry);
      index.set(id, values);
    }
    return index;
  };
  const productMetadata = groupBy(registry.products, productKey);
  const platformMetadata = groupBy(registry.platforms, productKey);
  const packageMetadata = groupBy(registry.packages, (entry) => entry.packageId);
  const proposalMetadata = groupBy(registry.proposals, productKey);
  const unknown = rows
    .filter((role) => role.role === 'unknown')
    .map((role) => {
      const item = role.footprint;
      const packages = role.packageIds.flatMap((id) => packageMetadata.get(id) ?? []);
      const related = [...new Set(packages.flatMap((pkg) => pkg.appIds))].filter(
        (id) => `steam:${id}` !== productKey(item),
      );
      return {
        ...item,
        role: role.role,
        inferred: role.inferred,
        reason: role.reason,
        relatedFamilies: role.relatedFamilies,
        packageIds: role.packageIds,
        links:
          item.store === 'steam'
            ? [
                `https://store.steampowered.com/app/${item.storeId}/`,
                `https://steamdb.info/app/${item.storeId}/`,
              ]
            : item.publicUrl
              ? [item.publicUrl]
              : [],
        candidates: proposalMetadata.get(productKey(item)) ?? [],
        metadata: productMetadata.get(productKey(item)) ?? [],
        officialPlatforms: platformMetadata.get(productKey(item)) ?? [],
        packages,
        relatedProducts: related.flatMap((id) =>
          (productMetadata.get(`steam:${id}`) ?? [{ store: 'steam', storeId: id }]).map(
            (observation) => ({ ...observation, hasOwnedFootprint: ownedKeys.has(`steam:${id}`) }),
          ),
        ),
      };
    });
  const counts = {
    products: rows.length,
    games: projectFootprints(input.products, registry).games.length,
    gameProducts: rows.filter((item) => item.role === 'game').length,
    unknown: unknown.length,
    technical: rows.filter((item) => !['game', 'unknown'].includes(item.role)).length,
    candidates: registry.proposals.length,
  };
  await atomicWrite(join(root, 'review.json'), {
    version: 1,
    inputHash: input.inputHash,
    generatedAt: new Date().toISOString(),
    counts,
    unknown,
  });
  // JSON is the full agent input. The compact Markdown index has public IDs/links and no notes/auth data.
  const escape = (text) => String(text).replace(/[|\r\n]/gu, ' ');
  await atomicWrite(
    join(root, 'review.md'),
    `# Reconciliation review\n\nInput: ${input.inputHash}\n\n${JSON.stringify(counts)}\n\n| Store / ID | Source title | Reason | Candidates |\n| --- | --- | --- | --- |\n${unknown.map((item) => `| ${escape(productKey(item))} | ${escape(item.title)} | ${escape(item.reason)} | ${item.candidates.map((candidate) => `${catalogKey(candidate.candidate)} (${candidate.id})`).join(', ')} |`).join('\n')}\n`,
  );
  return counts;
}
