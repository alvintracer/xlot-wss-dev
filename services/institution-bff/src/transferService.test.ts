import { afterEach, describe, expect, it, vi } from 'vitest';
import { isComplianceReviewSatisfied, screenRecipient, transferRecipientCompliance } from './transferService';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recipient KYT screening', () => {
  it('skips external KYT only for a server-verified own-wallet destination', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = {
      walletId: 'source-wallet', assetId: 'base:native', chainId: 'base',
      recipient: '0x0000000000000000000000000000000000000001', amountAtomic: '100',
      channel: 'address' as const, destinationWalletId: 'destination-wallet',
    };
    expect(await transferRecipientCompliance(request, {
      walletId: 'destination-wallet', address: request.recipient,
    })).toMatchObject({ status: 'allow', reasonRequired: false });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(transferRecipientCompliance(request)).rejects.toThrow('own_wallet_destination_invalid');
  });
  it('uses the WSS Supabase key when KYT falls back to the WSS project', async () => {
    vi.stubEnv('WSS_TOOK_KYT_URL', '');
    vi.stubEnv('SUPABASE_URL', 'https://wss.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'wss-anon-key');
    vi.stubEnv('WSS_TOOK_INFRA_ANON_KEY', 'other-project-key');
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      kytAvailable: true, riskLevel: 'LOW', riskScore: 0, isBlocked: false, isSanctioned: false, flags: [],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    expect(await screenRecipient('base', '0x0000000000000000000000000000000000000000', 0))
      .toMatchObject({ status: 'allow' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://wss.supabase.co/functions/v1/kyt-screen');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('apikey')).toBe('wss-anon-key');
  });

  it('keeps the separate infrastructure key for a separate KYT project', async () => {
    vi.stubEnv('WSS_TOOK_KYT_URL', 'https://infra.supabase.co/functions/v1/kyt-screen');
    vi.stubEnv('SUPABASE_URL', 'https://wss.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'wss-anon-key');
    vi.stubEnv('WSS_TOOK_INFRA_ANON_KEY', 'infra-anon-key');
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      kytAvailable: true, riskLevel: 'LOW', riskScore: 0, isBlocked: false, isSanctioned: false, flags: [],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    expect(await screenRecipient('base', '0x0000000000000000000000000000000000000000', 0))
      .toMatchObject({ status: 'allow' });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('apikey')).toBe('infra-anon-key');
  });

  it('logs a safe trace ID, target, and status when KYT rejects authentication', async () => {
    vi.stubEnv('WSS_TOOK_KYT_URL', '');
    vi.stubEnv('SUPABASE_URL', 'https://wss.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'wss-anon-key');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));

    expect(await screenRecipient('base', '0x0000000000000000000000000000000000000000', 0))
      .toMatchObject({ status: 'unavailable' });
    expect(warning).toHaveBeenCalledWith('wss_kyt_unavailable', expect.objectContaining({
      traceId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      target: 'wss-supabase',
      failure: 'http_401',
    }));
  });

  it('shows the provider date and category from the authenticated screening response', async () => {
    vi.stubEnv('WSS_TOOK_KYT_URL', 'https://kyt.example.test');
    vi.stubEnv('WSS_TOOK_INFRA_ANON_KEY', 'infra-anon-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      kytAvailable: true, riskLevel: 'CRITICAL', riskScore: 100, isBlocked: true,
      identifiedAt: '2026-05-23', riskCategory: '보이스피싱',
      flags: [{ description: '보이스피싱' }],
    }), { status: 200 })));
    const compliance = await screenRecipient('base', '0xad321e628c8b829fb979d85886ff0f8256a1d8ce', 0);
    expect(compliance).toMatchObject({
      status: 'block', identifiedAt: '2026-05-23', riskCategory: '보이스피싱',
    });
  });

  it('blocks sending when the KYT response is incomplete', async () => {
    vi.stubEnv('WSS_TOOK_KYT_URL', 'https://kyt.example.test');
    vi.stubEnv('WSS_TOOK_INFRA_ANON_KEY', 'infra-anon-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kytAvailable: true }), { status: 200 })));
    expect(await screenRecipient('base', '0xad321e628c8b829fb979d85886ff0f8256a1d8ce', 0))
      .toMatchObject({ status: 'unavailable' });
  });

  it('still requires a reason when the KYT decision requires one', () => {
    const review = { status: 'review' as const, reasonRequired: true, message: '확인이 필요해요.' };
    expect(isComplianceReviewSatisfied(review, '짧음')).toBe(false);
    expect(isComplianceReviewSatisfied(review, '거래 목적 확인')).toBe(true);
  });
});
