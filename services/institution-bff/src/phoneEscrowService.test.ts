import { afterEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';
import {
  isMatchingPhoneEscrowReceipt,
  maximumPhoneEscrowRecipient,
  maskPhoneRecipient,
  normalizePhoneEscrowRecipient,
  phoneEscrowAddress,
  phoneEscrowAssetLimit,
  phoneEscrowClaimUrl,
  phoneEscrowUnavailableReason,
  preparePhoneEscrow,
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

  it('keeps the maximum recipient amount inside the balance and pilot cap', () => {
    const available = 1_000_000n;
    const max = maximumPhoneEscrowRecipient(available, 30n, 1_000n, 100n);
    expect(senderPaysEscrowDeposit(max, 30n, 1_000n, 100n).escrowAmount).toBeLessThanOrEqual(available);
    expect(senderPaysEscrowDeposit(max + 1n, 30n, 1_000n, 100n).escrowAmount).toBeGreaterThan(available);
    expect(maximumPhoneEscrowRecipient(available, 30n, 1_000n, 100n, 500_000n)).toBe(500_000n);
    expect(maximumPhoneEscrowRecipient(0n, 30n, 1_000n, 100n)).toBe(0n);
  });

  it('accepts only the prepared escrow deposit receipt', () => {
    const escrowAddress = '0x0000000000000000000000000000000000000001';
    const senderAddress = '0x0000000000000000000000000000000000000002';
    const tokenAddress = '0x0000000000000000000000000000000000000003';
    const commitment = `0x${'a'.repeat(64)}`;
    const iface = new ethers.Interface(['event Deposited(bytes32 indexed commitment,address indexed sender,uint256 amount,address token)']);
    const event = iface.encodeEventLog(iface.getEvent('Deposited')!, [commitment, senderAddress, 1_020_000n, tokenAddress]);
    const reference = { commitment, escrowAddress, senderAddress, tokenAddress, amountAtomic: '1020000' };
    const receipt = { status: 1, to: escrowAddress, logs: [{ address: escrowAddress, ...event }] };
    expect(isMatchingPhoneEscrowReceipt(receipt as never, reference)).toBe(true);
    expect(isMatchingPhoneEscrowReceipt(receipt as never, { ...reference, amountAtomic: '1020001' })).toBe(false);
    expect(isMatchingPhoneEscrowReceipt(receipt as never, { ...reference, senderAddress: tokenAddress })).toBe(false);
    expect(isMatchingPhoneEscrowReceipt({ ...receipt, logs: [{ address: senderAddress, ...event }] } as never, reference)).toBe(false);
  });

  it('fails closed until a WSS claim route is configured', () => {
    const ethereumUsdc = 'ethereum:evm-erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    expect(supportsPhoneEscrow('ethereum', ethereumUsdc)).toBe(false);
    expect(phoneEscrowUnavailableReason('ethereum', ethereumUsdc)).toBe('휴대폰 번호로 보내기는 준비 중이에요.');
    expect(phoneEscrowUnavailableReason('solana', 'solana:native')).toBe('이 네트워크에서는 아직 휴대폰 번호로 보낼 수 없어요.');
    vi.stubEnv('WSS_PHONE_ESCROW_EXECUTION_ENABLED', 'true');
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'https://wallet.example.com/c');
    vi.stubEnv('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS', '0x0000000000000000000000000000000000000001');
    expect(supportsPhoneEscrow('ethereum', ethereumUsdc)).toBe(true);
    expect(phoneEscrowUnavailableReason('ethereum', ethereumUsdc)).toBeUndefined();
    expect(supportsPhoneEscrow('base', 'base:native')).toBe(true);
    expect(supportsPhoneEscrow('bnb', 'bnb:native')).toBe(false);
    expect(supportsPhoneEscrow('solana', 'solana:native')).toBe(false);
    expect(phoneEscrowAddress('polygon')).toMatch(/^0x[0-9A-Fa-f]{40}$/);
  });

  it('uses asset-specific payout caps on the eight supported chain and asset pairs', () => {
    const usdc = [
      ['ethereum', 'ethereum:evm-erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      ['polygon', 'polygon:evm-erc20:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'],
      ['arbitrum', 'arbitrum:evm-erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831'],
      ['base', 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
    ] as const;
    for (const [chain, asset] of usdc) {
      expect(phoneEscrowAssetLimit(chain, asset)).toBe(100_000_000n);
      expect(maximumPhoneEscrowRecipient(200_000_000n, 30n, 0n, 0n, phoneEscrowAssetLimit(chain, asset))).toBe(100_000_000n);
    }
    for (const chain of ['ethereum', 'arbitrum', 'base']) {
      expect(phoneEscrowAssetLimit(chain, `${chain}:native`)).toBe(100_000_000_000_000_000n);
    }
    expect(phoneEscrowAssetLimit('polygon', 'polygon:native')).toBe(100_000_000_000_000_000_000n);
    expect(maximumPhoneEscrowRecipient(
      200_000_000_000_000_000_000n, 30n, 0n, 0n,
      phoneEscrowAssetLimit('polygon', 'polygon:native'),
    )).toBe(100_000_000_000_000_000_000n);
    expect(phoneEscrowAssetLimit('ethereum', 'ethereum:evm-erc20:0xdac17f958d2ee523a2206206994597c13d831ec7')).toBeUndefined();
    expect(phoneEscrowAssetLimit('ethereum', 'ethereum:evm-erc20:0x0000000000000000000000000000000000000001')).toBeUndefined();
  });

  it('rejects an amount above the asset cap before making an RPC request', async () => {
    vi.stubEnv('WSS_PHONE_ESCROW_EXECUTION_ENABLED', 'true');
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'https://wallet.example.com/c');
    vi.stubEnv('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS', '0x0000000000000000000000000000000000000001');
    await expect(preparePhoneEscrow({
      network: { address: '0x0000000000000000000000000000000000000002', addressStatus: 'ready' } as never,
      asset: {
        chainId: 'ethereum', assetId: 'ethereum:native', symbol: 'ETH', decimals: 18,
      } as never,
      recipient: '01012345678', recipientAmount: 100_000_000_000_000_001n,
      available: 1_000_000_000_000_000_000n, nativeAvailable: 1_000_000_000_000_000_000n,
      rpcUrl: 'http://127.0.0.1:1', evmChainId: 1,
    })).rejects.toThrow('phone_escrow_pilot_limit');
    await expect(preparePhoneEscrow({
      network: { address: '0x0000000000000000000000000000000000000002', addressStatus: 'ready' } as never,
      asset: { chainId: 'polygon', assetId: 'polygon:native', symbol: 'POL', decimals: 18 } as never,
      recipient: '01012345678', recipientAmount: 100_000_000_000_000_000_001n,
      available: 200_000_000_000_000_000_000n, nativeAvailable: 200_000_000_000_000_000_000n,
      rpcUrl: 'http://127.0.0.1:1', evmChainId: 137,
    })).rejects.toThrow('phone_escrow_pilot_limit');
  });

  it('limits the pilot to explicitly listed assets', () => {
    vi.stubEnv('WSS_PHONE_ESCROW_EXECUTION_ENABLED', 'true');
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'https://wallet.example.com/c');
    vi.stubEnv('WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS', '0x0000000000000000000000000000000000000001');
    vi.stubEnv('WSS_PHONE_ESCROW_ALLOWED_ASSET_IDS', 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913,polygon:native');
    expect(supportsPhoneEscrow('base', 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe(true);
    expect(supportsPhoneEscrow('base', 'base:native')).toBe(false);
    expect(supportsPhoneEscrow('polygon', 'polygon:native')).toBe(true);
    expect(supportsPhoneEscrow('ethereum', 'ethereum:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WSS_PHONE_ESCROW_ALLOWED_ASSET_IDS', '');
    expect(supportsPhoneEscrow('base', 'base:evm-erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe(false);
  });

  it('creates only a configured, opaque claim link', () => {
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'https://wallet.example.com/c');
    expect(phoneEscrowClaimUrl('Abcdef123_-4')).toBe('https://wallet.example.com/c/Abcdef123_-4');
    expect(phoneEscrowClaimUrl('../invalid')).toBeUndefined();
    vi.stubEnv('WSS_PHONE_CLAIM_BASE_URL', 'http://wallet.example.com/c');
    expect(phoneEscrowClaimUrl('Abcdef123_-4')).toBeUndefined();
  });
});
