'use strict';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(window.location.search);
const orderId = params.get('order') || '';
const isCancelPage = window.location.pathname.endsWith('/cancel');
let pollCount = 0;
let pollTimer = null;

$('#orderId').textContent = orderId || 'পাওয়া যায়নি';

function setStatus(status, message, title, icon) {
  $('#statusPill').textContent = String(status || 'PENDING').toUpperCase();
  $('#statusMessage').textContent = message;
  $('#statusTitle').textContent = title;
  $('#statusIcon').textContent = icon;
}

async function refreshStatus() {
  if (!orderId) {
    setStatus('UNKNOWN', 'Order ID পাওয়া যায়নি। আপনার ARS Store account থেকে অর্ডারটি যাচাই করুন।', 'অর্ডার পাওয়া যায়নি', '!');
    return;
  }
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus('UNKNOWN', data.error || 'অর্ডারের তথ্য পড়া যায়নি। একই ARS Store account-এ লগইন করা আছে কি না দেখুন।', 'স্ট্যাটাস দেখা যাচ্ছে না', '!');
      return;
    }
    const order = data.order;
    if (order.status === 'fulfilled') {
      setStatus('FULFILLED', 'অর্ডারটি প্রসেস করা হয়েছে। অ্যাক্টিভেশন সংক্রান্ত নির্দেশনার জন্য আপনার email / WhatsApp দেখুন।', 'অর্ডার সম্পন্ন', '✓');
      clearTimeout(pollTimer);
    } else if (order.status === 'paid') {
      setStatus('PAID · ACTIVATION PENDING', 'পেমেন্ট নিশ্চিত হয়েছে। ARS Store এখন অর্ডারটি প্রসেস করবে।', 'পেমেন্ট নিশ্চিত', '✓');
      clearTimeout(pollTimer);
    } else if (order.status === 'failed') {
      setStatus('PAYMENT NOT CREATED', 'BDPayHub checkout তৈরি হয়নি। স্টোরে ফিরে গিয়ে gateway settings যাচাই করুন।', 'পেমেন্ট শুরু হয়নি', '!');
      clearTimeout(pollTimer);
    } else if (isCancelPage) {
      setStatus('PENDING', 'Checkout থেকে ফিরে এসেছেন। পেমেন্ট সম্পন্ন না হলে অর্ডার pending থাকবে। পেমেন্ট হয়ে থাকলে webhook আসা পর্যন্ত অপেক্ষা করুন।', 'পেমেন্ট এখনো নিশ্চিত নয়', '◷');
    } else {
      setStatus('PENDING', 'BDPayHub-এর signed notification আসার অপেক্ষায়। কয়েক সেকেন্ড পরে আবার যাচাই করা হবে।', 'অর্ডার যাচাই হচ্ছে', '◷');
    }
  } catch {
    setStatus('UNKNOWN', 'নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।', 'স্ট্যাটাস পড়া যায়নি', '!');
  }

  pollCount += 1;
  if (pollCount < 20 && !['PAID', 'FULFILLED', 'PAYMENT NOT CREATED'].includes($('#statusPill').textContent)) {
    pollTimer = setTimeout(refreshStatus, 4000);
  }
}

$('#refreshStatus').addEventListener('click', () => {
  clearTimeout(pollTimer);
  pollCount = 0;
  refreshStatus();
});
refreshStatus();
