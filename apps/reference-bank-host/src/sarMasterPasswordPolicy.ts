export interface SarMasterPasswordStrength {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  special: boolean;
  score: number;
  valid: boolean;
  level: 'danger' | 'warning' | 'safe';
}

export function sarMasterPasswordStrength(value: string): SarMasterPasswordStrength {
  const normalized = value.normalize('NFKC');
  const length = Array.from(normalized).length >= 8;
  const uppercase = /[A-Z]/.test(normalized);
  const lowercase = /[a-z]/.test(normalized);
  const special = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(normalized);
  const score = [length, uppercase, lowercase, special].filter(Boolean).length;
  return {
    length, uppercase, lowercase, special, score,
    valid: score === 4,
    level: score === 4 ? 'safe' : score >= 3 ? 'warning' : 'danger',
  };
}

export function sarMasterPasswordError(value: string): string | null {
  const strength = sarMasterPasswordStrength(value);
  if (!strength.length) return '마스터 비밀번호를 8자 이상 입력해 주세요.';
  if (!strength.uppercase || !strength.lowercase || !strength.special) {
    return '영문 대문자, 소문자, 특수문자를 모두 포함해 주세요.';
  }
  return null;
}
