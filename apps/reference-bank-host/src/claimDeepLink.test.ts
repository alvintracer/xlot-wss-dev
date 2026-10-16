import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearIncomingClaimCode, readIncomingClaimCode } from './claimDeepLink';

afterEach(() => vi.unstubAllGlobals());

describe('institution claim return link', () => {
  it('survives a provider redirect in this tab and clears after the flow closes', () => {
    const values = new Map<string, string>();
    const location = { hash: '#claim=AbCdEf123_-0', pathname: '/namu/app', search: '' };
    const replaceState = vi.fn((_state: unknown, _title: string, url: string) => { location.hash = ''; expect(url).toBe('/namu/app'); });
    vi.stubGlobal('window', {
      location,
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      history: { state: null, replaceState },
    });
    expect(readIncomingClaimCode('namu')).toBe('AbCdEf123_-0');
    location.hash = '#authResult=returned';
    expect(readIncomingClaimCode('namu')).toBe('AbCdEf123_-0');
    location.hash = '#claim=AbCdEf123_-0';
    clearIncomingClaimCode('namu');
    expect(readIncomingClaimCode('namu')).toBeNull();
    expect(replaceState).toHaveBeenCalledOnce();
  });

  it('rejects malformed and expired claim codes', () => {
    const values = new Map<string, string>([['took-wss:jb:pending-claim', JSON.stringify({ code: 'AbCdEf123_-0', savedAt: Date.now() - 31 * 60_000 })]]);
    vi.stubGlobal('window', {
      location: { hash: '#claim=invalid', pathname: '/jb/app', search: '' },
      sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn(), removeItem: vi.fn() },
    });
    expect(readIncomingClaimCode('jb')).toBeNull();
  });
});
