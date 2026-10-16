import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { buildCoinoneBrowserBootstrap, buildExchangeRouterScript, exchangeStartUrls, isExchangeUrlAllowed } from './exchangeRouter';

const settings = {
  exchange: 'coinone' as const,
  exchangeName: '코인원',
  allowedHost: 'coinone.co.kr',
  address: '0x000000000000000000000000000000000000dEaD',
  walletLabel: '나무 월렛 1',
  brandName: '나무 월렛',
  brandIcon: 'data:image/png;base64,AA==',
  color: '#84c43d',
  ink: '#111619',
  primaryInk: '#102f18',
  fontFamily: 'Nanum Gothic, sans-serif',
};

describe('exchange router boundary', () => {
  it('starts Coinone at the address book instead of a tax page', () => {
    expect(exchangeStartUrls.coinone).toBe('https://coinone.co.kr/balance/transfer/withdrawal-address');
  });

  it('rejects non-HTTPS, deceptive subdomains, and other exchanges', () => {
    expect(isExchangeUrlAllowed('https://coinone.co.kr/user/login/email/', 'coinone.co.kr')).toBe(true);
    expect(isExchangeUrlAllowed('https://www.coinone.co.kr/', 'coinone.co.kr')).toBe(true);
    expect(isExchangeUrlAllowed('http://coinone.co.kr/', 'coinone.co.kr')).toBe(false);
    expect(isExchangeUrlAllowed('https://coinone.co.kr.attacker.example/', 'coinone.co.kr')).toBe(false);
    expect(isExchangeUrlAllowed('https://bithumb.com/', 'coinone.co.kr')).toBe(false);
  });

  it('leaves an unrelated page untouched even if the injected script is evaluated there', () => {
    const script = buildExchangeRouterScript(settings);
    expect(() => runInNewContext(script, { location: { protocol: 'https:', hostname: 'coinone.co.kr.attacker.example' } })).not.toThrow();
    expect(() => runInNewContext(script, { location: { protocol: 'http:', hostname: 'coinone.co.kr' } })).not.toThrow();
  });

  it('rejects a malformed public address before creating a browser script', () => {
    expect(() => buildExchangeRouterScript({ ...settings, address: 'not-an-address' })).toThrow('EVM');
  });

  it('provides the selected address and desktop browser signals only on the Coinone address book', async () => {
    const navigator = { userAgent: 'Android Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 };
    const browser = {
      addEventListener() {}, matchMedia: () => ({ matches: true }), setTimeout: (callback: () => void) => { callback(); return 1; }, chrome: undefined as unknown,
    } as Record<string, unknown>;
    const context = { location: { protocol: 'https:', hostname: 'coinone.co.kr', pathname: '/balance/transfer/withdrawal-address' },
      navigator, window: browser, crypto: { randomUUID: () => 'c8411551-18d2-4871-8045-965352f3a7fa' } };
    runInNewContext(buildCoinoneBrowserBootstrap(settings.address), context);
    expect(navigator.userAgent).toContain('Macintosh');
    const provider = browser.ethereum as { isMetaMask: boolean; request: (input: { method: string }) => Promise<unknown> };
    expect(provider.isMetaMask).toBe(true);
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([settings.address]);
    expect(await provider.request({ method: 'wallet_requestPermissions' })).toEqual([{
      parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [settings.address] }],
    }]);
    const mobileNavigator = { userAgent: 'Android Mobile' };
    const mobileWindow = {} as Record<string, unknown>;
    runInNewContext(buildCoinoneBrowserBootstrap(settings.address), {
      location: { protocol: 'https:', hostname: 'coinone.co.kr', pathname: '/daily-avg-price' },
      navigator: mobileNavigator, window: mobileWindow,
    });
    expect(mobileNavigator.userAgent).toBe('Android Mobile');
    expect(mobileWindow.ethereum).toBeUndefined();
  });

  it('keeps injected helper references valid after production minification', () => {
    const source = readFileSync(new URL('./exchangeRouter.ts', import.meta.url), 'utf8');
    const compiled = transformSync(source, { loader: 'ts', format: 'cjs', minify: true }).code;
    const module = { exports: {} as { buildExchangeRouterScript: typeof buildExchangeRouterScript } };
    runInNewContext(compiled, { module, exports: module.exports });
    const script = module.exports.buildExchangeRouterScript(settings);
    const browser = { addEventListener() {}, matchMedia: () => ({ matches: true }) };
    expect(() => runInNewContext(script, {
      location: { protocol: 'https:', hostname: 'coinone.co.kr', pathname: '/balance/transfer/withdrawal-address' },
      navigator: { userAgent: 'Android Mobile' }, window: browser,
      document: { createElement: () => { throw new Error('MOUNT_REACHED'); } },
    })).toThrow('MOUNT_REACHED');
  });
});
