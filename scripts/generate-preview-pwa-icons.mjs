import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconDirectory = join(root, 'apps/reference-bank-host/public/icons');
await mkdir(iconDirectory, { recursive: true });
const iconSources = [
  { source: 'tenants/kiwoom/ui-kit/app-logo-big.png', mime: 'image/png', prefix: 'kiwoom-wallet-v2', cornerRadius: '' },
  { source: 'tenants/JB/ui-kit/app-logo-jb.webp', mime: 'image/webp', prefix: 'jb-wallet-v3', cornerRadius: '23%' },
  { source: 'tenants/namu/namu-app-logo.png', mime: 'image/png', prefix: 'namu-wallet-v3', cornerRadius: '23%' },
];
const browser = await chromium.launch({
  executablePath: process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

try {
  for (const { source, mime, prefix, cornerRadius, background } of iconSources) {
    const logo = await readFile(join(root, source));
    const src = `data:${mime};base64,${logo.toString('base64')}`;
    for (const size of [180, 192, 512]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${background ?? (cornerRadius ? 'transparent' : '#fff')};display:grid;place-items:center}.icon{width:${cornerRadius ? '88%' : '100%'};height:${cornerRadius ? '88%' : '100%'};overflow:hidden;border-radius:${cornerRadius || '0'}}img{display:block;width:100%;height:100%;object-fit:contain}</style><div class="icon"><img src="${src}" alt=""></div>`);
      await page.locator('img').evaluate((image) => image.decode());
      await page.screenshot({ path: join(iconDirectory, `${prefix}-${size}.png`), omitBackground: Boolean(cornerRadius) });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
