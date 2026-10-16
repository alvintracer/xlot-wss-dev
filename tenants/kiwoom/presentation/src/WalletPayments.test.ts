import { describe, expect, it } from 'vitest';
import { isOwnPaymentConfirmed, parsePaymentQr } from './WalletPayments';

describe('wallet POS QR parsing', () => {
  it('accepts only an app payment link from the current origin', () => {
    const id = '946bf62a-1b83-4ed7-8396-283f8eccca12';
    const origin = 'https://took-wss.com';
    expect(parsePaymentQr(`${origin}/namu/app#payment=${id}`, origin)).toBe(id);
    expect(parsePaymentQr(`${origin}/jb/app#payment=${id}`, origin)).toBe(id);
    expect(parsePaymentQr(`${origin}/pay/${id}`, origin)).toBe(id);
    expect(parsePaymentQr(`https://www.took-wss.com/pay/${id}`, origin)).toBe(id);
    expect(parsePaymentQr(`https://other.example/namu/app#payment=${id}`, origin)).toBeNull();
    expect(parsePaymentQr(`${origin}/namu/app#payment=invalid`, origin)).toBeNull();
    expect(parsePaymentQr(`${origin}/namu/app#claim=${id}`, origin)).toBeNull();
  });
});

describe('wallet POS QR completion', () => {
  it('does not present another device’s already used QR as this wallet’s payment', () => {
    expect(isOwnPaymentConfirmed('confirmed', undefined, false)).toBe(false);
    expect(isOwnPaymentConfirmed('confirmed', 'failed', false)).toBe(false);
  });

  it('shows completion after this wallet submits and the request is confirmed', () => {
    expect(isOwnPaymentConfirmed('confirmed', 'submitted', false)).toBe(true);
    expect(isOwnPaymentConfirmed('pending', 'confirmed', false)).toBe(false);
    expect(isOwnPaymentConfirmed('confirmed', undefined, true)).toBe(true);
  });
});
