import { describe, expect, it } from 'vitest';
import { isTrustedNativeDeviceRequest } from './nativeDeviceBridge';

const walletWindow = {} as Window;
const walletOrigin = 'https://www.took-wss.com';
const request = {
  type: 'took-wss:native-request',
  requestId: '9a841e18-36d6-4e2d-82a2-37457a762096',
  action: 'scan-card',
};

function event(source: Window | null, origin: string, data: unknown): MessageEvent {
  return { source, origin, data } as MessageEvent;
}

describe('native device bridge boundary', () => {
  it('accepts only a request from the signed wallet frame and exact origin', () => {
    expect(isTrustedNativeDeviceRequest(event(walletWindow, walletOrigin, request), walletWindow, walletOrigin)).toBe(true);
    expect(isTrustedNativeDeviceRequest(event({} as Window, walletOrigin, request), walletWindow, walletOrigin)).toBe(false);
    expect(isTrustedNativeDeviceRequest(event(walletWindow, 'https://evil.example', request), walletWindow, walletOrigin)).toBe(false);
  });

  it('rejects unknown actions and malformed request IDs', () => {
    expect(isTrustedNativeDeviceRequest(event(walletWindow, walletOrigin, { ...request, action: 'sign-card' }), walletWindow, walletOrigin)).toBe(false);
    expect(isTrustedNativeDeviceRequest(event(walletWindow, walletOrigin, { ...request, requestId: 'x' }), walletWindow, walletOrigin)).toBe(false);
  });
});
