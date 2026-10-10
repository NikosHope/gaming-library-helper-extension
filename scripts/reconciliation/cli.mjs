import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chmod } from 'node:fs/promises';
import { inputFromLocalDocument } from '../../src/core/reconciliation-import.ts';
import { NATIVE_HOST } from '../../src/core/native-protocol.ts';
import { InputSnapshotSchema, AcceptedResultSchema } from '../../src/core/reconciliation-schema.ts';
import { privateRoot, repoRoot, readJson, atomicWrite, publishSnapshot } from './io.mjs';
import { collect, validate, approve } from './pipeline.mjs';
import { credentialStatus, setupCredentials } from './keychain.mjs';

const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
export async function installHost() {
  if (process.platform !== 'darwin')
    throw new Error('Native host installation supports macOS in this version');
  const launcher = join(privateRoot, 'native-host.sh');
  await atomicWrite(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} --import ${shellQuote(join(repoRoot, 'node_modules/tsx/dist/loader.mjs'))} ${shellQuote(join(repoRoot, 'scripts/reconciliation/native-host.mjs'))} "$@"\n`,
  );
  await chmod(launcher, 0o700);
  const manifest = join(
    homedir(),
    'Library/Application Support/Mozilla/NativeMessagingHosts',
    `${NATIVE_HOST}.json`,
  );
  await atomicWrite(manifest, {
    name: NATIVE_HOST,
    description: 'Local Gaming Library Helper snapshot and catalog bridge',
    path: launcher,
    type: 'stdio',
    allowed_extensions: ['gaming-library-helper@nikita.local'],
  });
  return { installed: true, manifest, host: NATIVE_HOST };
}
async function main(args) {
  const [command, ...rest] = args;
  const options = Object.fromEntries(
    rest
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => [arg.slice(2), rest[rest.indexOf(arg) + 1]]),
  );
  const allowed = {
    collect: ['input', 'packages', 'no-pics'],
    validate: ['proposals'],
    approve: ['proposal', 'human', 'independence'],
    keys: [],
    'install-host': [],
    status: [],
    help: [],
  };
  if (
    !Object.hasOwn(allowed, command ?? 'help') ||
    Object.keys(options).some((key) => !allowed[command].includes(key))
  )
    throw new Error('Unsupported CLI operation/option. Use pnpm reconcile help');
  switch (command) {
    case 'install-host':
      return installHost();
    case 'keys':
      return rest[0] === 'setup' ? setupCredentials() : credentialStatus();
    case 'status': {
      const input = await readJson(join(privateRoot, 'snapshot.json'), true);
      const result = await readJson(join(privateRoot, 'result.json'), true);
      const snapshot = input ? InputSnapshotSchema.parse(input) : undefined;
      const accepted = result ? AcceptedResultSchema.parse(result) : undefined;
      return {
        keys: await credentialStatus(),
        snapshot: snapshot
          ? {
              createdAt: snapshot.createdAt,
              inputHash: snapshot.inputHash,
              products: snapshot.products.length,
            }
          : null,
        result: accepted
          ? {
              createdAt: accepted.createdAt,
              inputHash: accepted.inputHash,
              current: accepted.inputHash === snapshot?.inputHash,
            }
          : null,
      };
    }
    case 'collect': {
      if (options.input) {
        const value = await readJson(resolve(options.input));
        const input = await inputFromLocalDocument(value);
        await publishSnapshot(input);
      }
      return collect({
        ...(rest.includes('--no-pics')
          ? { pics: async () => ({ products: [], packages: [], platforms: [], issues: [] }) }
          : {}),
        packages: options.packages ? options.packages.split(',') : [],
        progress: (value) => process.stderr.write(`${JSON.stringify(value)}\n`),
      });
    }
    case 'validate':
      return validate(options.proposals ? { proposalsPath: resolve(options.proposals) } : {});
    case 'approve':
      return approve(options.proposal, {
        human: rest.includes('--human'),
        independence: rest.includes('--independence'),
      });
    default:
      return {
        workflow: [
          'pnpm reconcile install-host',
          'pnpm reconcile keys setup',
          'pnpm reconcile collect [--input local-backup.json] [--packages 817628] [--no-pics]',
          'pnpm reconcile validate [--proposals local-proposals.json]',
          'pnpm reconcile approve --proposal UUID --human [--independence]',
          'pnpm reconcile validate',
        ],
        schedule: 'Prepared workflow only; activation and cadence require a separate user request.',
      };
  }
}
try {
  process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)), null, 2)}\n`);
} catch (error) {
  // Zod errors include untrusted input, and network errors may include credentials. Never print them.
  const safe =
    error instanceof Error &&
    !['ZodError', 'TypeError', 'SyntaxError'].includes(error.name) &&
    !/https?:|token|secret|password|authorization/iu.test(error.message)
      ? error.message
      : 'Operation failed; check local setup and document format. Saved library/result is unchanged.';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}
