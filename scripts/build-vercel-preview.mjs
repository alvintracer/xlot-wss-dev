import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.vercel-preview');
const jbUiTokens = JSON.parse(await readFile(join(root, 'tenants/JB/ui-kit/jb-ui-extractor/design/tokens.json'), 'utf8'));

if (output !== join(root, '.vercel-preview')) throw new Error('Unexpected Vercel preview output path.');

function run(command, args, environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown'}.`)));
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'kiwoom', 'wallet'), { recursive: true });
await mkdir(join(output, 'jb', 'wallet'), { recursive: true });
await mkdir(join(output, 'namu', 'wallet'), { recursive: true });
await mkdir(join(output, 'shinhan', 'wallet'), { recursive: true });
await mkdir(join(output, 'c'), { recursive: true });
await mkdir(join(output, 'pay'), { recursive: true });

await run('npm', ['run', 'build', '-w', '@took-wss/institution-bff'], {});
await run('npm', ['run', 'build', '-w', '@took-wss/reference-bank-host'], {
  VITE_WSS_BASE_PATH: '/kiwoom/',
  VITE_WSS_PUBLIC_PREVIEW: 'true',
  VITE_WSS_PREVIEW_TENANT: 'kiwoom',
});
await cp(join(root, 'apps/reference-bank-host/dist'), join(output, 'kiwoom'), { recursive: true });

await run('npm', ['run', 'build', '-w', '@took-wss/reference-bank-host'], {
  VITE_WSS_BASE_PATH: '/jb/',
  VITE_WSS_PUBLIC_PREVIEW: 'true',
  VITE_WSS_PREVIEW_TENANT: 'jb',
});
await cp(join(root, 'apps/reference-bank-host/dist'), join(output, 'jb'), { recursive: true });
await cp(join(root, 'apps/reference-bank-host/dist/jb.html'), join(output, 'jb/index.html'));
await cp(join(root, 'tenants/JB/assets/OFL-license.txt'), join(output, 'jb/assets/Paperlogy-OFL-license.txt'));

await run('npm', ['run', 'build', '-w', '@took-wss/reference-bank-host'], {
  VITE_WSS_BASE_PATH: '/namu/',
  VITE_WSS_PUBLIC_PREVIEW: 'true',
  VITE_WSS_PREVIEW_TENANT: 'namu',
});
await cp(join(root, 'apps/reference-bank-host/dist'), join(output, 'namu'), { recursive: true });
await cp(join(root, 'apps/reference-bank-host/dist/namu.html'), join(output, 'namu/index.html'));

await run('npm', ['run', 'build', '-w', '@took-wss/reference-bank-host'], {
  VITE_WSS_BASE_PATH: '/shinhan/',
  VITE_WSS_PUBLIC_PREVIEW: 'true',
  VITE_WSS_PREVIEW_TENANT: 'shinhan',
});
await cp(join(root, 'apps/reference-bank-host/dist'), join(output, 'shinhan'), { recursive: true });
await cp(join(root, 'apps/reference-bank-host/dist/shinhan.html'), join(output, 'shinhan/index.html'));

await run('npm', ['run', 'build', '-w', '@took-wss/wallet-webview'], {
  VITE_WSS_BASE_PATH: '/kiwoom/wallet/',
});
await cp(join(root, 'apps/wallet-webview/dist'), join(output, 'kiwoom', 'wallet'), { recursive: true });
await run('npm', ['run', 'build', '-w', '@took-wss/wallet-webview'], {
  VITE_WSS_BASE_PATH: '/jb/wallet/',
  VITE_WSS_LOADING_PRIMARY: jbUiTokens.colors.primary,
  VITE_WSS_LOADING_CANVAS: jbUiTokens.colors.canvas,
  VITE_WSS_LOADING_MUTED: jbUiTokens.colors.muted,
});
await cp(join(root, 'apps/wallet-webview/dist'), join(output, 'jb', 'wallet'), { recursive: true });
await cp(join(root, 'tenants/JB/assets/OFL-license.txt'), join(output, 'jb/wallet/assets/Paperlogy-OFL-license.txt'));
await run('npm', ['run', 'build', '-w', '@took-wss/wallet-webview'], {
  VITE_WSS_BASE_PATH: '/namu/wallet/',
  VITE_WSS_LOADING_PRIMARY: '#84C43D',
  VITE_WSS_LOADING_CANVAS: '#D3E9EA',
  VITE_WSS_LOADING_MUTED: '#747A7C',
});
await cp(join(root, 'apps/wallet-webview/dist'), join(output, 'namu', 'wallet'), { recursive: true });
await run('npm', ['run', 'build', '-w', '@took-wss/wallet-webview'], {
  VITE_WSS_BASE_PATH: '/shinhan/wallet/',
  VITE_WSS_LOADING_PRIMARY: '#0565F5',
  VITE_WSS_LOADING_CANVAS: '#F0F3FA',
  VITE_WSS_LOADING_MUTED: '#748093',
});
await cp(join(root, 'apps/wallet-webview/dist'), join(output, 'shinhan', 'wallet'), { recursive: true });
await cp(join(root, 'deployment/phone-claim'), join(output, 'c'), { recursive: true });
await cp(join(root, 'deployment/qr-payment'), join(output, 'pay'), { recursive: true });

console.log(`Vercel mobile preview assembled at ${output}`);
