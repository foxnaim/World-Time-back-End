import { promises as fs } from 'fs';
import * as path from 'path';

import type { CompanySheetStoreFile, StoredCompanySheet } from '../sheets.types';

/**
 * Filesystem-backed JSON store for the mapping
 * companyId -> { spreadsheetId, url, createdAt }.
 *
 * This is intentionally MVP — the Prisma schema is frozen and we
 * don't want to add a new model just to cache one string per
 * company. If the file is missing / corrupt we start fresh.
 */

const STORE_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(STORE_DIR, 'company-sheets.json');

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
  } catch {
    // mkdir with recursive:true should not throw on existing — ignore.
  }
}

export function getPath(): string {
  return STORE_FILE;
}

export async function read(): Promise<CompanySheetStoreFile> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as CompanySheetStoreFile;
    }
    return {};
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return {};
    // Corrupt file — don't crash the service; start from empty.
    return {};
  }
}

export async function get(companyId: string): Promise<StoredCompanySheet | undefined> {
  const all = await read();
  return all[companyId];
}

export async function write(companyId: string, entry: StoredCompanySheet): Promise<void> {
  await ensureDir();
  const all = await read();
  all[companyId] = entry;
  await fs.writeFile(STORE_FILE, JSON.stringify(all, null, 2), 'utf8');
}
