const code = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) || '');
const form = document.querySelector('#claim-form');
const institutionOptions = document.querySelector('#institution-options');
const externalDetails = document.querySelector('#external-details');
const asset = document.querySelector('#claim-asset');
const network = document.querySelector('#claim-network');
const status = document.querySelector('#status');
const otpFields = document.querySelector('#otp-fields');
const otpButton = document.querySelector('#otp-button');
const changePhoneButton = document.querySelector('#change-phone');
const claimButton = document.querySelector('#claim-button');
const phoneInput = document.querySelector('#phone');
const otpInput = document.querySelector('#otp');
const recipientInput = document.querySelector('#recipient');
const connectWalletButton = document.querySelector('#connect-wallet');
const connectedWallet = document.querySelector('#connected-wallet');
const transactionLink = document.querySelector('#transaction-link');
let timer = null;
const explorer = {
  ethereum: 'https://etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  base: 'https://basescan.org/tx/',
};

const errorText = {
  claim_not_found: '수령 링크를 찾지 못했어요.',
  claim_not_ready: '아직 받을 수 없어요. 잠시 후 다시 확인해 주세요.',
  claim_phone_mismatch: '수령 안내를 받은 휴대폰 번호를 확인해 주세요.',
  claim_otp_rate_limited: '인증 요청이 많아요. 잠시 뒤 다시 시도해 주세요.',
  verification_code_mismatch: '인증번호를 다시 확인해 주세요.',
  invalid_recipient: '받을 지갑 주소를 다시 확인해 주세요.',
  recipient_review_required: '받을 주소의 안전성을 확인하지 못해 수령을 진행할 수 없어요.',
  claim_service_unavailable: '현재 수령 서비스를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
};

async function api(path, body) {
  const response = await fetch(`/api/v1/claims/${encodeURIComponent(code)}${path}`, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errorText[result.error] || '요청을 완료하지 못했어요. 다시 시도해 주세요.');
  return result;
}

function setBusy(busy) {
  otpButton.disabled = busy;
  claimButton.disabled = busy;
}

async function refresh() {
  if (timer) window.clearTimeout(timer);
  timer = null;
  try {
    const info = await api('');
    asset.textContent = `${info.payoutDisplay || info.amountDisplay} ${info.assetSymbol}`;
    network.textContent = `${info.network} 네트워크 · ${new Date(info.expiresAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}까지`;
    form.hidden = info.status !== 'ready';
    institutionOptions.hidden = info.status !== 'ready';
    externalDetails.hidden = info.status !== 'ready';
    transactionLink.hidden = true;
    if (info.status === 'ready') status.textContent = '';
    if (info.status === 'claimed') status.textContent = info.payoutBelowExpected
      ? '수령은 완료됐지만 예정 금액보다 적게 도착했어요. 고객센터에 문의해 주세요.'
      : '자산 수령이 완료됐어요.';
    else if (info.status === 'processing') status.textContent = '네트워크에서 수령 거래를 확인하고 있어요.';
    else if (info.status === 'expired') status.textContent = '수령 기한이 지났어요. 보낸 분에게 문의해 주세요.';
    else if (info.status === 'refunded') status.textContent = '보낸 분에게 환불된 자산이에요.';
    else if (info.status === 'pending') status.textContent = '보낸 분의 입금이 확인되면 수령할 수 있어요.';
    if (info.status === 'claimed' && /^0x[0-9a-fA-F]{64}$/.test(info.transactionHash || '') && explorer[info.network]) {
      transactionLink.href = `${explorer[info.network]}${info.transactionHash}`;
      transactionLink.hidden = false;
    }
    if (info.status === 'processing' || info.status === 'pending') timer = window.setTimeout(refresh, 8_000);
  } catch (error) {
    status.textContent = error.message;
  }
}

otpButton.addEventListener('click', async () => {
  const phone = phoneInput.value.replace(/\D/g, '');
  if (!/^010\d{8}$/.test(phone)) {
    status.textContent = '휴대폰 번호를 다시 확인해 주세요.';
    return;
  }
  setBusy(true);
  try {
    await api('/otp', { phone });
    otpFields.hidden = false;
    phoneInput.readOnly = true;
    otpButton.hidden = true;
    status.textContent = '인증번호를 문자로 보냈어요.';
    otpInput.focus();
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(false); }
});

changePhoneButton.addEventListener('click', () => {
  phoneInput.readOnly = false;
  otpInput.value = '';
  otpFields.hidden = true;
  otpButton.hidden = false;
  status.textContent = '안내를 받은 번호를 다시 입력해 주세요.';
  phoneInput.focus();
});

connectWalletButton.addEventListener('click', async () => {
  const provider = window.ethereum;
  if (!provider || typeof provider.request !== 'function') {
    status.textContent = '연결할 외부 지갑을 찾지 못했어요. 월렛 앱에서 받을 주소를 복사해 입력해 주세요.';
    return;
  }
  connectWalletButton.disabled = true;
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const address = Array.isArray(accounts) ? accounts.find((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) : null;
    if (!address) throw new Error('wallet_address_unavailable');
    recipientInput.value = address;
    connectedWallet.textContent = `연결한 지갑 ${address.slice(0, 6)}…${address.slice(-4)}`;
    connectedWallet.hidden = false;
    status.textContent = '받을 주소를 입력했어요. 네트워크와 주소를 확인해 주세요.';
  } catch {
    status.textContent = '지갑 주소를 가져오지 못했어요. 주소를 직접 입력해 주세요.';
  } finally { connectWalletButton.disabled = false; }
});

recipientInput.addEventListener('input', () => { connectedWallet.hidden = true; });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const phone = phoneInput.value.replace(/\D/g, '');
  const otp = otpInput.value.replace(/\D/g, '');
  const recipient = recipientInput.value.trim();
  if (!/^010\d{8}$/.test(phone) || !/^\d{6}$/.test(otp) || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    status.textContent = '휴대폰 번호, 인증번호, 받을 지갑 주소를 다시 확인해 주세요.';
    return;
  }
  setBusy(true);
  try {
    await api('/submit', { phone, otp, recipient });
    form.hidden = true;
    status.textContent = '네트워크에서 수령 거래를 확인하고 있어요.';
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 8_000);
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(false); }
});

if (/^[A-Za-z0-9_-]{12}$/.test(code)) {
  for (const link of institutionOptions.querySelectorAll('[data-institution]')) {
    link.href = `/${link.dataset.institution}/app#claim=${encodeURIComponent(code)}`;
  }
  void refresh();
}
else status.textContent = '올바른 수령 링크가 아니에요.';
