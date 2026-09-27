import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const hostUrl = process.env.WSS_REFERENCE_HOST_URL || 'http://127.0.0.1:5173';
const chromePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WSS_SCREENSHOT_PATH || '/tmp/took-wss-kiwoom-w00.png';

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
  if (pathname === '/v1/sessions' || pathname === '/v1/runtime/bootstrap' || pathname === '/v1/wallets/provision') {
    apiResponses.set(pathname, response.status());
  }
});

try {
  await page.goto(hostUrl, { waitUntil: 'networkidle' });
  const kiwoomPhone = page.locator('.phone[data-host-chrome="kiwoom-simple-mode-v1"]');
  await kiwoomPhone.waitFor();
  const kiwoomHeader = kiwoomPhone.getByTestId('kiwoom-root-header');
  const kiwoomNavigation = kiwoomPhone.getByRole('navigation', { name: '키움 앱 기본 메뉴' });
  if (await kiwoomNavigation.getByRole('button').count() !== 5) {
    throw new Error('Kiwoom root navigation must contain exactly five host-owned tabs.');
  }
  if (await kiwoomNavigation.getByRole('button', { name: '지갑' }).count() !== 0) {
    throw new Error('Kiwoom root navigation must not add a sixth wallet tab.');
  }
  if (await kiwoomNavigation.locator('[aria-current="page"]').innerText() !== '자산') {
    throw new Error('Assets must be the active Kiwoom root tab for the wallet view.');
  }
  const chromeDimensions = {
    headerHeight: await kiwoomHeader.evaluate((element) => element.getBoundingClientRect().height),
    navigationHeight: await kiwoomNavigation.evaluate((element) => element.getBoundingClientRect().height),
  };
  if (Math.abs(chromeDimensions.headerHeight - 60) > 1 || Math.abs(chromeDimensions.navigationHeight - 54) > 1) {
    throw new Error(`Kiwoom host chrome dimensions are incorrect: ${JSON.stringify(chromeDimensions)}`);
  }
  if (!await page.getByRole('radio', { name: /took SAR.*기본/ }).isChecked()) {
    throw new Error('took SAR is not the default Kiwoom key adapter.');
  }
  await page.getByRole('radio', { name: 'Thirdweb User Wallet' }).waitFor();
  await page.getByRole('radio', { name: 'FSL MPC' }).waitFor();
  await page.evaluate(() => {
    window.__wssVerificationMessages = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type?.startsWith?.('took-wss:')) window.__wssVerificationMessages.push(event.data);
    });
  });
  await page.getByRole('button', { name: '은행앱에서 월렛 열기' }).click();

  const walletFrame = page.frameLocator('iframe');
  await walletFrame.locator('h1, h2').filter({ hasText: /아직 지갑이 없어요|보유 자산/ }).first().waitFor();
  const walletBody = await walletFrame.locator('body').innerText();
  if (walletBody.includes('12,480,000') || walletBody.includes('USDC')) {
    throw new Error('Synthetic portfolio data is still visible in the wallet.');
  }

  const iframe = page.frames().find((frame) => frame.url().startsWith('http://localhost:5174') || frame.url().startsWith('http://127.0.0.1:5174'));
  if (!iframe) throw new Error('Wallet iframe was not found.');

  const hasExistingWallet = await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).count() > 0;
  await walletFrame.getByRole('button', { name: hasExistingWallet ? '지갑 추가하기' : '첫 지갑 추가하기' }).click();
  if (hasExistingWallet) {
    await walletFrame.getByRole('heading', { name: /키 관리 방식을 선택/ }).waitFor();
    await walletFrame.locator('.kw-flow-choice-list').getByRole('button', { name: /자가복구 지갑/ }).click();
    await walletFrame.getByRole('button', { name: '선택한 방식으로 계속' }).click();
  }
  await walletFrame.getByRole('heading', { name: /키움 고객 인증으로/ }).waitFor();
  await page.locator('.phone[data-shell-mode="focus"]').waitFor();
  if (await page.getByRole('navigation', { name: '키움 앱 기본 메뉴' }).count() !== 0) {
    throw new Error('Host root navigation must be hidden during a focused wallet flow.');
  }

  await walletFrame.getByRole('button', { name: '키움 인증 요청' }).click();
  const authenticationOverlay = page.locator('.host-security-layer');
  await authenticationOverlay.getByRole('heading', { name: /고객 확인이 필요해요/ }).waitFor();
  await authenticationOverlay.getByRole('button', { name: '기기 인증으로 확인' }).click();
  await walletFrame.getByRole('heading', { name: /새로 만들거나 기존 지갑을/ }).waitFor();
  await walletFrame.getByRole('button', { name: /새 지갑 만들기/ }).click();
  await walletFrame.getByRole('heading', { name: /실제 복구 구문을/ }).waitFor();
  await page.locator('.event-log').getByText('took-wss:host-auth-request').waitFor();
  await walletFrame.getByRole('button', { name: '키움 보안 화면 열기' }).click();
  const backupOverlay = page.locator('.host-security-layer');
  await backupOverlay.getByRole('heading', { name: /복구 구문을 안전한 곳에/ }).waitFor();
  const mnemonicWords = await backupOverlay.locator('.host-seed-word strong').allTextContents();
  if (mnemonicWords.length !== 12) throw new Error('Host key core did not present 12 recovery words.');
  await backupOverlay.getByRole('checkbox').check();
  await backupOverlay.getByRole('button', { name: '기록한 단어 확인하기' }).click();
  const confirmationLabels = backupOverlay.locator('.host-seed-confirmation label');
  for (let index = 0; index < await confirmationLabels.count(); index += 1) {
    const label = confirmationLabels.nth(index);
    const position = Number((await label.locator('span').innerText()).match(/^([0-9]+)번째/)?.[1]);
    const word = mnemonicWords[position - 1];
    if (!word) throw new Error('Invalid recovery-word confirmation position.');
    await label.locator('input').fill(word);
  }
  await backupOverlay.getByRole('button', { name: '복구 구문 확인' }).click();
  await walletFrame.getByRole('heading', { name: /2개 조건으로 내가 직접/ }).waitFor();
  await walletFrame.getByRole('checkbox').check();
  await walletFrame.getByRole('button', { name: hasExistingWallet ? '이 지갑 슬롯 추가하기' : '지갑 만들기' }).click();
  await page.locator('.event-log').getByText('took-wss:secure-sar-create-request').waitFor();
  await walletFrame.getByRole('heading', { name: '보유 자산', exact: true }).waitFor();
  await walletFrame.getByText(/지원 네트워크 9개/).waitFor();
  if (await walletFrame.getByTestId('wallet-address-group').count() !== 5) {
    throw new Error('Kiwoom wallet home must expose EVM plus four non-EVM address groups.');
  }
  if (await walletFrame.getByRole('button', { name: /주소 복사/ }).count() !== 5) {
    throw new Error('Every key-core-derived address group must be ready to copy.');
  }
  if (await walletFrame.getByTestId('wallet-chain-slot').count() !== 0) {
    throw new Error('Networks must not be rendered as wallet slots.');
  }
  await walletFrame.locator('.kw-wallet-selector').click();
  const selectorDialog = walletFrame.getByRole('dialog', { name: '지갑 선택' });
  if (await selectorDialog.locator('.kw-wallet-choice').count() < 1) throw new Error('The Super Wallet must contain at least one wallet slot.');
  await selectorDialog.getByRole('button', { name: '닫기' }).click();
  await walletFrame.getByText('K-VWAP 샌드박스 기준').waitFor();
  await page.locator('.phone[data-shell-mode="root"]').waitFor();
  await page.getByRole('navigation', { name: '키움 앱 기본 메뉴' }).waitFor();

  await walletFrame.getByRole('button', { name: '채우기' }).click();
  await page.locator('.phone[data-shell-mode="focus"]').waitFor();
  const tookReceiveDialog = walletFrame.getByRole('dialog', { name: '어떻게 받을까요?' });
  await tookReceiveDialog.waitFor();
  await tookReceiveDialog.getByRole('tab', { name: '툭받기', exact: true }).waitFor();
  await tookReceiveDialog.getByText('E2E 메시지', { exact: true }).waitFor();
  await tookReceiveDialog.getByRole('tab', { name: '주소로 받기', exact: true }).click();
  const receiveDialog = walletFrame.getByRole('dialog', { name: '받을 네트워크를 선택해 주세요' });
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
  await tookSendDialog.waitFor();
  await tookSendDialog.getByRole('tab', { name: '툭주기', exact: true }).waitFor();
  await tookSendDialog.getByRole('tab', { name: '주소로 보내기', exact: true }).click();
  const sendDialog = walletFrame.getByRole('dialog', { name: '보낼 네트워크를 선택해 주세요' });
  await sendDialog.getByRole('button', { name: /Bitcoin/ }).click();
  const bitcoinSendDialog = walletFrame.getByRole('dialog', { name: 'Bitcoin 주소로 보내기' });
  await bitcoinSendDialog.getByText('보낼 수 있는 잔액이 없어요').waitFor();
  if (!await bitcoinSendDialog.getByRole('button', { name: '보내기 준비 중' }).isDisabled()) {
    throw new Error('Send must remain disabled without balance, quote, KYT, and approval.');
  }
  await bitcoinSendDialog.getByRole('button', { name: '닫기' }).click();

  const viewportChecks = [];
  for (const width of [320, 360, 390, 430]) {
    await page.locator('.phone').evaluate((element, targetWidth) => {
      element.style.width = `${targetWidth + 20}px`;
      element.style.maxWidth = 'none';
    }, width);
    await iframe.waitForFunction((targetWidth) => window.innerWidth === targetWidth, width);
    const dimensions = await iframe.evaluate(() => ({
      viewportWidth: window.innerWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    if (dimensions.contentWidth > dimensions.viewportWidth) {
      throw new Error(`Wallet overflows horizontally (${dimensions.contentWidth}px > ${dimensions.viewportWidth}px) at ${width}px.`);
    }
    viewportChecks.push({ targetWidth: width, ...dimensions });
  }
  await page.locator('.phone').evaluate((element) => {
    element.style.width = '';
    element.style.maxWidth = '';
  });

  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.getByLabel('Tenant profile').selectOption('reference-bank');
  await page.locator('.phone[data-host-chrome="wss-reference-bank-v1"]').waitFor();
  await page.getByRole('button', { name: '은행앱에서 월렛 열기' }).click();
  await page.frameLocator('iframe').locator('h1, h2').filter({ hasText: /아직 지갑이 없습니다|Wallet portfolio/ }).first().waitFor();
  await page.locator('.event-log').getByText('took-wss:bootstrapped').waitFor();

  if (apiResponses.get('/v1/sessions') !== 201) throw new Error('Session API did not return 201.');
  if (apiResponses.get('/v1/runtime/bootstrap') !== 200) throw new Error('Bootstrap API did not return 200.');
  if (apiResponses.get('/v1/wallets/provision') !== 201) throw new Error('Wallet provisioning API did not return 201.');
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);

  console.log(JSON.stringify({
    status: 'ok',
    api: Object.fromEntries(apiResponses),
    walletViewports: viewportChecks,
    presentations: ['kiwoom-simple-mode-v1', 'wss-reference-bank-v1'],
    kiwoomHostChrome: chromeDimensions,
    kiwoomWalletFlow: {
      hostAuthentication: 'explicit-development-confirmation',
      walletSlots: 'at-least-one',
      walletAddressGroups: 5,
      selectedWalletNetworks: 9,
      valuation: 'K-VWAP sandbox',
      sarKeyCore: 'real-derivation-and-2-of-3-verification',
      receiveAddress: 'ready',
      send: 'disabled-without-balance',
    },
    screenshot: screenshotPath,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    browserErrors,
    api: Object.fromEntries(apiResponses),
    frames: page.frames().map((frame) => frame.url()),
    bridgeMessageTypes: await page.evaluate(() => window.__wssVerificationMessages.map((message) => message.type)),
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}
