import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const hostUrl = process.env.WSS_REFERENCE_HOST_URL || 'http://127.0.0.1:5173';
const chromePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WSS_SECURE_SAR_SCREENSHOT || '/tmp/took-wss-secure-sar-complete.png';

await access(chromePath);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(15_000);

const browserErrors = [];
const apiResponses = new Map();
let mnemonicWords = [];
let secretLeakDetected = false;

page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text());
});
page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname !== '/v1/development/sar-key-core-attestations' && pathname !== '/v1/wallets/provision') return;
  const body = request.postData() || '';
  const normalized = body.toLocaleLowerCase('en-US');
  if (/"(mnemonic|mnemonicWords|privateKey|seed|seedPhrase|entropy|recoveryShare)"/i.test(body)
    || mnemonicWords.some((word) => normalized.includes(`"${word.toLocaleLowerCase('en-US')}"`))) {
    secretLeakDetected = true;
  }
});
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (pathname === '/v1/development/host-authorizations'
    || pathname === '/v1/development/sar-key-core-attestations'
    || pathname === '/v1/wallets/provision') {
    apiResponses.set(pathname, response.status());
  }
});

try {
  const previewUrl = new URL(hostUrl);
  previewUrl.searchParams.set('customerRef', 'demo-customer-001');
  await page.goto(previewUrl.toString(), { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '은행앱에서 월렛 열기' }).click();

  const walletFrame = page.frameLocator('iframe');
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();
  await walletFrame.getByRole('button', { name: '지갑 추가하기' }).click();
  await walletFrame.getByRole('heading', { name: /키 관리 방식을 선택/ }).waitFor();
  await walletFrame.locator('.kw-flow-choice-list').getByRole('button', { name: /자가복구 지갑/ }).click();
  await walletFrame.getByRole('button', { name: '선택한 방식으로 계속' }).click();

  await walletFrame.getByRole('button', { name: '키움 인증 요청' }).click();
  await walletFrame.getByRole('heading', { name: /새로 만들거나 기존 지갑을/ }).waitFor();
  if (await page.locator('.host-security-layer').count() !== 0) {
    throw new Error('Session-bound wallet authorization unexpectedly opened a host overlay.');
  }

  await walletFrame.getByRole('button', { name: /새 지갑 만들기/ }).click();
  await walletFrame.getByRole('heading', { name: /복구 구문을 안전하게/ }).waitFor();
  await walletFrame.getByRole('button', { name: '키움 보안 화면 열기' }).click();

  const backupOverlay = page.locator('.host-security-layer');
  await backupOverlay.getByRole('heading', { name: /복구 구문을 안전한 곳에/ }).waitFor();
  mnemonicWords = await backupOverlay.locator('.host-seed-word strong').allTextContents();
  if (mnemonicWords.length !== 12 || mnemonicWords.some((word) => !/^[a-z]+$/.test(word))) {
    throw new Error('Host key core did not present a valid-shaped 12-word recovery phrase.');
  }
  const iframeText = await walletFrame.locator('body').innerText();
  if (mnemonicWords.some((word) => iframeText.toLocaleLowerCase('en-US').includes(word.toLocaleLowerCase('en-US')))) {
    throw new Error('A recovery word was rendered inside the WSS iframe.');
  }

  await backupOverlay.getByRole('checkbox').check();
  await backupOverlay.getByRole('button', { name: '기록한 단어 확인하기' }).click();
  const confirmationLabels = backupOverlay.locator('.host-seed-confirmation label');
  if (await confirmationLabels.count() !== 3) throw new Error('Exactly three random recovery words must be confirmed.');
  for (let index = 0; index < await confirmationLabels.count(); index += 1) {
    const label = confirmationLabels.nth(index);
    const positionText = await label.locator('span').innerText();
    const position = Number(positionText.match(/^([0-9]+)번째/)?.[1]);
    const word = mnemonicWords[position - 1];
    if (!word) throw new Error('Recovery-word confirmation requested an invalid position.');
    await label.locator('input').fill(word);
  }
  await backupOverlay.getByRole('button', { name: '복구 구문 확인' }).click();
  await backupOverlay.waitFor({ state: 'detached' });

  await walletFrame.getByRole('heading', { name: /2개 조건으로 내가 직접/ }).waitFor();
  await walletFrame.getByRole('checkbox').check();
  await walletFrame.getByRole('button', { name: '이 지갑 슬롯 추가하기' }).click();
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();
  await walletFrame.getByText(/지원 네트워크 9개/).waitFor();
  if (await walletFrame.getByTestId('wallet-address-group').count() !== 5) {
    throw new Error('The completed SAR wallet did not expose five public address groups.');
  }
  if (secretLeakDetected) throw new Error('Secret material appeared in a BFF request body.');
  if (apiResponses.get('/v1/development/host-authorizations') !== 201
    || apiResponses.get('/v1/development/sar-key-core-attestations') !== 201
    || apiResponses.get('/v1/wallets/provision') !== 201) {
    throw new Error(`Unexpected secure-ceremony API responses: ${JSON.stringify(Object.fromEntries(apiResponses))}`);
  }
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);

  mnemonicWords = [];
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    status: 'ok',
    hostAuthentication: 'session-bound-development-authorization',
    recoveryPhrase: '12-word-host-only-and-three-word-confirmed',
    bffSecretBoundary: 'no-recovery-phrase-fields-or-words',
    publicAddressGroups: 5,
    api: Object.fromEntries(apiResponses),
    screenshot: screenshotPath,
  }, null, 2));
} catch (error) {
  mnemonicWords = [];
  console.error(JSON.stringify({
    browserErrors,
    api: Object.fromEntries(apiResponses),
    currentUrl: page.url(),
    error: error instanceof Error ? error.message : 'Unknown verification error',
  }, null, 2));
  throw error;
} finally {
  mnemonicWords = [];
  await browser.close();
}
