import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'scripts', 'tenant-ui.mjs');
const tenantId = `tenant-ui-synthetic-${process.pid}`;
const tenant = join(root, 'tenants', tenantId);
const kit = join(tenant, 'ui-kit');
const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--tenant', tenantId], { cwd: root, encoding: 'utf8' });

test('screenshot-only tenant intake preserves IDs and approval, and rejects external symlinks', async () => {
  try {
    await mkdir(join(kit, 'nested references'), { recursive: true });
    const firstImage = join(kit, 'nested references', '한글 sample.png');
    const png = await sharp({ create: { width: 4, height: 5, channels: 4, background: '#aabbcc' } }).png().toBuffer();
    await writeFile(firstImage, png);
    const first = run('intake');
    assert.equal(first.status, 0, first.stderr);
    const manifestPath = join(kit, 'extracted', 'reference-manifest.json');
    const initial = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(initial.references.length, 1);
    assert.equal(initial.references[0].sourcePath, 'nested references/한글 sample.png');
    assert.equal(initial.references[0].id, 'R001');

    await writeFile(join(kit, 'nested references', 'duplicate.png'), png);
    const duplicate = run('intake');
    assert.equal(duplicate.status, 0, duplicate.stderr);
    const duplicated = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(duplicated.references.length, 2);
    assert.equal(new Set(duplicated.references.map((item) => item.id)).size, 2);
    assert.equal(duplicated.references.find((item) => item.sourcePath.endsWith('duplicate.png')).duplicateOf, 'R001');

    const statusPath = join(kit, 'qa', 'status.json');
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    status.approval.state = 'approved';
    await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');
    const repeat = run('intake');
    assert.equal(repeat.status, 0, repeat.stderr);
    const repeated = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(repeated.references.find((item) => item.sourcePath.endsWith('한글 sample.png')).id, 'R001');
    assert.equal(JSON.parse(await readFile(statusPath, 'utf8')).approval.state, 'approved');

    await writeFile(firstImage, await sharp({ create: { width: 4, height: 6, channels: 4, background: '#aaccee' } }).png().toBuffer());
    const changed = run('intake');
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).references.find((item) => item.sourcePath.endsWith('한글 sample.png')).id, 'R001');
    assert.equal(JSON.parse(await readFile(statusPath, 'utf8')).approval.state, 'stale');

    const outside = join(root, 'package.json');
    const link = join(kit, 'external.png');
    await symlink(outside, link);
    const rejected = run('intake');
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /symlink is not allowed/);
  } finally {
    if (existsSync(tenant)) await rm(tenant, { recursive: true, force: true });
  }
});
