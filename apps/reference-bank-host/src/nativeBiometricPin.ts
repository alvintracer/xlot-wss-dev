import { Capacitor } from '@capacitor/core';
import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { verifyAppPin } from './appPin';

function storageKey(scope: string): string { return `took-wss:biometric-app-pin:v1:${scope}`; }

export async function biometricPinAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await NativeBiometric.isAvailable({ useFallback: false });
    return result.isAvailable && result.strongBiometryIsAvailable;
  } catch { return false; }
}

export async function biometricPinEnabled(scope: string): Promise<boolean> {
  if (!await biometricPinAvailable()) return false;
  try { return (await NativeBiometric.isDataSaved({ key: storageKey(scope) })).isSaved; }
  catch { return false; }
}

export async function enableBiometricPin(scope: string, pin: string): Promise<void> {
  if (!await biometricPinAvailable()) throw new Error('biometric_unavailable');
  if (!await verifyAppPin(scope, pin)) throw new Error('app_pin_invalid');
  await NativeBiometric.setData({
    key: storageKey(scope), value: pin,
    accessControl: AccessControl.BIOMETRY_CURRENT_SET,
    authValidityDuration: 0,
    title: '생체 인증 연결', negativeButtonText: '취소',
  });
}

export async function disableBiometricPin(scope: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await NativeBiometric.deleteData({ key: storageKey(scope) });
}

export async function readBiometricPin(scope: string): Promise<string> {
  if (!await biometricPinAvailable()) throw new Error('biometric_unavailable');
  const result = await NativeBiometric.getSecureData({
    key: storageKey(scope), title: '지갑 열기', subtitle: '생체 인증으로 앱 비밀번호 확인', reason: '지갑 결제를 승인해 주세요',
  });
  if (!/^\d{6}$/.test(result.value) || !await verifyAppPin(scope, result.value)) throw new Error('biometric_pin_invalid');
  return result.value;
}
