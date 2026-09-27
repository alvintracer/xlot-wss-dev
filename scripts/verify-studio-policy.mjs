import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const studioUrl = process.env.WSS_STUDIO_URL || 'http://127.0.0.1:5175';
const chromePath = process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WSS_STUDIO_SCREENSHOT_PATH || '/tmp/took-wss-studio-recovery-policy.png';

await access(chromePath);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const browserErrors = [];

page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text());
});

try {
  await page.goto(studioUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /새 WSS 프로젝트/ }).click();

  const sarPreferred = page.locator('[data-policy="sar-preferred"]');
  if (await sarPreferred.getAttribute('aria-checked') !== 'true') {
    throw new Error('New projects do not start with the recommended SAR policy.');
  }
  let preview = await page.getByTestId('manifest-preview').innerText();
  if (!preview.includes('"keyPolicyVersion": 1') || !preview.includes('"recoveryRequirement": "sar-preferred"')) {
    throw new Error('New-project policy v1 is not reflected in the manifest preview.');
  }

  await page.locator('[data-policy="provider-recovery-accepted"]').click();
  preview = await page.getByTestId('manifest-preview').innerText();
  if (!preview.includes('"keyPolicyVersion": 1')
    || !preview.includes('"defaultAdapter": "thirdweb-user-wallet"')
    || !preview.includes('"recoveryRequirement": "provider-recovery-accepted"')) {
    throw new Error('Provider recovery preset did not update the new-project manifest.');
  }
  if (await page.locator('[data-adapter-id="took-sar"] input').isChecked()) {
    throw new Error('Provider recovery preset unexpectedly kept SAR enabled.');
  }

  await page.getByRole('button', { name: /키움증권/ }).click();
  await page.locator('[data-policy="provider-recovery-accepted"]').click();
  preview = await page.getByTestId('manifest-preview').innerText();
  if (!preview.includes('"keyPolicyVersion": 2')) {
    throw new Error('Changing an existing tenant did not create the next policy version.');
  }

  await page.getByRole('button', { name: /새 WSS 프로젝트/ }).click();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(' | ')}`);

  console.log(JSON.stringify({
    status: 'ok',
    newProjectPolicyVersion: 1,
    existingProjectDraftPolicyVersion: 2,
    recoveryPolicies: ['sar-required', 'sar-preferred', 'provider-recovery-accepted'],
    screenshot: screenshotPath,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    browserErrors,
    visibleText: (await page.locator('body').innerText()).slice(0, 3000),
  }, null, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
