import { Check, Copy, Wallet } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { WalletNetworkView } from '@took-wss/contracts';

interface WalletAddressListProps {
  networks: WalletNetworkView[];
}

interface WalletAddressGroup {
  id: string;
  label: string;
  networkNames: string[];
  address?: string;
  status: 'ready' | 'pending-core' | 'unavailable' | 'conflict';
}

const addressGroupLabels: Readonly<Record<string, string>> = {
  evm: 'EVM',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
  tron: 'TRON',
  xrp: 'XRP',
};

function groupWalletAddresses(networks: WalletNetworkView[]): WalletAddressGroup[] {
  const groups = new Map<string, WalletNetworkView[]>();
  for (const network of networks) {
    const group = groups.get(network.addressGroupId);
    if (group) group.push(network);
    else groups.set(network.addressGroupId, [network]);
  }

  return Array.from(groups, ([id, groupedNetworks]) => {
    const readyAddresses = new Set(groupedNetworks
      .filter((network) => network.addressStatus === 'ready' && network.address)
      .map((network) => network.address!));
    const address = readyAddresses.size === 1 ? readyAddresses.values().next().value : undefined;
    const status = readyAddresses.size > 1
      ? 'conflict'
      : address
        ? 'ready'
        : groupedNetworks.every((network) => network.addressStatus === 'unavailable')
          ? 'unavailable'
          : 'pending-core';
    return {
      id,
      label: addressGroupLabels[id] ?? groupedNetworks[0]?.network ?? id,
      networkNames: groupedNetworks.map((network) => network.network),
      address,
      status,
    };
  });
}

function shortenAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export function WalletAddressList({ networks }: WalletAddressListProps) {
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);
  const groups = groupWalletAddresses(networks);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const copyAddress = async (group: WalletAddressGroup) => {
    if (!group.address) return;
    try {
      await navigator.clipboard.writeText(group.address);
      setCopiedGroupId(group.id);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopiedGroupId(null), 1_500);
    } catch {
      setCopiedGroupId(null);
    }
  };

  return (
    <section className="kw-wallet-addresses" aria-labelledby="kw-wallet-addresses-title">
      <div className="kw-wallet-addresses__heading">
        <div>
          <h3 id="kw-wallet-addresses-title">지갑 주소</h3>
          <p>EVM 호환 네트워크는 하나의 주소를 함께 사용해요.</p>
        </div>
        <span>{groups.length}개</span>
      </div>
      <div className="kw-wallet-address-list">
        {groups.map((group) => {
          const copied = copiedGroupId === group.id;
          const statusLabel = group.status === 'pending-core'
            ? '주소 생성 대기'
            : group.status === 'conflict'
              ? '주소 확인 필요'
              : '지원하지 않음';
          return (
            <article className="kw-wallet-address-row" data-testid="wallet-address-group" key={group.id}>
              <span className="kw-wallet-address-row__icon" aria-hidden="true"><Wallet /></span>
              <div className="kw-wallet-address-row__copy">
                <strong>{group.label}</strong>
                <small>{group.networkNames.join(' · ')}</small>
                {group.address ? <code title={group.address}>{shortenAddress(group.address)}</code> : <em>{statusLabel}</em>}
              </div>
              {group.address ? (
                <button type="button" aria-label={`${group.label} 주소 복사`} onClick={() => void copyAddress(group)}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
