import { describe, expect, it } from 'vitest';
import { extractBithumbWalletConnectUri, isBithumbWalletConnectProposal } from './bithumbWalletConnectPolicy';

const uri = `wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`;

describe('Bithumb WalletConnect boundary', () => {
  it('accepts the pairing formats used by the Bithumb MetaMask handoff', () => {
    expect(extractBithumbWalletConnectUri(uri)).toBe(uri);
    expect(extractBithumbWalletConnectUri(`https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`)).toBe(uri);
    expect(extractBithumbWalletConnectUri(`intent://wc?uri=${encodeURIComponent(uri)}#Intent;scheme=metamask;package=io.metamask;end;`)).toBe(uri);
  });
  it('rejects unrelated links and malformed requests', () => {
    expect(extractBithumbWalletConnectUri(`https://evil.example/wc?uri=${encodeURIComponent(uri)}`)).toBeNull();
    expect(extractBithumbWalletConnectUri(uri.replace('b'.repeat(64), 'bad'))).toBeNull();
  });
  it('accepts only HTTPS Bithumb proposal metadata', () => {
    expect(isBithumbWalletConnectProposal('https://m.bithumb.com/uhw/kyw/start')).toBe(true);
    expect(isBithumbWalletConnectProposal('https://bithumb.com.evil.example')).toBe(false);
    expect(isBithumbWalletConnectProposal('http://m.bithumb.com')).toBe(false);
  });
});
