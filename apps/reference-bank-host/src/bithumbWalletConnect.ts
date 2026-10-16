import { Core } from '@walletconnect/core';
import { WalletKit, type WalletKitTypes } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { extractBithumbWalletConnectUri, isBithumbWalletConnectProposal } from './bithumbWalletConnectPolicy';

type Client = Awaited<ReturnType<typeof WalletKit.init>>;
type SignRequest = { walletId: string; address: string; message: string };
type Sign = (request: SignRequest) => Promise<string>;
type Binding = { walletId: string; address: string; sign: Sign; expiresAt: number };

const chains = new Set(['eip155:1', 'eip155:56', 'eip155:137', 'eip155:42161', 'eip155:43114', 'eip155:8453']);
const readMethods = ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'net_version', 'wallet_switchEthereumChain'];

// Bithumb's mobile verification page opens a MetaMask deep link that contains a
// WalletConnect v2 URI. The wallet pairs inside this app and signs only after the
// host's existing local SAR/thirdweb approval flow has authorized the request.
export class BithumbWalletConnect {
  private client: Client | null = null;
  private initialization: Promise<Client> | null = null;
  private pending: Binding | null = null;
  private sessions = new Map<string, Binding>();
  private closed = false;

  constructor(private readonly projectId: string) {}

  async pair(rawUri: string, walletId: string, address: string, sign: Sign): Promise<void> {
    if (this.closed) return;
    const uri = extractBithumbWalletConnectUri(rawUri);
    if (!uri) throw new Error('빗썸 지갑 연결 요청을 확인하지 못했어요.');
    if (!/^[a-f0-9]{32}$/i.test(this.projectId)) throw new Error('WalletConnect 프로젝트 설정이 필요해요.');
    if (!/^0x[a-f0-9]{40}$/i.test(address)) throw new Error('현재 월렛 주소를 확인하지 못했어요.');
    const client = await this.init();
    if (this.closed) return;
    await this.disconnectAll(client);
    this.pending = { walletId, address, sign, expiresAt: Date.now() + 120_000 };
    try { await client.pair({ uri }); }
    catch (error) { this.pending = null; throw error; }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending = null;
    if (this.client) await this.disconnectAll(this.client);
  }

  private async disconnectAll(client: Client): Promise<void> {
    this.sessions.clear();
    for (const topic of Object.keys(client.getActiveSessions())) {
      await client.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => undefined);
    }
  }

  private async init(): Promise<Client> {
    if (this.client) return this.client;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const core = new Core({ projectId: this.projectId, customStoragePrefix: 'took-wss-bithumb' });
      const client = await WalletKit.init({ core, metadata: {
        // Bithumb's personal-wallet verification explicitly selects MetaMask.
        // This metadata matches the exchange's selected wallet type, while the
        // customer signs with the selected WSS wallet inside the app.
        name: 'MetaMask Wallet', description: 'MetaMask Wallet Integration',
        url: 'https://metamask.io',
        icons: ['https://raw.githubusercontent.com/nicholasrossi0530/token-icons/main/metamask-fox.svg'],
      } });
      await this.disconnectAll(client); // Restored sessions have no trusted wallet binding.
      client.on('session_proposal', (event) => { void this.onProposal(client, event); });
      client.on('session_request', (event) => { void this.onRequest(client, event); });
      client.on('session_delete', (event) => { this.sessions.delete(event.topic); });
      this.client = client;
      return client;
    })();
    try { return await this.initialization; }
    catch (error) { this.initialization = null; throw error; }
  }

  private async onProposal(client: Client, event: WalletKitTypes.SessionProposal): Promise<void> {
    const binding = this.pending;
    const proposal = event.params;
    const required = proposal.requiredNamespaces ?? {};
    const optional = proposal.optionalNamespaces ?? {};
    const requestedChains = [...new Set([...(required.eip155?.chains ?? []), ...(optional.eip155?.chains ?? [])])];
    const requestedMethods = [...new Set([...(required.eip155?.methods ?? []), ...(optional.eip155?.methods ?? [])])];
    if (this.closed || !binding || binding.expiresAt < Date.now()
      || !isBithumbWalletConnectProposal(proposal.proposer.metadata.url)
      || Object.keys(required).some((namespace) => namespace !== 'eip155')
      || requestedChains.some((chain) => !chains.has(chain))
      || !requestedMethods.includes('personal_sign')) {
      await client.rejectSession({ id: event.id, reason: getSdkError('USER_REJECTED') });
      return;
    }
    const approvedChains = requestedChains.length ? requestedChains : ['eip155:1'];
    try {
      const namespaces = buildApprovedNamespaces({ proposal, supportedNamespaces: { eip155: {
        chains: approvedChains,
        accounts: approvedChains.map((chain) => `${chain}:${binding.address}`),
        methods: [...new Set([...requestedMethods, ...readMethods])],
        events: ['accountsChanged', 'chainChanged', 'connect', 'disconnect'],
      } } });
      const session = await client.approveSession({ id: event.id, namespaces });
      if (this.closed) { await client.disconnectSession({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') }); return; }
      this.sessions.set(session.topic, binding);
      this.pending = null;
    } catch {
      await client.rejectSession({ id: event.id, reason: getSdkError('USER_REJECTED') }).catch(() => undefined);
    }
  }

  private async onRequest(client: Client, event: WalletKitTypes.SessionRequest): Promise<void> {
    const binding = this.sessions.get(event.topic);
    const chain = event.params.chainId;
    const { method, params } = event.params.request;
    const answer = (result: unknown) => client.respondSessionRequest({ topic: event.topic,
      response: { id: event.id, jsonrpc: '2.0', result } });
    const deny = (message: string) => client.respondSessionRequest({ topic: event.topic,
      response: { id: event.id, jsonrpc: '2.0', error: { code: 4001, message } } });
    if (this.closed || !binding || !chains.has(chain) || !client.getActiveSessions()[event.topic]) {
      await deny('월렛 연결이 만료됐어요. 다시 연결해 주세요.'); return;
    }
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') { await answer([binding.address]); return; }
    if (method === 'eth_chainId') { await answer(`0x${Number(chain.split(':')[1]).toString(16)}`); return; }
    if (method === 'net_version') { await answer(chain.split(':')[1]); return; }
    if (method === 'wallet_switchEthereumChain') { await answer(null); return; }
    if (method !== 'personal_sign' || !Array.isArray(params) || typeof params[0] !== 'string'
      || params[0].length > 8192 || typeof params[1] !== 'string'
      || params[1].toLowerCase() !== binding.address.toLowerCase()) {
      await deny('지원하지 않는 지갑 요청이에요.'); return;
    }
    try { await answer(await binding.sign({ walletId: binding.walletId, address: binding.address, message: params[0] })); }
    catch { await deny('서명을 취소했거나 완료하지 못했어요.'); }
  }
}
