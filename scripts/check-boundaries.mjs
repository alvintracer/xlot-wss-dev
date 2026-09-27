import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const forbidden = [/traverse-wallet/i, /\.\.\/\.\.\/traverse-wallet/i];
const sharedTenantBranch = /(?:tenantId|tenant|manifest\.tenantId)\s*={2,3}\s*['"]kiwoom['"]|['"]kiwoom['"]\s*={2,3}\s*(?:tenantId|tenant|manifest\.tenantId)/;
const violations = [];

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (ignoredDirectories.has(entry.name)) return;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return visit(path);
    if (!allowedExtensions.has(extname(entry.name))) return;
    if (entry.name === 'check-boundaries.mjs') return;
    const source = await readFile(path, 'utf8');
    if (forbidden.some((pattern) => pattern.test(source))) {
      violations.push(relative(root, path));
    }
    const sourcePath = relative(root, path);
    if ((sourcePath.startsWith('apps/') || sourcePath.startsWith('packages/')) && sharedTenantBranch.test(source)) {
      violations.push(`${sourcePath} (tenant branch)`);
    }
  }));
}

await visit(root);

if (violations.length > 0) {
  console.error(`WSS boundary violation:\n${violations.map((path) => `- ${path}`).join('\n')}`);
  process.exit(1);
}

console.log('WSS boundary check passed.');
