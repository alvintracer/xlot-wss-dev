import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = resolve(
  repositoryRoot,
  'services/institution-bff/db/migrations',
);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function projectRefFromSupabaseUrl(value) {
  const url = new URL(value);
  const [projectRef, ...suffix] = url.hostname.split('.');
  if (!projectRef || suffix.join('.') !== 'supabase.co') {
    throw new Error('SUPABASE_URL is not a hosted Supabase project URL.');
  }
  return projectRef;
}

function withoutTransactionWrapper(source) {
  return source
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '');
}

async function linkedQuery(sql) {
  const { stdout } = await execFileAsync(
    'supabase',
    ['db', 'query', '--linked', '--output', 'json', sql],
    { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  if (!result || !Array.isArray(result.rows)) {
    throw new Error('Supabase CLI returned an unexpected query response.');
  }
  return result.rows;
}

const expectedProjectRef = projectRefFromSupabaseUrl(requiredEnvironment('SUPABASE_URL'));
const linkedProjectRef = (await readFile(
  resolve(repositoryRoot, 'supabase/.temp/project-ref'),
  'utf8',
)).trim();
if (linkedProjectRef !== expectedProjectRef) {
  throw new Error('Linked Supabase project does not match SUPABASE_URL.');
}

await linkedQuery(`
  CREATE TABLE IF NOT EXISTS wss_schema_migrations (
    version text PRIMARY KEY,
    checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE wss_schema_migrations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE wss_schema_migrations FROM anon, authenticated;
`);

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((fileName) => /^\d+_.*\.sql$/.test(fileName))
  .sort();
if (migrationFiles.length === 0) throw new Error('No WSS migrations found.');

for (const fileName of migrationFiles) {
  const source = await readFile(resolve(migrationsDirectory, fileName), 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  const existing = await linkedQuery(`
    SELECT checksum_sha256
    FROM wss_schema_migrations
    WHERE version = '${fileName}'
  `);
  if (existing[0]) {
    if (existing[0].checksum_sha256 !== checksum) {
      throw new Error(`Applied migration checksum changed: ${fileName}`);
    }
    process.stdout.write(`already applied ${fileName}\n`);
    continue;
  }

  await linkedQuery(`
    BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('took-wss-development-migrations', 0));
    ${withoutTransactionWrapper(source)}
    INSERT INTO wss_schema_migrations (version, checksum_sha256)
    VALUES ('${fileName}', '${checksum}');
    COMMIT;
  `);
  process.stdout.write(`applied ${fileName}\n`);
}

const verification = await linkedQuery(`
  SELECT
    (SELECT count(*)::int FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'wss_%') AS wss_table_count,
    project_name,
    environment,
    purpose,
    sar_storage_mode
  FROM wss_deployment_metadata
  WHERE singleton = true
`);
const metadata = verification[0];
if (!metadata
  || metadata.project_name !== 'xlot-wss-dev'
  || metadata.environment !== 'development'
  || metadata.purpose !== 'proposal-and-early-function-sandbox'
  || metadata.sar_storage_mode !== 'single-project-encrypted') {
  throw new Error('xlot-wss-dev deployment marker verification failed.');
}
process.stdout.write(
  `verified xlot-wss-dev schema (${metadata.wss_table_count} tables, ${migrationFiles.length} migrations)\n`,
);
