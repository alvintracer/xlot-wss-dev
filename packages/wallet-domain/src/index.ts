export type TransferState =
  | 'draft'
  | 'quoted'
  | 'screened'
  | 'awaiting-customer-approval'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired';

const transitions: Readonly<Record<TransferState, readonly TransferState[]>> = {
  draft: ['quoted', 'failed', 'expired'],
  quoted: ['screened', 'failed', 'expired'],
  screened: ['awaiting-customer-approval', 'failed', 'expired'],
  'awaiting-customer-approval': ['submitted', 'failed', 'expired'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  failed: [],
  expired: [],
};

export function canTransitionTransfer(from: TransferState, to: TransferState): boolean {
  return transitions[from].includes(to);
}

export function transitionTransfer(from: TransferState, to: TransferState): TransferState {
  if (!canTransitionTransfer(from, to)) throw new Error(`Invalid transfer transition: ${from} -> ${to}`);
  return to;
}
