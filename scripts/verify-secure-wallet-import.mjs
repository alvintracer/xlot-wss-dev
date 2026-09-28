import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { ethers } from 'ethers';
import postgres from 'postgres';

const hostUrl = process.env.WSS_REFERENCE_HOST_URL || 'http://127.0.0.1:5173';
const chromePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WSS_SECURE_IMPORT_SCREENSHOT || '/tmp/took-wss-secure-wallet-import.png';
const customerRef = process.env.WSS_IMPORT_TEST_CUSTOMER_REF || 'demo-customer-001';
const mnemonicWallet = ethers.Wallet.createRandom();
const mnemonic = mnemonicWallet.mnemonic?.phrase;
if (!mnemonic) throw new Error('Could not create an ephemeral BIP-39 test wallet.');
const expectedMnemonicEvmAddress = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0").address;
const privateKeyWallet = ethers.Wallet.createRandom();

await access(chromePath);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(25_000);

const browserErrors = [];
const apiResponses = [];
const responseTasks = [];
const createdWalletIds = new Set();
let secretLeakDetected = false;

page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text());
});
page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname !== '/v1/development/sar-key-core-attestations' && pathname !== '/v1/wallets/provision') return;
  const body = request.postData() || '';
  if (body.includes(mnemonic)
    || body.toLowerCase().includes(privateKeyWallet.privateKey.slice(2).toLowerCase())
    || /"(?:mnemonic|privateKey|seedPhrase|entropy|recoveryShare)"\s*:/iu.test(body)) {
    secretLeakDetected = true;
  }
});
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (pathname === '/v1/development/sar-key-core-attestations' || pathname === '/v1/wallets/provision') {
    apiResponses.push({ pathname, status: response.status() });
  }
  if (pathname === '/v1/wallets/provision' && response.ok()) {
    responseTasks.push(response.json().then((payload) => {
      const walletId = payload?.walletHome?.wallet?.walletId;
      if (typeof walletId === 'string') createdWalletIds.add(walletId);
    }));
  }
});

async function cleanupCreatedWallets() {
  await Promise.all(responseTasks);
  const walletIds = [...createdWalletIds];
  if (walletIds.length === 0) return 0;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to clean secure-import browser fixtures.');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const deployment = await sql`
      SELECT project_name, environment, purpose
      FROM wss_deployment_metadata
      WHERE singleton = true
    `;
    if (deployment[0]?.project_name !== 'xlot-wss-dev'
      || deployment[0]?.environment !== 'development'
      || deployment[0]?.purpose !== 'proposal-and-early-function-sandbox') {
      throw new Error('Refusing fixture cleanup outside xlot-wss-dev.');
    }
    return await sql.begin(async (transaction) => {
      const targets = await transaction`
        SELECT id
        FROM wss_wallets
        WHERE id = any(${walletIds}::uuid[])
          AND tenant_id = 'kiwoom'
          AND provisioning_origin = 'imported'
      `;
      if (targets.length !== walletIds.length) throw new Error('Secure-import fixture cleanup target mismatch.');
      const operationalReferences = await transaction`
        SELECT
          (SELECT count(*)::int FROM wss_transfer_intents WHERE wallet_id = any(${walletIds}::uuid[])) AS transfers,
          (SELECT count(*)::int FROM wss_phone_escrows WHERE wallet_id = any(${walletIds}::uuid[])) AS escrows,
          (SELECT count(*)::int FROM wss_wallet_migrations
            WHERE source_wallet_id = any(${walletIds}::uuid[]) OR target_wallet_id = any(${walletIds}::uuid[])) AS migrations
      `;
      const references = operationalReferences[0];
      if (references.transfers || references.escrows || references.migrations) {
        throw new Error('Refusing fixture cleanup because an operational reference exists.');
      }
      await transaction`DELETE FROM wss_audit_events WHERE wallet_id = any(${walletIds}::uuid[])`;
      await transaction`DELETE FROM wss_wallet_accounts WHERE wallet_id = any(${walletIds}::uuid[])`;
      await transaction`DELETE FROM wss_sar_recovery_profiles WHERE wallet_id = any(${walletIds}::uuid[])`;
      const removed = await transaction`
        DELETE FROM wss_wallets
        WHERE id = any(${walletIds}::uuid[])
          AND tenant_id = 'kiwoom'
          AND provisioning_origin = 'imported'
        RETURNING id
      `;
      return removed.length;
    });
  } finally {
    await sql.end();
  }
}

async function openAddSarFlow(walletFrame) {
  await walletFrame.getByRole('button', { name: '지갑 추가하기' }).click();
  await walletFrame.getByRole('heading', { name: /키 관리 방식을 선택/ }).waitFor();
  await walletFrame.locator('.kw-flow-choice-list').getByRole('button', { name: /자가복구 지갑/ }).click();
  await walletFrame.getByRole('button', { name: '선택한 방식으로 계속' }).click();
  await walletFrame.getByRole('button', { name: '키움 인증 요청' }).click();
  await walletFrame.getByRole('heading', { name: /새로 만들거나 기존 지갑을/ }).waitFor();
}

async function finishSarSetup(walletFrame) {
  await walletFrame.getByRole('heading', { name: /2개 조건으로 내가 직접/ }).waitFor();
  await walletFrame.getByRole('checkbox').check();
  await walletFrame.getByRole('button', { name: '이 지갑 슬롯 추가하기' }).click();
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();
}

try {
  const previewUrl = new URL(hostUrl);
  previewUrl.searchParams.set('customerRef', customerRef);
  await page.goto(previewUrl.toString(), { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '은행앱에서 월렛 열기' }).click();
  const walletFrame = page.frameLocator('iframe');
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();

  await openAddSarFlow(walletFrame);
  await walletFrame.getByRole('button', { name: /니모닉으로 가져오기/ }).click();
  await walletFrame.getByRole('button', { name: '키움 보안 입력 열기' }).click();
  let overlay = page.locator('.host-security-layer');
  await overlay.getByRole('heading', { name: /복구 구문을.*직접 입력/ }).waitFor();
  await overlay.getByLabel('복구 구문').fill(mnemonic);
  await overlay.getByRole('button', { name: '안전하게 가져오기' }).click();
  await overlay.waitFor({ state: 'detached' });
  await finishSarSetup(walletFrame);
  await walletFrame.getByText(/지원 네트워크 9개/).waitFor();
  if (await walletFrame.locator(`code[title="${expectedMnemonicEvmAddress}"]`).count() !== 1) {
    throw new Error('Mnemonic import did not register the expected EVM address.');
  }
  if (await walletFrame.getByRole('button', { name: /주소 복사/ }).count() !== 5) {
    throw new Error('Mnemonic import did not register all five address groups.');
  }
  await walletFrame.getByRole('button', { name: '채우기' }).click();
  let receiveDialog = walletFrame.getByRole('dialog', { name: /어떤 자산을.*채울까요/ });
  await receiveDialog.getByRole('button', { name: /이더리움.*ETH/ }).click();
  receiveDialog = walletFrame.getByRole('dialog', { name: /어떤 네트워크로.*채울까요/ });
  await receiveDialog.getByRole('button', { name: /Ethereum/ }).click();
  receiveDialog = walletFrame.getByRole('dialog', { name: /이 주소로.*자산을 보내주세요/ });
  await receiveDialog.getByRole('img', { name: 'ETH 받기 주소 QR' }).waitFor();
  if (await receiveDialog.getByRole('button', { name: '주소 복사' }).isDisabled()) {
    throw new Error('Imported mnemonic receive address is not copyable.');
  }
  await receiveDialog.getByRole('button', { name: '닫기' }).click();

  await openAddSarFlow(walletFrame);
  await walletFrame.getByRole('button', { name: /개인키로 가져오기/ }).click();
  await walletFrame.getByRole('button', { name: '키움 보안 입력 열기' }).click();
  overlay = page.locator('.host-security-layer');
  await overlay.getByRole('heading', { name: /EVM 개인키를.*직접 입력/ }).waitFor();
  await overlay.getByLabel('개인키').fill(privateKeyWallet.privateKey);
  await overlay.getByRole('button', { name: '안전하게 가져오기' }).click();
  await overlay.waitFor({ state: 'detached' });
  await finishSarSetup(walletFrame);
  await walletFrame.getByText(/지원 네트워크 5개/).waitFor();
  if (await walletFrame.locator(`code[title="${privateKeyWallet.address}"]`).count() !== 1) {
    throw new Error('Private-key import did not register the expected EVM address.');
  }
  if (await walletFrame.getByRole('button', { name: /주소 복사/ }).count() !== 1) {
    throw new Error('Private-key import must expose exactly one ready EVM address group.');
  }
  if (secretLeakDetected) throw new Error('Imported secret material crossed the host/BFF boundary.');
  if (apiResponses.length !== 4 || apiResponses.some(({ status }) => status !== 201)) {
    throw new Error(`Unexpected secure-import API responses: ${JSON.stringify(apiResponses)}`);
  }
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    status: 'ok',
    mnemonicImport: 'five-address-groups',
    privateKeyImport: 'evm-only',
    receive: 'imported-ethereum-address-qr-and-copy-ready',
    bffSecretBoundary: 'no-imported-secret-fields-or-values',
    fixtureCleanup: 'exact-created-wallet-ids',
    api: apiResponses,
    screenshot: screenshotPath,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    browserErrors,
    api: apiResponses,
    currentUrl: page.url(),
    error: error instanceof Error ? error.message : 'Unknown verification error',
  }, null, 2));
  throw error;
} finally {
  await browser.close();
  const removedFixtures = await cleanupCreatedWallets();
  if (removedFixtures !== createdWalletIds.size) {
    throw new Error('Secure-import browser fixture cleanup did not remove every created wallet.');
  }
}
