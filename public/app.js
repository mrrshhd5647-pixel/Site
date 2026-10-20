'use strict';

const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let config = {
  priceBdt: 350,
  durationMonths: 18,
  payment: { configured: false, mode: null, amount: null, currency: null },
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
  if (config.payment?.configured && config.payment.amount && config.payment.currency) {
    $('#paymentAmountLabel').textContent = `পেমেন্ট: ${config.payment.amount} ${config.payment.currency}`;
  } else {
    $('#paymentAmountLabel').textContent = 'Binance Pay সেটআপ সম্পূর্ণ হলে checkout চালু হবে';
  }
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
    'google-config': 'Google Login চালু করতে .env ফাইলে GOOGLE_CLIENT_ID ও GOOGLE_CLIENT_SECRET যোগ করুন।',
    'auth-error': 'Google লগইন সম্পন্ন হয়নি। সেটিংস যাচাই করে আবার চেষ্টা করুন।'
  };
  box.textContent = messages[notice] || 'কিছু একটা সম্পন্ন হয়নি। আবার চেষ্টা করুন।';
  box.hidden = false;
  history.replaceState({}, '', window.location.pathname);
}

async function loadConfigAndUser() {
  try {
    const [configResponse, userResponse] = await Promise.all([
      fetch('/api/config', { headers: { Accept: 'application/json' } }),
      fetch('/api/me', { headers: { Accept: 'application/json' } })
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
    showToast('অর্ডার করার আগে Google দিয়ে লগইন করুন।');
    window.location.href = '/auth/google';
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

  if (!currentUser) {
    window.location.href = '/auth/google';
    return;
  }

  button.disabled = true;
  button.textContent = 'অর্ডার তৈরি হচ্ছে…';
  status.hidden = true;

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ whatsapp, note })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'অর্ডার তৈরি করা যায়নি।');
    if (!data.checkoutUrl || !data.checkoutUrl.startsWith('https://')) {
      throw new Error('Binance checkout URL সঠিক নয়।');
    }
    window.location.assign(data.checkoutUrl);
  } catch (error) {
    status.textContent = error.message || 'পেমেন্ট শুরু করা যায়নি।';
    status.hidden = false;
    button.disabled = false;
    button.innerHTML = 'Binance Pay-এ এগিয়ে যান <span>→</span>';
  }
}

$('#buyButton').addEventListener('click', openCheckout);
$('#mobileBuyTop').addEventListener('click', openCheckout);
$('#mobileBuyButton').addEventListener('click', openCheckout);
$('#checkoutForm').addEventListener('submit', submitOrder);
$('#closeModal').addEventListener('click', () => $('#checkoutModal').close());
$('#cancelCheckout').addEventListener('click', () => $('#checkoutModal').close());

$('#logoutButton').addEventListener('click', async () => {
  try {
    await fetch('/auth/logout', { method: 'POST' });
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
