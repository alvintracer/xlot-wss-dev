#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const json = async (path, fallback = null) => existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : fallback;
const sha = (data) => createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const validCaseId = (value) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
const validRunId = (value) => typeof value === 'string' && /^[0-9TZ-]+-[0-9]+$/.test(value);

async function safeSourcePath(kit, name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid source path.');
  const path = resolve(kit, name);
  if (!path.startsWith(`${kit}${sep}`) || await realpath(path) !== path) throw new Error('Source path escaped ui-kit or is a symlink.');
  return path;
}

function safeDevCommand(config) {
  const allowedCommands = [
    ['npm', 'run', 'dev', '-w', '@took-wss/wallet-webview', '--', '--host', '127.0.0.1'],
    ['npm', 'run', 'dev', '-w', '@took-wss/reference-bank-host', '--', '--host', '127.0.0.1'],
  ];
  const value = config.review.devCommand;
  if (!Array.isArray(value) || !allowedCommands.some((row) => JSON.stringify(row) === JSON.stringify(value))) throw new Error('Review devCommand is not allowlisted.');
  return value;
}

async function atomicJson(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path) && await readFile(path, 'utf8') === body) return false;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, body);
  await rename(temp, path);
  return true;
}

async function tenantPaths(explicit = option('--tenant')) {
  const local = relative(join(root, 'tenants'), process.cwd()).split(sep)[0];
  const id = explicit ?? (local && !local.startsWith('..') ? local : undefined);
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)) throw new Error('Specify a safe --tenant <tenant-id>.');
  const tenant = join(root, 'tenants', id);
  const kit = join(tenant, 'ui-kit');
  if (!existsSync(kit)) throw new Error(`Missing ui-kit for ${id}.`);
  const actual = await realpath(kit);
  if (actual !== kit || !actual.startsWith(`${join(root, 'tenants')}${sep}`)) throw new Error('External or symlinked tenant ui-kit is not allowed.');
  return { id, tenant, kit, extracted: join(kit, 'extracted'), qa: join(kit, 'qa'), artifacts: join(kit, '.artifacts') };
}

async function sourceFiles(kit) {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['extracted', 'qa', '.artifacts', 'node_modules'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source symlink is not allowed: ${relative(kit, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (allowed.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) files.push(path);
    }
  };
  await walk(kit);
  return files.sort((a, b) => a.localeCompare(b));
}

async function doctor() {
  const chrome = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(JSON.stringify({ node: process.version, npmWorkspace: existsSync(join(root, 'package-lock.json')), browserExecutablePresent: existsSync(chrome), figmaStatus: 'not-checked', note: 'Figma is optional; this command does not connect to an account.' }, null, 2));
}

async function discover() {
  const found = [];
  for (const entry of await readdir(join(root, 'tenants'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const kit = join(root, 'tenants', entry.name, 'ui-kit');
    if (!existsSync(kit)) continue;
    const files = await sourceFiles(kit);
    if (files.length) found.push({ tenantId: entry.name, images: files.length, intake: existsSync(join(kit, 'extracted', 'reference-manifest.json')) ? 'existing' : 'new', runtime: existsSync(join(root, 'tenants', entry.name, 'src', 'index.ts')) ? 'manifest-present' : 'design-only' });
  }
  console.log(JSON.stringify(found, null, 2));
}

async function intake(paths) {
  const files = await sourceFiles(paths.kit);
  if (!files.length) throw new Error('missing-input: no screenshots found in ui-kit.');
  const path = join(paths.extracted, 'reference-manifest.json');
  const previous = await json(path, { schemaVersion: 1, tenantId: paths.id, references: [] });
  const oldByPath = new Map(previous.references.map((item) => [item.sourcePath, item]));
  const oldByHash = new Map(previous.references.map((item) => [item.sha256, item]));
  let nextId = Math.max(0, ...previous.references.map((item) => Number(item.id?.slice(1)) || 0)) + 1;
  const current = [];
  const usedIds = new Set();
  const currentPaths = new Set(files.map((file) => relative(paths.kit, file).split(sep).join('/')));
  const firstByHash = new Map(previous.references.filter((item) => currentPaths.has(item.sourcePath) && !item.duplicateOf).map((item) => [item.sha256, item.id]));
  for (const file of files) {
    const sourcePath = relative(paths.kit, file).split(sep).join('/');
    const data = await readFile(file);
    const digest = sha(data);
    const metadata = await sharp(data).metadata();
    const pathMatch = oldByPath.get(sourcePath);
    const hashMatch = oldByHash.get(digest);
    const prior = pathMatch ?? (hashMatch && !currentPaths.has(hashMatch.sourcePath) && !usedIds.has(hashMatch.id) ? hashMatch : null);
    const id = prior?.id ?? `R${String(nextId++).padStart(3, '0')}`;
    usedIds.add(id);
    const kind = metadata.format === 'png' ? 'image/png' : metadata.format === 'webp' ? 'image/webp' : 'image/jpeg';
    current.push({
      ...(prior ?? {}), id,
      sourcePath, sha256: digest, mediaType: kind, widthPx: metadata.width, heightPx: metadata.height,
      sourceKind: prior?.sourceKind ?? 'screenshot', screenFamily: prior?.screenFamily ?? null,
      state: prior?.state ?? null, scrollGroup: prior?.scrollGroup ?? null,
      duplicateOf: prior ? prior.duplicateOf ?? null : firstByHash.get(digest) ?? null, privacy: prior?.privacy ?? 'needs-review',
      confidence: prior?.confidence ?? { geometry: 'unknown', color: 'unknown', typography: 'unknown', motion: 'not-observable' },
    });
    if (!firstByHash.has(digest)) firstByHash.set(digest, id);
  }
  const changed = current.filter((item) => oldByPath.get(item.sourcePath)?.sha256 !== item.sha256).map((item) => item.id);
  const missing = previous.references.filter((item) => !current.some((now) => now.id === item.id)).map((item) => item.id);
  console.log(JSON.stringify({ tenantId: paths.id, discovered: current.length, changed, missing, dryRun: args.includes('--dry-run'), approval: 'unchanged' }, null, 2));
  if (args.includes('--dry-run')) return;
  await atomicJson(path, { schemaVersion: 1, tenantId: paths.id, references: current });
  const statusPath = join(paths.qa, 'status.json');
  const status = await json(statusPath, { schemaVersion: 1, tenantId: paths.id, workflowVersion: '1.0', stage: 'intake', reviewMode: 'review-required', approval: { state: 'not-requested', approvedBy: null, approvedAt: null, evidenceRunId: null, scope: [] }, coverage: {}, blocked: [], nextAction: 'Classify source images visually' });
  status.coverage = { ...status.coverage, sourcesDiscovered: current.length };
  if (changed.length && status.approval?.state === 'approved') status.approval.state = 'stale';
  await atomicJson(statusPath, status);
}

async function loadReview(paths) {
  const config = await json(join(paths.kit, 'intake.json'));
  const cases = await json(join(paths.qa, 'cases.json'));
  if (!config?.review?.url || !Array.isArray(config?.review?.devCommand) || !Array.isArray(cases?.cases)) throw new Error('Review config and cases.json are required.');
  const url = new URL(config.review.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Review URL must be loopback-only.');
  safeDevCommand(config);
  if (url.port !== (config.review.devCommand[4] === '@took-wss/wallet-webview' ? '5174' : '5173')) throw new Error('Review port does not match the allowlisted workspace.');
  return { config, cases, url };
}

async function review(paths) {
  const { config, url } = await loadReview(paths);
  const [bin, ...rest] = safeDevCommand(config);
  if (!bin || !rest.length) throw new Error('Invalid review devCommand.');
  console.log(`Starting local review: ${url.href}`);
  const child = spawn(bin, rest, { cwd: root, stdio: 'inherit', shell: false });
  process.on('SIGINT', () => child.kill('SIGINT'));
  await new Promise((done, reject) => { child.on('exit', done); child.on('error', reject); });
}

async function withReviewServer(config, url, fn) {
  let child;
  try {
    let ready = false;
    try { ready = (await fetch(url)).ok; } catch { /* Start our own process. */ }
    if (!ready) {
      const [bin, ...rest] = safeDevCommand(config);
      child = spawn(bin, rest, { cwd: root, stdio: 'ignore', shell: false });
      for (let n = 0; n < 80; n++) {
        if (child.exitCode !== null) break;
        await sleep(250);
        try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* Wait for Vite. */ }
      }
    }
    if (!ready) throw new Error('Local review server did not become ready.');
    return await fn();
  } finally { if (child) child.kill('SIGTERM'); }
}

async function capture(paths) {
  const caseId = option('--case');
  if (!validCaseId(caseId)) throw new Error('Specify --case <case-id>.');
  const { config, cases, url } = await loadReview(paths);
  const item = cases.cases.find((row) => row.id === caseId);
  if (!item) throw new Error(`Unknown case: ${caseId}`);
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(executablePath)) throw new Error('Browser missing; set WSS_CHROME_PATH.');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const run = join(paths.artifacts, 'runs', runId);
  await mkdir(join(run, 'actual'), { recursive: true });
  const output = join(run, 'actual', `${caseId}.png`);
  await withReviewServer(config, url, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({ viewport: item.viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      if (item.state && item.state !== 'wallet') await page.getByRole('button', { name: item.state === 'light-keypad' ? '거래 키패드' : '보안 키패드' }).click();
      if (item.openButton) await page.getByRole('button', { name: item.openButton }).click();
      await page.locator(item.selector).screenshot({ path: output });
      await atomicJson(join(run, 'capture.json'), { tenantId: paths.id, caseId, runId, viewport: item.viewport, selector: item.selector, errors, sourceRevision: sha(await readFile(join(paths.extracted, 'reference-manifest.json'))), capturedAt: new Date().toISOString() });
      if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
    } finally { await browser.close(); }
  });
  const capturesPath = join(paths.qa, 'captures.json');
  const captures = await json(capturesPath, { schemaVersion: 1, tenantId: paths.id, cases: {} });
  captures.cases[caseId] = { runId, comparison: 'pending' };
  await atomicJson(capturesPath, captures);
  console.log(output);
}

async function compare(paths) {
  const caseId = option('--case');
  if (!validCaseId(caseId)) throw new Error('Specify --case <case-id>.');
  const { cases } = await loadReview(paths);
  const item = cases.cases.find((row) => row.id === caseId);
  const capturesPath = join(paths.qa, 'captures.json');
  const captures = await json(capturesPath);
  const runId = captures?.cases?.[caseId]?.runId;
  if (!item || !validRunId(runId)) throw new Error('Capture this case before comparing.');
  const run = join(paths.artifacts, 'runs', runId);
  const actual = join(run, 'actual', `${caseId}.png`);
  const actualInfo = await sharp(actual).metadata();
  const metrics = { tenantId: paths.id, caseId, runId, kind: item.kind, actualPx: [actualInfo.width, actualInfo.height], approval: 'pending', result: 'visual-review-required' };
  if (item.comparison === 'visual' && item.referenceCrop) {
    if (item.privacyReviewed !== true) throw new Error('Reference crop requires explicit privacyReviewed=true.');
    const manifest = await json(join(paths.extracted, 'reference-manifest.json'));
    const ref = manifest.references.find((row) => row.id === item.referenceIds[0]);
    if (!ref) throw new Error('Reference ID missing from manifest.');
    const source = await safeSourcePath(paths.kit, ref.sourcePath);
    const crop = item.referenceCrop;
    const baseline = await sharp(source).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).resize(actualInfo.width, actualInfo.height).png().toBuffer();
    await mkdir(join(run, 'references'), { recursive: true });
    await writeFile(join(run, 'references', `${caseId}.png`), baseline);
    const left = await sharp(baseline).removeAlpha().raw().toBuffer();
    const right = await sharp(actual).removeAlpha().raw().toBuffer();
    let total = 0; let changed = 0;
    const diff = Buffer.alloc(left.length);
    for (let i = 0; i < left.length; i += 3) {
      const delta = (Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2])) / 3;
      total += delta;
      if (delta > 30) changed++;
      diff[i] = Math.min(255, delta * 4); diff[i + 1] = 0; diff[i + 2] = 0;
    }
    await mkdir(join(run, 'diff'), { recursive: true });
    await sharp(diff, { raw: { width: actualInfo.width, height: actualInfo.height, channels: 3 } }).png().toFile(join(run, 'diff', `${caseId}.png`));
    const overlay = await sharp(baseline).composite([{ input: await sharp(actual).ensureAlpha(.5).png().toBuffer(), blend: 'over' }]).png().toBuffer();
    await mkdir(join(run, 'overlay'), { recursive: true });
    await writeFile(join(run, 'overlay', `${caseId}.png`), overlay);
    metrics.meanRgbDelta = Number((total / (left.length / 3)).toFixed(2));
    metrics.changedPixelRatio = Number((changed / (left.length / 3)).toFixed(4));
    metrics.normalization = 'reference crop resized uniformly to actual component dimensions; no privacy mask';
  }
  await atomicJson(join(run, 'metrics.json'), metrics);
  captures.cases[caseId].comparison = metrics.result;
  await atomicJson(capturesPath, captures);
  console.log(JSON.stringify(metrics, null, 2));
}

async function report(paths) {
  const captures = await json(join(paths.qa, 'captures.json'), { cases: {} });
  const cases = (await json(join(paths.qa, 'cases.json'), { cases: [] })).cases;
  const rows = [];
  for (const item of cases) {
    if (!validCaseId(item.id)) throw new Error('Invalid case ID in cases.json.');
    const latest = captures.cases?.[item.id];
    if (!latest) { rows.push(`<section><h2>${escapeHtml(item.id)}</h2><p>Capture pending</p></section>`); continue; }
    if (!validRunId(latest.runId)) throw new Error('Invalid run ID in captures.json.');
    const run = join(paths.artifacts, 'runs', latest.runId);
    const metrics = await json(join(run, 'metrics.json'));
    const image = `../runs/${encodeURIComponent(latest.runId)}/actual/${encodeURIComponent(item.id)}.png`;
    const ref = `../runs/${encodeURIComponent(latest.runId)}/references/${encodeURIComponent(item.id)}.png`;
    const diff = `../runs/${encodeURIComponent(latest.runId)}/diff/${encodeURIComponent(item.id)}.png`;
    rows.push(`<section><h2>${escapeHtml(item.id)}</h2><p>${escapeHtml(item.kind)} · references ${escapeHtml(item.referenceIds.join(', '))} · approval pending</p><img src="${image}" alt="Captured ${escapeHtml(item.id)}" />${existsSync(join(run, 'references', `${item.id}.png`)) ? `<img src="${ref}" alt="Local reference crop" /><img src="${diff}" alt="Difference heatmap" />` : ''}<pre>${escapeHtml(JSON.stringify(metrics ?? { comparison: latest.comparison }, null, 2))}</pre></section>`);
  }
  const dir = join(paths.artifacts, 'latest');
  await mkdir(dir, { recursive: true });
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(paths.id)} UI review</title><style>body{font:14px system-ui;margin:24px;background:#f2f3f2;color:#111}section{padding:20px;margin:20px 0;background:white;border-radius:12px}img{display:inline-block;max-width:430px;max-height:932px;object-fit:contain;vertical-align:top;margin:8px}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(paths.id)} UI review · local draft</h1><p>Source screenshots may contain private information. This report links only local captures and approved crops. Automated comparison never grants visual approval.</p>${rows.join('')}</body></html>`;
  await writeFile(join(dir, 'report.html'), html);
  console.log(join(dir, 'report.html'));
}

async function verify(paths) {
  const manifest = await json(join(paths.extracted, 'reference-manifest.json'));
  const captures = await json(join(paths.qa, 'captures.json'), { cases: {} });
  const cases = (await json(join(paths.qa, 'cases.json'), { cases: [] })).cases;
  if (!manifest?.references?.length) throw new Error('Run intake first.');
  for (const item of manifest.references) {
    if (sha(await readFile(await safeSourcePath(paths.kit, item.sourcePath))) !== item.sha256) throw new Error(`Source changed: ${item.id}`);
  }
  const missing = cases.filter((item) => !captures.cases?.[item.id]).map((item) => item.id);
  console.log(JSON.stringify({ tenantId: paths.id, sourcesVerified: manifest.references.length, capturedCases: cases.length - missing.length, totalCases: cases.length, missing, approval: 'not-inferred' }, null, 2));
  if (missing.length) process.exitCode = 1;
}

function help() {
  console.log('Usage: npm run ui:tenant -- <doctor|discover|intake|review|capture|compare|report|verify> [--tenant id] [--case id] [--dry-run]\nExit: 0 success, 1 error, 2 missing input/tool. Review and comparison never imply visual approval.');
}

try {
  if (command === 'help' || args.includes('--help')) help();
  else if (command === 'doctor') await doctor();
  else if (command === 'discover') await discover();
  else {
    const paths = await tenantPaths();
    if (command === 'intake') await intake(paths);
    else if (command === 'review') await review(paths);
    else if (command === 'capture') await capture(paths);
    else if (command === 'compare') await compare(paths);
    else if (command === 'report') await report(paths);
    else if (command === 'verify') await verify(paths);
    else help();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = /missing-input|Browser missing|Review config|Missing ui-kit/.test(String(error)) ? 2 : 1;
}
