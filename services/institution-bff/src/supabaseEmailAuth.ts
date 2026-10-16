import { RegistrationError } from './phoneRegistration.js';

interface EmailVerifyPayload {
  access_token?: unknown;
  user?: { id?: unknown; email?: unknown };
}

export class SupabaseEmailAuthClient {
  readonly #authUrl: string;
  readonly #publishableKey: string;
  readonly #fetcher: typeof fetch;

  constructor(supabaseUrl: string, publishableKey: string, fetcher: typeof fetch = fetch) {
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

  async requestOtp(email: string): Promise<void> {
    const response = await this.#fetcher(`${this.#authUrl}/otp`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new RegistrationError('challenge_rate_limited');
      throw new RegistrationError('email_delivery_unavailable');
    }
  }

  async verifyOtp(email: string, code: string): Promise<void> {
    const response = await this.#fetcher(`${this.#authUrl}/verify`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ email, token: code, type: 'email' }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new RegistrationError('email_challenge_blocked');
      if (response.status >= 500) throw new RegistrationError('email_verification_unavailable');
      throw new RegistrationError('verification_code_mismatch');
    }
    const payload = await response.json() as EmailVerifyPayload;
    if (typeof payload.access_token !== 'string'
      || typeof payload.user?.id !== 'string'
      || typeof payload.user.email !== 'string'
      || payload.user.email.toLowerCase() !== email) {
      throw new RegistrationError('email_verification_unavailable');
    }
    await this.#fetcher(`${this.#authUrl}/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: this.#publishableKey, authorization: `Bearer ${payload.access_token}` },
    }).catch(() => undefined);
  }
}
