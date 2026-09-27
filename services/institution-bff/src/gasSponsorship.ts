import type { PreparedTransfer, WalletAssetView, WalletNetworkView } from '@took-wss/contracts';

const relayNetworkNames: Readonly<Record<string, string>> = {
  ethereum: 'Ethereum', polygon: 'Polygon', arbitrum: 'Arbitrum', base: 'Base', bnb: 'BSC',
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function quoteGasSponsorship(input: {
  asset: WalletAssetView;
  network: WalletNetworkView;
  amountDisplay: string;
}): Promise<PreparedTransfer['gasSponsorship']> {
  if (!input.asset.tokenAddress) {
    return {
      status: 'not-eligible',
      message: '기본 코인 전송은 네트워크 수수료가 필요해요. 지원 토큰은 가스비 지원을 자동으로 확인합니다.',
    };
  }
  const relayUrl = process.env.WSS_TOOK_PERMIT_RELAY_URL?.trim();
  const network = relayNetworkNames[input.network.chainId];
  if (!relayUrl || !network) {
    return { status: 'unavailable', message: '이 자산의 가스비 지원 여부를 확인할 수 없어요.' };
  }
  const apiKey = process.env.WSS_TOOK_INFRA_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  try {
    const response = await fetchWithTimeout(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        action: 'QUOTE',
        network,
        tokenAddress: input.asset.tokenAddress,
        amount: input.amountDisplay,
        feeMode: 'SENDER_PAYS',
      }),
    });
    const result = await response.json() as { success?: boolean; quote?: { fee?: string; debitAmount?: string } };
    if (!response.ok || !result.success || !result.quote?.fee || !result.quote.debitAmount) throw new Error('relay_quote_unavailable');
    return {
      status: 'eligible',
      method: 'evm-permit-relay',
      message: `가스비 지원 대상 자산이에요. 현재 보내기는 일반 네트워크 수수료 방식으로 준비되며, 릴레이 적용 시 예상 수수료는 ${result.quote.fee} ${input.asset.symbol}이에요.`,
    };
  } catch {
    return { status: 'unavailable', message: '가스비 지원 견적을 확인할 수 없어 일반 전송만 이용할 수 있어요.' };
  }
}
