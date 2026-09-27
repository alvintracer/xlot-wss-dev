import { RegistrationError, koreanPhoneNational } from './phoneRegistration.js';

interface SupabaseAuthUser {
  id?: unknown;
  phone?: unknown;
}

interface SupabaseVerifyPayload {
  access_token?: unknown;
  user?: SupabaseAuthUser;
}

export interface VerifiedSupabasePhone {
  accessToken: string;
  providerSubject: string;
  phone: string;
}

export class SupabasePhoneAuthClient {
  readonly #authUrl: string;
  readonly #publishableKey: string;
  readonly #fetcher: typeof fetch;

  constructor(
    supabaseUrl: string,
    publishableKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.#authUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
    this.#publishableKey = publishableKey;
    this.#fetcher = fetcher;
  }

  #headers(): Record<string, string> {
    return {
      apikey: this.#publishableKey,
      authorization: `Bearer ${this.#publishableKey}`,
      'content-type': 'application/json',
    };
  }

  async requestOtp(phone: string): Promise<void> {
    const response = await this.#fetcher(`${this.#authUrl}/otp`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        phone,
        create_user: true,
        data: { wss_phone_possession: true },
      }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new RegistrationError('challenge_rate_limited');
      throw new RegistrationError('phone_delivery_unavailable');
    }
  }

  async verifyOtp(phone: string, code: string): Promise<VerifiedSupabasePhone> {
    const response = await this.#fetcher(`${this.#authUrl}/verify`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ phone, token: code, type: 'sms' }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new RegistrationError('phone_challenge_blocked');
      if (response.status >= 500) throw new RegistrationError('phone_verification_unavailable');
      throw new RegistrationError('verification_code_mismatch');
    }
    const payload = await response.json() as SupabaseVerifyPayload;
    if (typeof payload.access_token !== 'string'
      || typeof payload.user?.id !== 'string'
      || typeof payload.user.phone !== 'string') {
      throw new RegistrationError('phone_verification_unavailable');
    }
    return {
      accessToken: payload.access_token,
      providerSubject: payload.user.id,
      phone: koreanPhoneNational(payload.user.phone),
    };
  }

  async revoke(accessToken: string): Promise<void> {
    await this.#fetcher(`${this.#authUrl}/logout?scope=global`, {
      method: 'POST',
      headers: {
        apikey: this.#publishableKey,
        authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => undefined);
  }
}
