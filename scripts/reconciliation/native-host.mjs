import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endianness } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  NativeRequestSchema,
  NATIVE_HOST,
  CHUNK_CHARACTERS,
  MAX_EXCHANGE_BYTES,
} from '../../src/core/native-protocol.ts';
import { AcceptedResultSchema } from '../../src/core/reconciliation-schema.ts';
import { contentHash, verifyInputSnapshot } from '../../src/core/reconciliation.ts';
import { privateRoot, readJson, publishSnapshot, currentInput } from './io.mjs';
import { approve } from './pipeline.mjs';

export function createNativeSession(root = privateRoot, approveReview = approve) {
  let incoming;
  let result;
  return async (raw) => {
    const parsed = NativeRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 'error', code: 'invalid-message' };
    const request = parsed.data;
    try {
      switch (request.op) {
        case 'publish:begin': {
          const previous = await readJson(join(root, 'snapshot.json'), true);
          if (previous?.inputHash === request.inputHash) {
            incoming = undefined;
            return { status: 'ok', changed: false, inputHash: request.inputHash };
          }
          incoming = { inputHash: request.inputHash, characters: request.characters, text: '' };
          return { status: 'ok', changed: true };
        }
        case 'publish:chunk':
          if (
            !incoming ||
            request.offset !== incoming.text.length ||
            request.offset + request.data.length > incoming.characters
          )
            throw new Error();
          incoming.text += request.data;
          if (Buffer.byteLength(incoming.text) > MAX_EXCHANGE_BYTES) {
            incoming = undefined;
            throw new Error();
          }
          return { status: 'ok' };
        case 'publish:commit': {
          if (!incoming || incoming.text.length !== incoming.characters) throw new Error();
          const staged = incoming;
          incoming = undefined;
          const input = await verifyInputSnapshot(JSON.parse(staged.text));
          if (input.inputHash !== staged.inputHash) throw new Error();
          return { status: 'ok', ...(await publishSnapshot(input, root)) };
        }
        case 'result:read': {
          if (!result || request.offset === 0) {
            const document = await readJson(join(root, 'result.json'), true);
            if (!document) return { status: 'waiting' };
            const checked = AcceptedResultSchema.parse(document);
            if (checked.inputHash !== request.inputHash)
              return { status: 'error', code: 'stale-input' };
            result = {
              text: JSON.stringify(checked),
              hash: await contentHash(checked),
              inputHash: request.inputHash,
            };
          }
          if (result.inputHash !== request.inputHash || request.offset > result.text.length)
            throw new Error();
          const data = result.text.slice(request.offset, request.offset + CHUNK_CHARACTERS);
          return {
            status: 'chunk',
            data,
            offset: request.offset,
            total: result.text.length,
            hash: result.hash,
          };
        }
        case 'review:approve':
          if ((await currentInput(root)).inputHash !== request.inputHash)
            return { status: 'error', code: 'stale-input' };
          await approveReview(request.proposalId, {
            root,
            human: true,
            independence: request.independence,
            expectedInputHash: request.inputHash,
          });
          return { status: 'ok' };
      }
    } catch {
      return {
        status: 'error',
        code: request.op === 'review:approve' ? 'review-failed' : 'host-failed',
      };
    }
  };
}
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > 1_000_000) throw new Error('Native response exceeds Firefox frame limit');
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
export async function runHost(input = process.stdin, output = process.stdout, root = privateRoot) {
  const session = createNativeSession(root);
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = endianness() === 'LE' ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (!length || length > 1_000_000) return;
      if (buffer.length < length + 4) break;
      let response;
      try {
        response = await session(JSON.parse(buffer.subarray(4, length + 4).toString('utf8')));
      } catch {
        response = { status: 'error', code: 'invalid-message' };
      }
      output.write(encodeFrame(response));
      buffer = buffer.subarray(length + 4);
    }
  }
}
export async function verifyInstalledHost(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return (
    manifest.name === NATIVE_HOST &&
    manifest.type === 'stdio' &&
    JSON.stringify(manifest.allowed_extensions) ===
      JSON.stringify(['gaming-library-helper@nikita.local'])
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Firefox passes its verified manifest location and extension ID. No arguments select paths/commands.
  const caller = process.argv[3];
  if (caller && caller !== 'gaming-library-helper@nikita.local') process.exitCode = 1;
  else await runHost();
}
