import { kiwoomManifest } from '@took-wss/tenant-kiwoom';
import { jbManifest } from '@took-wss/tenant-jb';
import { namuManifest } from '@took-wss/tenant-namu';
import { shinhanManifest } from '@took-wss/tenant-shinhan';

const walletNames = new Map([
  [kiwoomManifest.tenantId, kiwoomManifest.walletName],
  [jbManifest.tenantId, jbManifest.walletName],
  [namuManifest.tenantId, namuManifest.walletName],
  [shinhanManifest.tenantId, shinhanManifest.walletName],
]);

export function smsBrandForTenant(tenantId: string): string {
  const name = walletNames.get(tenantId);
  if (!name) throw new Error('unsupported_sms_tenant');
  return name;
}
