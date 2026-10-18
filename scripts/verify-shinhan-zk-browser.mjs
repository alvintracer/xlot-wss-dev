import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({
  executablePath: process.env.WSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('Browser error:', error.message));
  page.on('requestfailed', (request) => console.error('Request failed:', request.url(), request.failure()?.errorText));
  await page.route('http://127.0.0.1:5173/zk-test', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<html><body></body></html>',
  }));
  await page.goto('http://127.0.0.1:5173/zk-test');
  const proofPath = fileURLToPath(new URL('../packages/identity-proof/src/browser.ts', import.meta.url));
  const result = await page.evaluate(async (path) => {
    const identity = await import(/* @vite-ignore */ `/@fs${path}`);
    const credentialId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const expectedName = '테스트사용자';
    const expectedBirthDate = '1990-04-18';
    const { commitment, opening } = identity.createIdentityCommitment(expectedName, expectedBirthDate);
    const proof = await identity.createIdentityEqualityProof({
      credentialId, nonce, commitment, opening, expectedName, expectedBirthDate,
    });
    return { scheme: proof.scheme, publicInputs: proof.publicInputs.length,
      valid: await identity.verifyIdentityEqualityProof({ credentialId, nonce, commitment, expectedName, expectedBirthDate, proof }) };
  }, proofPath);
  if (result.scheme !== 'noir-ultrahonk-v1' || result.publicInputs !== 112 || result.valid !== true) {
    throw new Error(`Browser ZK proof failed: ${JSON.stringify(result)}`);
  }
  console.log('Host browser generated and verified a Noir/UltraHonk identity proof.');
} finally { await browser.close(); }
