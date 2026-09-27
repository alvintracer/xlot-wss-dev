import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const hostUrl = process.env.WSS_REFERENCE_HOST_URL || 'http://127.0.0.1:5173';
const chromePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WSS_WALLET_FLOW_SCREENSHOT || '/tmp/took-wss-kiwoom-wallet-flow.png';
const homeScreenshotPath = process.env.WSS_WALLET_HOME_SCREENSHOT || '/tmp/took-wss-kiwoom-asset-home.png';
const previewCustomerRef = `kiwoom-browser-e2e-${Date.now()}`;

await access(chromePath);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10_000);
const browserErrors = [];
const apiResponses = new Map();

page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text());
});
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (pathname === '/v1/sessions'
    || pathname === '/v1/runtime/bootstrap'
    || pathname === '/v1/wallets/provision'
    || pathname === '/v1/registration/intents') {
    apiResponses.set(pathname, response.status());
  }
  if (/^\/v1\/registration\/intents\/[^/]+\/challenges$/.test(pathname)) apiResponses.set('/v1/registration/intents/:intentId/challenges', response.status());
  if (/^\/v1\/registration\/intents\/[^/]+\/challenges\/[^/]+\/verify$/.test(pathname)) apiResponses.set('/v1/registration/intents/:intentId/challenges/:challengeId/verify', response.status());
  if (/^\/v1\/wallets\/[^/]+\/home$/.test(pathname)) apiResponses.set('/v1/wallets/:walletId/home', response.status());
});

try {
  const previewUrl = new URL(hostUrl);
  previewUrl.searchParams.set('customerRef', previewCustomerRef);
  await page.goto(previewUrl.toString(), { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '은행앱에서 월렛 열기' }).click();
  const walletFrame = page.frameLocator('iframe');
  await walletFrame.getByRole('button', { name: '첫 지갑 추가하기' }).click();
  await page.locator('.phone[data-shell-mode="focus"]').waitFor();
  await walletFrame.getByRole('heading', { name: /지갑을 연결할 정보를/ }).waitFor();
  await walletFrame.getByLabel('이름').fill('테스트사용자');
  await walletFrame.getByLabel('생년월일').fill('19900102');
  await walletFrame.getByRole('button', { name: /통신사 선택/ }).click();
  await walletFrame.getByRole('dialog', { name: '통신사 선택' }).getByRole('button', { name: 'SKT', exact: true }).click();
  await walletFrame.getByLabel('휴대폰 번호').fill('01000000000');
  await walletFrame.getByRole('checkbox').check();
  await walletFrame.getByRole('button', { name: '인증번호 받기' }).click();
  const developmentCodeCopy = await walletFrame.locator('.kw-development-code').innerText();
  const developmentCode = developmentCodeCopy.match(/\d{6}/)?.[0];
  if (!developmentCode) throw new Error('Development phone code was not shown in the loopback preview.');
  await walletFrame.getByLabel('인증번호').fill(developmentCode);
  await walletFrame.getByRole('button', { name: '인증번호 확인' }).click();
  await walletFrame.getByRole('button', { name: '키움 인증 요청' }).click();
  await walletFrame.getByRole('heading', { name: /새로 만들거나 기존 지갑을/ }).waitFor();
  await walletFrame.getByRole('button', { name: /새 지갑 만들기/ }).click();
  await walletFrame.getByRole('heading', { name: /복구 구문은 고객 기기/ }).waitFor();
  await walletFrame.getByRole('button', { name: '새 지갑으로 계속' }).click();
  await walletFrame.getByRole('heading', { name: /2개 조건으로 내가 직접/ }).waitFor();
  await walletFrame.getByRole('checkbox').check();
  await walletFrame.getByRole('button', { name: '지갑 만들기' }).click();
  await page.locator('.event-log').getByText('took-wss:secure-sar-create-request').waitFor();
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();
  await walletFrame.getByText('자가복구 지갑 1', { exact: true }).waitFor();
  await walletFrame.getByText(/지원 네트워크 9개/).waitFor();
  if (await walletFrame.getByTestId('wallet-address-group').count() !== 5) {
    throw new Error('The selected wallet must group nine networks into five wallet-address rows.');
  }
  const evmAddressRow = walletFrame.getByTestId('wallet-address-group').filter({ hasText: 'EVM' });
  await evmAddressRow.getByText(/Ethereum · Polygon · Arbitrum · Base · BNB Chain/).waitFor();
  if (await walletFrame.getByText('주소 생성 대기', { exact: true }).count() !== 0
    || await walletFrame.getByRole('button', { name: /주소 복사/ }).count() !== 5) {
    throw new Error('The host key core must register five real wallet address groups.');
  }
  const walletControlColors = await walletFrame.locator('.kw-wallet-context-actions').evaluate((element) => {
    const selector = element.querySelector('.kw-wallet-selector');
    const add = element.querySelector('.kw-wallet-add-inline');
    return {
      selector: selector ? getComputedStyle(selector).color : null,
      add: add ? getComputedStyle(add).color : null,
    };
  });
  if (walletControlColors.selector !== walletControlColors.add) {
    throw new Error(`Wallet add control color must match the selector: ${JSON.stringify(walletControlColors)}`);
  }
  if (await walletFrame.getByTestId('wallet-chain-slot').count() !== 0) {
    throw new Error('Networks must not be rendered as wallet slots.');
  }
  await page.getByRole('navigation', { name: '자산 서비스' }).getByText('디지털자산', { exact: true }).waitFor();
  await walletFrame.getByRole('button', { name: '채우기' }).waitFor();
  await walletFrame.getByRole('button', { name: '보내기' }).waitFor();
  await walletFrame.getByRole('button', { name: '환전하기' }).waitFor();
  await walletFrame.getByRole('button', { name: '잔액 숨기기' }).click();
  if (await walletFrame.locator('.kw-hero').innerText() !== '••••') {
    throw new Error('Balance privacy toggle did not hide the total valuation.');
  }
  await walletFrame.getByRole('button', { name: '잔액 보기' }).click();

  await walletFrame.getByRole('button', { name: '지갑 추가하기' }).click();
  await walletFrame.getByRole('heading', { name: /키 관리 방식을 선택/ }).waitFor();
  await walletFrame.getByRole('button', { name: /FSL MPC 지갑/ }).click();
  await walletFrame.getByRole('button', { name: '선택한 방식으로 계속' }).click();
  await walletFrame.getByRole('button', { name: '키움 인증 요청' }).click();
  await walletFrame.locator('h1.kw-flow-title', { hasText: 'FSL MPC 지갑' }).waitFor();
  await walletFrame.getByRole('button', { name: '이 지갑 슬롯 추가하기' }).click();
  await walletFrame.getByText('FSL MPC 지갑 2', { exact: true }).waitFor();
  await walletFrame.getByRole('button', { name: /FSL MPC 지갑 2/ }).click();
  const selectorDialog = walletFrame.getByRole('dialog', { name: '지갑 선택' });
  if (await selectorDialog.locator('.kw-wallet-choice').count() !== 2) {
    throw new Error('Super Wallet must contain two independent wallet slots.');
  }
  await selectorDialog.getByRole('button', { name: /자가복구 지갑 1/ }).click();
  await walletFrame.getByText('자가복구 지갑 1', { exact: true }).waitFor();
  await page.waitForTimeout(2300);
  await page.screenshot({ path: homeScreenshotPath, fullPage: true });

  await walletFrame.getByRole('button', { name: '채우기' }).click();
  const tookReceiveDialog = walletFrame.getByRole('dialog', { name: '어떻게 받을까요?' });
  if (await tookReceiveDialog.getByRole('tab', { name: '툭받기', exact: true }).getAttribute('aria-selected') !== 'true') {
    throw new Error('Took receive must be the default receive channel.');
  }
  await tookReceiveDialog.getByText('휴대폰 번호', { exact: true }).waitFor();
  await tookReceiveDialog.getByText('E2E 메시지', { exact: true }).waitFor();
  await tookReceiveDialog.getByRole('tab', { name: '주소로 받기', exact: true }).click();
  const receiveDialog = walletFrame.getByRole('dialog', { name: '받을 네트워크를 선택해 주세요' });
  if (await receiveDialog.locator('.kw-network-options .kw-choice').count() !== 9) {
    throw new Error('The selected wallet must expose nine network capabilities inside the action flow.');
  }
  await receiveDialog.getByRole('button', { name: /Ethereum/ }).click();
  const ethereumReceiveDialog = walletFrame.getByRole('dialog', { name: 'Ethereum 주소로 받기' });
  const receiveAddress = await ethereumReceiveDialog.locator('.kw-address').innerText();
  if (!/^0x[0-9a-fA-F]{40}$/.test(receiveAddress)) {
    throw new Error('Receive flow did not expose the key-core-derived EVM address.');
  }
  if (await ethereumReceiveDialog.getByRole('button', { name: '주소 복사' }).isDisabled()) {
    throw new Error('Receive address copy must be enabled for a registered key-core address.');
  }
  await ethereumReceiveDialog.getByRole('button', { name: '닫기' }).click();
  await page.locator('.phone[data-shell-mode="root"]').waitFor();

  await walletFrame.getByRole('button', { name: '보내기' }).click();
  const tookSendDialog = walletFrame.getByRole('dialog', { name: '누구에게 툭 줄까요?' });
  if (await tookSendDialog.getByRole('tab', { name: '툭주기', exact: true }).getAttribute('aria-selected') !== 'true') {
    throw new Error('Took send must be the default send channel.');
  }
  await tookSendDialog.getByRole('tab', { name: '주소로 보내기', exact: true }).click();
  const sendDialog = walletFrame.getByRole('dialog', { name: '보낼 네트워크를 선택해 주세요' });
  await sendDialog.getByRole('button', { name: /Bitcoin/ }).click();
  const bitcoinSendDialog = walletFrame.getByRole('dialog', { name: 'Bitcoin 주소로 보내기' });
  await bitcoinSendDialog.getByText('보낼 수 있는 잔액이 없어요').waitFor();
  if (!await bitcoinSendDialog.getByRole('button', { name: '보내기 준비 중' }).isDisabled()) {
    throw new Error('Send action is enabled without a balance, quote, KYT, or approval.');
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (apiResponses.get('/v1/sessions') !== 201
    || apiResponses.get('/v1/runtime/bootstrap') !== 200
    || apiResponses.get('/v1/registration/intents') !== 201
    || apiResponses.get('/v1/registration/intents/:intentId/challenges') !== 201
    || apiResponses.get('/v1/registration/intents/:intentId/challenges/:challengeId/verify') !== 200
    || apiResponses.get('/v1/wallets/provision') !== 201
    || apiResponses.get('/v1/wallets/:walletId/home') !== 200) {
    throw new Error(`Unexpected API responses: ${JSON.stringify(Object.fromEntries(apiResponses))}`);
  }
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);

  console.log(JSON.stringify({
    status: 'ok',
    api: Object.fromEntries(apiResponses),
    shellPolicy: 'host-tabs-on-root/focus-without-host-chrome',
    walletSlots: 2,
    identityOnboarding: 'encrypted-profile-and-phone-possession',
    walletAddressGroups: 5,
    selectedWalletNetworks: 9,
    sarKeyCore: 'real-derivation-and-2-of-3-verification',
    receive: 'real-address-copy-enabled',
    send: 'blocked-until-balance-quote-kyt-approval',
    homeScreenshot: homeScreenshotPath,
    screenshot: screenshotPath,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    browserErrors,
    api: Object.fromEntries(apiResponses),
    visibleText: (await page.locator('body').innerText()).slice(0, 2000),
  }, null, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
