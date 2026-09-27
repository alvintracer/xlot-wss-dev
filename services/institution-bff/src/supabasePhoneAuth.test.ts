import { describe, expect, it, vi } from 'vitest';
import { SupabasePhoneAuthClient } from './supabasePhoneAuth.js';

describe('Supabase phone Auth adapter', () => {
  it('requests an Auth-owned OTP without receiving the generated code', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new SupabasePhoneAuthClient('https://example.supabase.co', 'public-key', fetcher);
    await client.requestOtp('+821012345678');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/auth/v1/otp');
    expect(JSON.parse(String(init?.body))).toMatchObject({ phone: '+821012345678', create_user: true });
    expect(String(init?.body)).not.toContain('token');
  });

  it('accepts only a verified Auth response with a Korean phone and subject', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: 'verified-access-token',
      user: { id: 'auth-user-id', phone: '+821012345678' },
    }));
    const client = new SupabasePhoneAuthClient('https://example.supabase.co/', 'public-key', fetcher);
    await expect(client.verifyOtp('+821012345678', '123456')).resolves.toEqual({
      accessToken: 'verified-access-token',
      providerSubject: 'auth-user-id',
      phone: '01012345678',
    });
  });

  it('maps provider failures to non-sensitive registration errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"msg":"sensitive provider detail"}', { status: 400 }));
    const client = new SupabasePhoneAuthClient('https://example.supabase.co', 'public-key', fetcher);
    await expect(client.verifyOtp('+821012345678', '000000')).rejects.toThrow('verification_code_mismatch');
  });

  it('does not treat a provider outage as a wrong customer code', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: 503 }));
    const client = new SupabasePhoneAuthClient('https://example.supabase.co', 'public-key', fetcher);
    await expect(client.verifyOtp('+821012345678', '123456')).rejects.toThrow('phone_verification_unavailable');
  });
});
