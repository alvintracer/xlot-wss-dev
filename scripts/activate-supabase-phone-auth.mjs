import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.local.`);
  return value;
}

const supabaseUrl = new URL(required('SUPABASE_URL'));
const expectedProjectRef = supabaseUrl.hostname.split('.')[0];
const linkedProjectRef = (await readFile(resolve(repositoryRoot, 'supabase/.temp/project-ref'), 'utf8')).trim();
if (linkedProjectRef !== expectedProjectRef) throw new Error('Linked Supabase project does not match SUPABASE_URL.');

const hookUri = required('WSS_AUTH_SEND_SMS_HOOK_URI');
if (new URL(hookUri).hostname !== `${expectedProjectRef}.supabase.co`) {
  throw new Error('WSS_AUTH_SEND_SMS_HOOK_URI does not target the linked project.');
}

const secrets = [
  'WSS_AUTH_SEND_SMS_HOOK_SECRET',
  'WSS_SOLAPI_API_KEY',
  'WSS_SOLAPI_API_SECRET',
  'WSS_SOLAPI_SENDER_NUMBER',
].map((name) => `${name}=${required(name)}`);

await execFileAsync('supabase', ['functions', 'deploy', 'wss-auth-send-sms', '--no-verify-jwt'], {
  cwd: repositoryRoot,
});
await execFileAsync('supabase', ['secrets', 'set', ...secrets], {
  cwd: repositoryRoot,
  maxBuffer: 1024 * 1024,
});
await execFileAsync('supabase', ['config', 'push', '--yes'], {
  cwd: repositoryRoot,
  env: process.env,
  maxBuffer: 1024 * 1024,
});

process.stdout.write(`Activated Supabase Auth + SOLAPI phone OTP for ${expectedProjectRef}.\n`);
