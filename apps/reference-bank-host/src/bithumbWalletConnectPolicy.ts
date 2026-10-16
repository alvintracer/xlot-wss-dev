export function extractBithumbWalletConnectUri(raw: string): string | null {
  if (raw.length > 4096) return null;
  let uri = raw;
  if (!uri.startsWith('wc:')) {
    try {
      const link = new URL(uri);
      const allowed = (link.protocol === 'https:' && link.hostname === 'metamask.app.link')
        || (link.protocol === 'metamask:' && link.hostname === 'wc')
        || (link.protocol === 'intent:' && link.hostname === 'wc');
      if (!allowed) return null;
      uri = link.searchParams.get('uri') ?? '';
    } catch { return null; }
  }
  if (uri.toLowerCase().startsWith('wc%3a')) {
    try { uri = decodeURIComponent(uri); } catch { return null; }
  }
  const match = /^wc:[a-f0-9]{16,128}@2\?(.+)$/i.exec(uri);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  if (params.getAll('relay-protocol').length !== 1 || !/^[a-z0-9-]+$/i.test(params.get('relay-protocol') ?? '')
    || params.getAll('symKey').length !== 1 || !/^[a-f0-9]{64}$/i.test(params.get('symKey') ?? '')) return null;
  return uri;
}

export function isBithumbWalletConnectProposal(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'bithumb.com' || parsed.hostname.endsWith('.bithumb.com'));
  } catch { return false; }
}
