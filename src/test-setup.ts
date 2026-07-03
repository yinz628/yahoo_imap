/**
 * Vitest global setup — isolates test data from the real ./data folder.
 *
 * Before any test runs, this creates a unique temp directory and points the
 * DATA_DIR env var at it. auth.ts / storage.ts read DATA_DIR at module load,
 * so all file-writing tests (register, login, saveMailbox, savePattern, ...)
 * write into this throwaway directory instead of polluting the production
 * users.json / mailboxes.json.
 *
 * In production this file is never imported, so ./data is used as before.
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function setup(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'yme-test-'));
  process.env.DATA_DIR = tempDir;
  // eslint-disable-next-line no-console
  console.log(`[test-setup] DATA_DIR isolated to ${tempDir}`);
}
