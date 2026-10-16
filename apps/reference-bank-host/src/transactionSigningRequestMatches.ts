import { isRecord, isSecureTransactionSigningRequest } from '@took-wss/contracts';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const members = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new Error('Invalid transaction signing payload.');
}

export function transactionSigningRequestMatches(
  verifiedRequest: unknown,
  walletRequest: SecureTransactionSigningRequest,
): verifiedRequest is SecureTransactionSigningRequest {
  if (!isSecureTransactionSigningRequest(verifiedRequest)
    || !isSecureTransactionSigningRequest(walletRequest)) return false;
  try {
    return canonicalJson(verifiedRequest) === canonicalJson(walletRequest);
  } catch {
    return false;
  }
}
