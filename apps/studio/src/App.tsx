import { useMemo, useState } from 'react';
import { Check, CheckCircle, CirclesFour, Cube, Database, Key, Plus, WarningCircle } from '@phosphor-icons/react';
import {
  assertTenantManifest,
  type KeyAdapterId,
  type RecoveryRequirement,
  type TenantManifest,
  type WssModuleId,
} from '@took-wss/contracts';
import { KEY_ADAPTERS, KEY_POLICY_PRESETS } from '@took-wss/key-adapters';
import { WSS_MODULES, validateModuleSelection } from '@took-wss/module-registry';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { referenceBankManifest } from '@took-wss/tenant-reference-bank';

const keyAdapterIds = Object.keys(KEY_ADAPTERS) as KeyAdapterId[];
const recoveryRequirements = Object.keys(KEY_POLICY_PRESETS) as RecoveryRequirement[];

const newProjectManifest = assertTenantManifest({
  schemaVersion: 1,
  tenantId: 'new-wss-project',
  slug: 'new-wss-wallet',
  institutionName: '새 금융사',
  walletName: '디지털 월렛',
  environment: 'sandbox',
  deploymentMode: 'saas',
  presentation: {
    profileId: 'wss-reference-bank-v1',
    guideVersion: '1.0.0',
    rootHeaderOwner: 'host',
    rootNavigationOwner: 'host',
    safeAreaOwner: 'host',
    navigation: {
      rootEntry: 'host-tabs',
      focusedFlow: 'hide-host-chrome',
      walletMenu: 'none',
    },
  },
  brand: {
    logoText: 'WSS',
    primaryColor: '#111111',
    accentColor: '#FF2B00',
    surfaceColor: '#F3F3EE',
    textColor: '#0A0A0A',
    radius: 'soft',
  },
  identity: {
    onboardingMode: 'institution-first',
    phoneVerification: 'host',
    consentVersion: 'new-wss-wallet-profile-v1',
  },
  enabledModules: ['wallet-home', 'sar-recovery'],
  keyManagement: {
    policyVersion: 1,
    recoveryRequirement: 'sar-preferred',
    defaultAdapter: 'took-sar',
    allowedAdapters: ['took-sar', 'thirdweb-user-wallet', 'fsl-mpc'],
  },
  providers: { execution: 'took-router', compliance: 'mock', quote: 'mock' },
  chains: ['ethereum', 'base', 'solana'],
} satisfies TenantManifest);

const templates = {
  'new-project': newProjectManifest,
  kiwoom: kiwoomManifest,
  'reference-bank': referenceBankManifest,
} as const;
type TemplateId = keyof typeof templates;

function cloneManifest(manifest: TenantManifest): TenantManifest {
  return JSON.parse(JSON.stringify(manifest)) as TenantManifest;
}

function sameAdapters(left: readonly KeyAdapterId[], right: readonly KeyAdapterId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function policyVersionForChange(templateId: TemplateId, current: TenantManifest): number {
  if (templateId === 'new-project') return 1;
  return Math.max(current.keyManagement.policyVersion, templates[templateId].keyManagement.policyVersion + 1);
}

function canToggleAdapter(manifest: TenantManifest, id: KeyAdapterId): boolean {
  const { recoveryRequirement, allowedAdapters } = manifest.keyManagement;
  if (recoveryRequirement === 'sar-required') return false;
  if (recoveryRequirement === 'sar-preferred' && id === 'took-sar') return false;
  if (recoveryRequirement === 'provider-recovery-accepted' && id !== 'took-sar') {
    const enabledProviders = allowedAdapters.filter((adapterId) => adapterId !== 'took-sar');
    if (allowedAdapters.includes(id) && enabledProviders.length === 1) return false;
  }
  return true;
}

function canSetDefaultAdapter(manifest: TenantManifest, id: KeyAdapterId): boolean {
  if (!manifest.keyManagement.allowedAdapters.includes(id)) return false;
  if (manifest.keyManagement.recoveryRequirement === 'sar-required') return id === 'took-sar';
  if (manifest.keyManagement.recoveryRequirement === 'sar-preferred') return id === 'took-sar';
  return true;
}

export function App() {
  const [templateId, setTemplateId] = useState<TemplateId>('kiwoom');
  const [draft, setDraft] = useState<TenantManifest>(() => cloneManifest(kiwoomManifest));
  const [exported, setExported] = useState(false);
  const errors = useMemo(() => {
    const nextErrors = validateModuleSelection(draft.enabledModules);
    try {
      assertTenantManifest(draft);
    } catch (error) {
      nextErrors.push(error instanceof Error ? error.message : 'Manifest policy is invalid.');
    }
    return nextErrors;
  }, [draft]);

  const loadTemplate = (id: TemplateId) => {
    setTemplateId(id);
    setDraft(cloneManifest(templates[id]));
    setExported(false);
  };

  const setRecoveryRequirement = (requirement: RecoveryRequirement) => {
    setDraft((current) => {
      const preset = KEY_POLICY_PRESETS[requirement];
      if (current.keyManagement.recoveryRequirement === requirement
        && current.keyManagement.defaultAdapter === preset.defaultAdapter
        && sameAdapters(current.keyManagement.allowedAdapters, preset.allowedAdapters)) return current;

      const enabledModules: WssModuleId[] = current.enabledModules.filter((id) => id !== 'sar-recovery');
      if (preset.sarRecoveryEnabled) enabledModules.push('sar-recovery');
      return {
        ...current,
        enabledModules,
        keyManagement: {
          policyVersion: policyVersionForChange(templateId, current),
          recoveryRequirement: requirement,
          defaultAdapter: preset.defaultAdapter,
          allowedAdapters: [...preset.allowedAdapters],
        },
      };
    });
    setExported(false);
  };

  const toggleAdapter = (id: KeyAdapterId) => {
    setDraft((current) => {
      if (!canToggleAdapter(current, id)) return current;
      const currentlyAllowed = current.keyManagement.allowedAdapters.includes(id);
      const allowedAdapters = currentlyAllowed
        ? current.keyManagement.allowedAdapters.filter((adapterId) => adapterId !== id)
        : [...current.keyManagement.allowedAdapters, id];
      if (allowedAdapters.length === 0) return current;

      const enabledModules: WssModuleId[] = current.enabledModules.filter((moduleId) => moduleId !== 'sar-recovery');
      if (allowedAdapters.includes('took-sar')) enabledModules.push('sar-recovery');
      const defaultAdapter = allowedAdapters.includes(current.keyManagement.defaultAdapter)
        ? current.keyManagement.defaultAdapter
        : allowedAdapters[0]!;

      return {
        ...current,
        enabledModules,
        keyManagement: {
          ...current.keyManagement,
          policyVersion: policyVersionForChange(templateId, current),
          defaultAdapter,
          allowedAdapters,
        },
      };
    });
    setExported(false);
  };

  const setDefaultAdapter = (id: KeyAdapterId) => {
    setDraft((current) => {
      if (!canSetDefaultAdapter(current, id) || current.keyManagement.defaultAdapter === id) return current;
      return {
        ...current,
        keyManagement: {
          ...current.keyManagement,
          policyVersion: policyVersionForChange(templateId, current),
          defaultAdapter: id,
        },
      };
    });
    setExported(false);
  };

  const toggleModule = (id: WssModuleId) => {
    if (id === 'wallet-home' || id === 'sar-recovery') return;
    setDraft((current) => ({
      ...current,
      enabledModules: current.enabledModules.includes(id)
        ? current.enabledModules.filter((moduleId) => moduleId !== id)
        : [...current.enabledModules, id],
    }));
    setExported(false);
  };

  const exportManifest = () => {
    if (errors.length > 0) return;
    const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.slug}.manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };

  return (
    <main className="studio-shell">
      <aside>
        <div className="studio-brand"><span>WSS</span><strong>Studio</strong></div>
        <nav aria-label="Studio sections">
          <button className="active" type="button"><CirclesFour size={18} />Product Composer</button>
          <button type="button"><Key size={18} />Key Policy</button>
          <button type="button"><Database size={18} />Providers</button>
          <button type="button"><Cube size={18} />Deployment</button>
        </nav>
        <div className="studio-state"><CheckCircle size={17} weight="fill" /><div><strong>Independent workspace</strong><span>Consumer took imports: 0</span></div></div>
      </aside>

      <section className="workspace">
        <header>
          <div><span>Institutional Wallet Service Layer</span><h1>Product Composer</h1></div>
          <div className={`validation ${errors.length === 0 ? 'valid' : 'invalid'}`}>
            {errors.length === 0 ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} weight="fill" />}
            {errors.length === 0 ? 'Manifest valid' : `${errors.length} policy errors`}
          </div>
        </header>

        <div className="template-switcher" aria-label="프로젝트 시작점">
          {(Object.keys(templates) as TemplateId[]).map((id) => (
            <button className={templateId === id ? 'selected' : ''} type="button" key={id} onClick={() => loadTemplate(id)}>
              <span>{id === 'new-project' ? <Plus size={15} weight="bold" /> : null}{id === 'new-project' ? '새 WSS 프로젝트' : templates[id].institutionName}</span>
              <strong>{id === 'new-project' ? 'New project' : id === 'kiwoom' ? 'First tenant' : 'Generic reference'}</strong>
            </button>
          ))}
        </div>

        <div className="content-grid">
          <section className="editor-card">
            <div className="card-heading">
              <div><span>01</span><div><strong>Recovery & key policy</strong><p>신규 지갑에 적용할 복구 원칙과 허용 방식을 선택합니다.</p></div></div>
              <em>POLICY V{draft.keyManagement.policyVersion}</em>
            </div>

            <div className="recovery-policy-grid" role="radiogroup" aria-label="복구 정책">
              {recoveryRequirements.map((requirement) => {
                const preset = KEY_POLICY_PRESETS[requirement];
                const selected = draft.keyManagement.recoveryRequirement === requirement;
                return (
                  <button
                    className={selected ? 'selected' : ''}
                    data-policy={requirement}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    key={requirement}
                    onClick={() => setRecoveryRequirement(requirement)}
                  >
                    <span>{selected ? <Check size={13} weight="bold" /> : null}</span>
                    <strong>{preset.label}</strong>
                    <small>{preset.description}</small>
                  </button>
                );
              })}
            </div>

            <div className="adapter-section-heading">
              <strong>허용 키 관리 방식</strong>
              <span>기본값은 신규 지갑에만 적용됩니다.</span>
            </div>
            <div className="adapter-grid">
              {keyAdapterIds.map((id) => {
                const adapter = KEY_ADAPTERS[id];
                const enabled = draft.keyManagement.allowedAdapters.includes(id);
                const selected = draft.keyManagement.defaultAdapter === id;
                const canToggle = canToggleAdapter(draft, id);
                const canSelect = canSetDefaultAdapter(draft, id);
                return (
                  <div className={`adapter-option ${enabled ? 'enabled' : 'disabled'}`} data-adapter-id={id} key={id}>
                    <button className={`adapter-choice ${selected ? 'selected' : ''}`} type="button" disabled={!canSelect} onClick={() => setDefaultAdapter(id)}>
                      <span className="check">{selected ? <Check size={14} weight="bold" /> : null}</span>
                      <Key size={22} weight="duotone" />
                      <strong>{adapter.label}</strong>
                      <small>{adapter.recovery === 'sar-2-of-3' ? '독립 2-of-3 복구' : '승인된 Provider 정책'}</small>
                    </button>
                    <label className="adapter-availability">
                      <input type="checkbox" checked={enabled} disabled={!canToggle} onChange={() => toggleAdapter(id)} />
                      <span>{enabled ? '프로젝트에서 허용' : '사용하지 않음'}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="editor-card modules-card">
            <div className="card-heading"><div><span>02</span><div><strong>Service modules</strong><p>의존성 검사를 통과한 기능만 패키징됩니다.</p></div></div><em>{draft.enabledModules.length} enabled</em></div>
            <div className="module-list">
              {Object.values(WSS_MODULES).map((module) => {
                const checked = draft.enabledModules.includes(module.id);
                const policyManaged = module.id === 'sar-recovery';
                return (
                  <label key={module.id}>
                    <input type="checkbox" checked={checked} onChange={() => toggleModule(module.id)} disabled={module.id === 'wallet-home' || policyManaged} />
                    <span className="toggle" />
                    <div><strong>{module.name}</strong><small>{policyManaged ? '복구 정책에서 자동 관리됩니다.' : module.description}</small></div>
                    <em>{policyManaged ? 'policy' : module.category}</em>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="editor-card provider-card">
            <div className="card-heading"><div><span>03</span><div><strong>Provider routing</strong><p>UI가 아니라 Adapter 계약으로 교체합니다.</p></div></div></div>
            <dl>
              <div><dt>Execution</dt><dd>{draft.providers.execution}</dd></div>
              <div><dt>Compliance</dt><dd>{draft.providers.compliance}</dd></div>
              <div><dt>KRW Quote</dt><dd>{draft.providers.quote}</dd></div>
              <div><dt>Deployment</dt><dd>{draft.deploymentMode}</dd></div>
            </dl>
          </section>

          <aside className="manifest-preview">
            <div className="preview-brand" style={{ background: draft.brand.primaryColor }}>{draft.brand.logoText}</div>
            <span>{draft.institutionName}</span>
            <h2>{draft.walletName}</h2>
            <p>{draft.chains.length} networks · {draft.enabledModules.length} modules</p>
            <pre data-testid="manifest-preview">{JSON.stringify({
              tenantId: draft.tenantId,
              keyPolicyVersion: draft.keyManagement.policyVersion,
              recoveryRequirement: draft.keyManagement.recoveryRequirement,
              defaultAdapter: draft.keyManagement.defaultAdapter,
              allowedAdapters: draft.keyManagement.allowedAdapters,
              providers: draft.providers,
            }, null, 2)}</pre>
            <button type="button" disabled={errors.length > 0} onClick={exportManifest}>{exported ? 'Manifest exported' : 'Export tenant manifest'}</button>
            <small>정책 변경은 신규 지갑에만 적용됩니다. 기존 지갑 전환은 별도 이전 흐름과 고객 승인이 필요합니다.</small>
          </aside>
        </div>
      </section>
    </main>
  );
}
