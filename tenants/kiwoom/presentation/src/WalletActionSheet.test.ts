import { describe, expect, it } from 'vitest';
import { formatAtomic, parseAmountToAtomic, parseKrwToAtomic } from './WalletActionSheet';

describe('wallet transfer amount conversion', () => {
  it('converts token display amounts to exact atomic strings', () => {
    expect(parseAmountToAtomic('1.25', 6)).toBe('1250000');
    expect(parseAmountToAtomic('1.0000001', 6)).toBeNull();
    expect(parseAmountToAtomic('0', 6)).toBeNull();
  });

  it('converts KRW input with an exact decimal price without floating point math', () => {
    expect(parseKrwToAtomic('1,380', '1380', 6)).toBe('1000000');
    expect(parseKrwToAtomic('2,761', '1380.5', 6)).toBe('2000000');
    expect(parseKrwToAtomic('1000', undefined, 6)).toBeNull();
  });

  it('formats atomic values with bounded visible precision', () => {
    expect(formatAtomic(123456789n, 6)).toBe('123.456789');
    expect(formatAtomic(123456789n, 6, 2)).toBe('123.45');
  });
});
