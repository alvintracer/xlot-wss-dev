import initACVM from '@noir-lang/acvm_js';
import initNoirC from '@noir-lang/noirc_abi';
import acvmWasm from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import noircWasm from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';
import { createIdentityEqualityProof as createProof } from './index.js';
export { createIdentityCommitment, verifyIdentityEqualityProof } from './index.js';

let initialization: Promise<unknown> | undefined;

export async function createIdentityEqualityProof(input: Parameters<typeof createProof>[0]) {
  initialization ??= Promise.all([initACVM(fetch(acvmWasm)), initNoirC(fetch(noircWasm))]);
  await initialization;
  return createProof(input);
}
