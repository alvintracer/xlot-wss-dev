import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  maskPhoneRecipient,
  normalizePhoneEscrowRecipient,
  phoneEscrowAddress,
  phoneEscrowUnavailableReason,
  senderPaysEscrowDeposit,
  supportsPhoneEscrow,
} from './phoneEscrowService';

describe('phone escrow policy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes only Korean mobile recipients and masks customer output', () => {
    expect(normalizePhoneEscrowRecipient('010-1234-5678')).toBe('01012345678');
    expect(normalizePhoneEscrowRecipient('+82 10 1234 5678')).toBe('01012345678');
    expect(maskPhoneRecipient('01012345678')).toBe('010-****-5678');
    expect(() => normalizePhoneEscrowRecipient('02-1234-5678')).toThrow();
  });

  it('solves sender-pays claim fees without reducing the requested receipt', () => {
    const quote = senderPaysEscrowDeposit(1_000_000n, 30n, 1_000n, 100n);
    expect(quote.escrowAmount - quote.claimFee).toBe(1_000_000n);
    expect(quote.claimFee).toBeGreaterThanOrEqual(1_100n);
  });

  it('fails closed until a WSS claim route is configured', () => {
    expect(supportsPhoneEscrow('ethereum')).toBe(false);
    expect(phoneEscrowUnavailableReason('ethereum')).toBe('휴대폰 번호로 보내기는 준비 중이에요.');
    expect(phoneEscrowUnavailableReason('solana')).toBe('이 네트워크에서는 아직 휴대폰 번호로 보낼 수 없어요.');
    vi.stubEnv('WSS_PHONE_ESCROW_EXECUTION_ENABLED', 'true');
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'https://wallet.example.com/c');
    vi.stubEnv('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS', '0x0000000000000000000000000000000000000001');
    expect(supportsPhoneEscrow('ethereum')).toBe(true);
    expect(phoneEscrowUnavailableReason('ethereum')).toBeUndefined();
    expect(supportsPhoneEscrow('base')).toBe(true);
    expect(supportsPhoneEscrow('bnb')).toBe(false);
    expect(supportsPhoneEscrow('solana')).toBe(false);
    expect(phoneEscrowAddress('polygon')).toMatch(/^0x[0-9A-Fa-f]{40}$/);
  });
});
