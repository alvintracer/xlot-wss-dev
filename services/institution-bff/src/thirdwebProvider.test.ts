import { Wallet } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueThirdwebWalletChallenge, thirdwebClientIdForTenant, verifyThirdwebWalletProof } from './thirdwebProvider.js';

afterEach(() => vi.unstubAllEnvs());

const challengeSecret = 'test-session-secret-with-at-least-32-characters';
const subjectHashSecret = 'test-subject-hash-secret-with-at-least-32-characters';
const verificationSecrets = { challengeSecret, subjectHashSecret };

function configure() {
  vi.stubEnv('WSS_THIRDWEB_CLIENT_ID', 'test-shared-client-id');
  vi.stubEnv('WSS_THIRDWEB_CLIENT_SECRET', 'test-shared-secret-key');
}

describe('thirdweb account verification', () => {
  it('shares a complete project across tenants and fails closed on incomplete overrides', () => {
    vi.stubEnv('WSS_THIRDWEB_CLIENT_ID', 'test-shared-client-id');
    expect(thirdwebClientIdForTenant('kiwoom')).toBeUndefined();
    configure();
    for (const tenantId of ['kiwoom', 'jb', 'namu']) {
      expect(thirdwebClientIdForTenant(tenantId)).toBe('test-shared-client-id');
    }
    vi.stubEnv('WSS_THIRDWEB_NAMU_CLIENT_ID', 'test-namu-client-id');
    expect(thirdwebClientIdForTenant('namu')).toBeUndefined();
    expect(thirdwebClientIdForTenant('jb')).toBe('test-shared-client-id');
    vi.stubEnv('WSS_THIRDWEB_NAMU_SECRET_KEY', 'test-namu-secret-key');
    expect(thirdwebClientIdForTenant('namu')).toBe('test-namu-client-id');
  });

  it('accepts a session-bound address signature and verified thirdweb email profile', async () => {
    configure();
    const wallet = Wallet.createRandom();
    const issued = issueThirdwebWalletChallenge({
      tenantId: 'kiwoom', sessionId: 'session-1', address: wallet.address,
    }, challengeSecret);
    const signature = await wallet.signMessage(issued.message);
    const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      expect(String(_url)).toContain(`address=${encodeURIComponent(wallet.address)}`);
      expect(options?.headers).toMatchObject({ 'x-secret-key': 'test-shared-secret-key' });
      expect(options?.headers).not.toHaveProperty('Authorization');
      return new Response(JSON.stringify({ result: { wallets: [{
        userId: 'thirdweb-user-1', address: wallet.address,
        profiles: [{ type: 'email', emailVerified: true }],
      }] } }), { status: 200 });
    });
    const verified = await verifyThirdwebWalletProof({
      tenantId: 'kiwoom', sessionId: 'session-1', address: wallet.address,
      challenge: issued.challenge, signature,
    }, verificationSecrets, request as typeof fetch);
    expect(verified.address).toBe(wallet.address);
    expect(verified.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(request).toHaveBeenCalledOnce();
    await expect(verifyThirdwebWalletProof({
      tenantId: 'kiwoom', sessionId: 'another-session', address: wallet.address,
      challenge: issued.challenge, signature,
    }, verificationSecrets, request as typeof fetch)).rejects.toThrow('provider_proof_invalid');
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects an address not owned by the signer and a thirdweb account without verified email', async () => {
    configure();
    const signer = Wallet.createRandom();
    const claimed = Wallet.createRandom();
    const issued = issueThirdwebWalletChallenge({
      tenantId: 'kiwoom', sessionId: 'session-2', address: claimed.address,
    }, challengeSecret);
    const signature = await signer.signMessage(issued.message);
    const request = vi.fn(async () => new Response(JSON.stringify({ result: { wallets: [{
      userId: 'thirdweb-user-2', address: claimed.address,
      profiles: [{ type: 'email', emailVerified: false }],
    }] } }), { status: 200 }));
    await expect(verifyThirdwebWalletProof({
      tenantId: 'kiwoom', sessionId: 'session-2', address: claimed.address,
      challenge: issued.challenge, signature,
    }, verificationSecrets, request as typeof fetch)).rejects.toThrow('provider_proof_invalid');
    expect(request).not.toHaveBeenCalled();
    const validSignature = await claimed.signMessage(issued.message);
    await expect(verifyThirdwebWalletProof({
      tenantId: 'kiwoom', sessionId: 'session-2', address: claimed.address,
      challenge: issued.challenge, signature: validSignature,
    }, verificationSecrets, request as typeof fetch)).rejects.toThrow('thirdweb_identity_mismatch');
  });

  it.each(['google', 'apple'])('accepts a signed wallet with a %s login profile', async (type) => {
    configure();
    const wallet = Wallet.createRandom();
    const issued = issueThirdwebWalletChallenge({
      tenantId: 'namu', sessionId: 'social-session', address: wallet.address,
    }, challengeSecret);
    const signature = await wallet.signMessage(issued.message);
    const request = vi.fn(async () => new Response(JSON.stringify({ result: { wallets: [{
      userId: `thirdweb-${type}-user`, address: wallet.address,
      profiles: [{ type, id: `social-${type}-id` }],
    }] } }), { status: 200 }));
    const verified = await verifyThirdwebWalletProof({
      tenantId: 'namu', sessionId: 'social-session', address: wallet.address,
      challenge: issued.challenge, signature,
    }, verificationSecrets, request as typeof fetch);
    expect(verified.address).toBe(wallet.address);
    expect(request).toHaveBeenCalledOnce();
  });
});
