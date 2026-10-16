import { describe, expect, it } from 'vitest';
import { appPinScope } from './appPin';

function token(tenantId: string, subject: string, nonce: string): string {
  return `header.${btoa(JSON.stringify({ tenantId, subject, nonce }))}.signature`;
}

describe('institution app PIN namespace', () => {
  const subject = 'A'.repeat(43);

  it('survives a session renewal for the same customer and institution', () => {
    expect(appPinScope('namu', token('namu', subject, 'first')))
      .toBe(appPinScope('namu', token('namu', subject, 'renewed')));
  });

  it('keeps different institutions and customers separate', () => {
    expect(appPinScope('jb', token('jb', subject, 'one')))
      .not.toBe(appPinScope('namu', token('namu', subject, 'one')));
    expect(appPinScope('namu', token('namu', subject, 'one')))
      .not.toBe(appPinScope('namu', token('namu', 'B'.repeat(43), 'one')));
  });

  it('rejects a missing or mismatched institution session', () => {
    expect(() => appPinScope('kiwoom', null)).toThrow('app_pin_session_unavailable');
    expect(() => appPinScope('kiwoom', token('namu', subject, 'one'))).toThrow('app_pin_session_unavailable');
  });
});
