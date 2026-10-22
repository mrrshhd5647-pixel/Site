'use strict';

const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let config = {
  priceBdt: 350,
  durationMonths: 18,
  payment: { configured: false, mode: 'sandbox', methods: { bkash: false, nagad: false } },
  supportWhatsAppUrl: ''
};
let currentUser = null;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function moneyBdt(value) {
  return `৳${Number(value).toLocaleString('en-US')}`;
}

function updateMethodAvailability() {
  const methods = config.payment?.methods || {};
  const available = ['bkash', 'nagad'].filter((method) => Boolean(methods[method]));
  for (const method of ['bkash', 'nagad']) {
    const input = $(`#payment${method[0].toUpperCase()}${method.slice(1)}`);
    const card = $(`#${method}Option`);
    const status = $(`#${method}Status`);
    const enabled = Boolean(methods[method]);
    input.disabled = !enabled;
    card.classList.toggle('is-unavailable', !enabled);
    status.textContent = enabled
      ? (config.payment.mode === 'live' ? 'লাইভ পেমেন্ট' : 'Sandbox / পরীক্ষামূলক')
      : 'Gateway setup বাকি';
  }
  const selected = document.querySelector('input[name="paymentMethod"]:checked');
  if (!selected || selected.disabled) {
    const first = available[0];
    if (first) $(`#payment${first[0].toUpperCase()}${first.slice(1)}`).checked = true;
  }
  for (const method of ['bkash', 'nagad']) {
    const input = $(`#payment${method[0].toUpperCase()}${method.slice(1)}`);
    $(`#${method}Option`).classList.toggle('is-selected', input.checked && !input.disabled);
  }
  $('#paymentAmountLabel').textContent = available.length
    ? `মোট মূল্য: ${moneyBdt(config.priceBdt)} · BDPayHub checkout`
    : 'bKash / Nagad চালু করতে BDPayHub Variables কনফিগার করুন';
}

function setPriceUI() {
  const price = moneyBdt(config.priceBdt);
  const duration = `${config.durationMonths} মাসের মেয়াদ`;
  $('#price').textContent = price;
  $('#mobilePrice').textContent = price;
  $('#modalPrice').textContent = price;
  $('#durationText').textContent = duration;
  $('#featureDuration').textContent = `${config.durationMonths} মাসের অফার`;
  $('#mobileDuration').textContent = duration;
  $('#modalDuration').textContent = duration;
  updateMethodAvailability();
}

function setUserUI(user) {
  currentUser = user;
  const login = $('#loginButton');
  const account = $('#accountArea');
  if (user) {
    login.hidden = true;
    account.hidden = false;
    $('#userName').textContent = user.name || user.email;
    const avatar = $('#userAvatar');
    if (user.picture) {
      avatar.src = user.picture;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }
    $('#deliveryEmail').value = user.email || '';
  } else {
    login.hidden = false;
    account.hidden = true;
  }
}

function showNoticeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const notice = params.get('notice');
  if (!notice) return;
  const box = $('#notice');
  const messages = {
    'auth-error': 'লগইন সম্পন্ন হয়নি। ইমেইল ও পাসওয়ার্ড যাচাই করে আবার চেষ্টা করুন.'
  };
  box.textContent = messages[notice] || 'কিছু একটা সম্পন্ন হয়নি। আবার চেষ্টা করুন।';
  box.hidden = false;
  history.replaceState({}, '', window.location.pathname);
}

async function loadConfigAndUser() {
  try {
    const [configResponse, userResponse] = await Promise.all([
      fetch('/api/config', { headers: { Accept: 'application/json' } }),
      fetch('/api/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    ]);
    if (configResponse.ok) config = { ...config, ...(await configResponse.json()) };
    if (userResponse.ok) {
      const data = await userResponse.json();
      setUserUI(data.user);
    }
    setPriceUI();
  } catch {
    showToast('সার্ভারের সঙ্গে সংযোগ করা যায়নি।');
  }
}

function openCheckout() {
  if (!currentUser) {
    showToast('অর্ডার করার আগে ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন।');
    window.location.href = '/auth';
    return;
  }
  $('#deliveryEmail').value = currentUser.email || '';
  $('#checkoutStatus').hidden = true;
  $('#checkoutStatus').textContent = '';
  $('#checkoutModal').showModal();
}

async function submitOrder(event) {
  event.preventDefault();
  const button = $('#payButton');
  const status = $('#checkoutStatus');
  const whatsapp = $('#whatsapp').value.trim();
  const note = $('#orderNote').value.trim();
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || '';

  if (!currentUser) {
    window.location.href = '/auth';
    return;
  }
  if (!['bkash', 'nagad'].includes(paymentMethod) || !config.payment?.methods?.[paymentMethod]) {
    status.textContent = 'নির্বাচিত পেমেন্ট পদ্ধতি এখনো চালু করা হয়নি। BDPayHub সেটআপ সম্পন্ন করুন।';
    status.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = 'অর্ডার তৈরি হচ্ছে…';
  status.hidden = true;

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ whatsapp, note, paymentMethod })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'অর্ডার তৈরি করা যায়নি।');
    const checkoutUrl = typeof data.checkoutUrl === 'string' ? data.checkoutUrl : '';
    if (!checkoutUrl.startsWith('https://')) throw new Error('BDPayHub checkout URL সঠিক নয়।');
    window.location.assign(checkoutUrl);
  } catch (error) {
    status.textContent = error.message || 'পেমেন্ট শুরু করা যায়নি।';
    status.hidden = false;
    button.disabled = false;
    button.innerHTML = 'bKash / Nagad-এ এগিয়ে যান <span>→</span>';
  }
}

for (const method of ['bkash', 'nagad']) {
  $(`#payment${method[0].toUpperCase()}${method.slice(1)}`).addEventListener('change', () => {
    for (const item of ['bkash', 'nagad']) {
      const input = $(`#payment${item[0].toUpperCase()}${item.slice(1)}`);
      $(`#${item}Option`).classList.toggle('is-selected', input.checked && !input.disabled);
    }
  });
}

$('#buyButton').addEventListener('click', openCheckout);
$('#mobileBuyTop').addEventListener('click', openCheckout);
$('#mobileBuyButton').addEventListener('click', openCheckout);
$('#checkoutForm').addEventListener('submit', submitOrder);
$('#closeModal').addEventListener('click', () => $('#checkoutModal').close());
$('#cancelCheckout').addEventListener('click', () => $('#checkoutModal').close());

$('#logoutButton').addEventListener('click', async () => {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    setUserUI(null);
    showToast('আপনি লগআউট করেছেন।');
  }
});

$('#supportButton').addEventListener('click', () => {
  const url = config.supportWhatsAppUrl || '';
  if (url.startsWith('https://wa.me/') || url.startsWith('https://api.whatsapp.com/')) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    showToast('WhatsApp support link এখনো সেট করা হয়নি। .env-এ SUPPORT_WHATSAPP_URL যোগ করুন।');
  }
});

$('#menuButton').addEventListener('click', () => {
  const nav = $('.header-nav');
  const open = nav.classList.toggle('open');
  $('#menuButton').setAttribute('aria-expanded', String(open));
});
$('.header-nav').addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    $('.header-nav').classList.remove('open');
    $('#menuButton').setAttribute('aria-expanded', 'false');
  }
});
$('#year').textContent = String(new Date().getFullYear());

showNoticeFromUrl();
loadConfigAndUser();
