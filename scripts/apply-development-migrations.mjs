import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

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

function assertMatchingDatabaseTarget(databaseUrl, projectRef) {
  const url = new URL(databaseUrl);
  const username = decodeURIComponent(url.username);
  const directHostMatches = url.hostname === `db.${projectRef}.supabase.co`;
  const poolerUserMatches = username === `postgres.${projectRef}`;
  if (!directHostMatches && !poolerUserMatches) {
    throw new Error('DATABASE_URL does not target the project in SUPABASE_URL.');
  }
  if (url.pathname !== '/postgres') {
    throw new Error('DATABASE_URL must target the postgres database.');
  }
}

function withoutTransactionWrapper(source) {
  return source
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '');
}

const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const databaseUrl = requiredEnvironment('DATABASE_URL');
const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
assertMatchingDatabaseTarget(databaseUrl, projectRef);

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  idle_timeout: 5,
  connect_timeout: 10,
  ssl: 'require',
});

let lockHeld = false;
try {
  await sql`SELECT pg_advisory_lock(hashtextextended('took-wss-development-migrations', 0))`;
  lockHeld = true;
  await sql.unsafe(`
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
    const existing = await sql`
      SELECT checksum_sha256
      FROM wss_schema_migrations
      WHERE version = ${fileName}
    `;
    if (existing[0]) {
      if (existing[0].checksum_sha256 !== checksum) {
        throw new Error(`Applied migration checksum changed: ${fileName}`);
      }
      process.stdout.write(`already applied ${fileName}\n`);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(withoutTransactionWrapper(source));
      await transaction`
        INSERT INTO wss_schema_migrations (version, checksum_sha256)
        VALUES (${fileName}, ${checksum})
      `;
    });
    process.stdout.write(`applied ${fileName}\n`);
  }

  const [metadata] = await sql`
    SELECT project_name, environment, purpose, sar_storage_mode
    FROM wss_deployment_metadata
    WHERE singleton = true
  `;
  if (!metadata
    || metadata.project_name !== 'xlot-wss-dev'
    || metadata.environment !== 'development'
    || metadata.purpose !== 'proposal-and-early-function-sandbox'
    || metadata.sar_storage_mode !== 'single-project-encrypted') {
    throw new Error('xlot-wss-dev deployment marker verification failed.');
  }
  process.stdout.write(`verified xlot-wss-dev schema (${migrationFiles.length} migrations)\n`);
} finally {
  if (lockHeld) {
    try {
      await sql`SELECT pg_advisory_unlock(hashtextextended('took-wss-development-migrations', 0))`;
    } catch {
      // Connection shutdown below also releases the session-level lock.
    }
  }
  await sql.end({ timeout: 5 });
}
