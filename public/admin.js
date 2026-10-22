'use strict';

const $ = (selector) => document.querySelector(selector);
let adminToken = '';

function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value == null ? '' : String(value);
  return el;
}

async function loadOrders() {
  const message = $('#adminMessage');
  const wrap = $('#ordersWrap');
  const list = $('#ordersList');
  message.textContent = 'অর্ডার লোড হচ্ছে…';
  list.replaceChildren();
  try {
    const response = await fetch('/api/admin/orders', {
      headers: { 'x-admin-token': adminToken, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'অর্ডার লোড করা যায়নি।');

    wrap.hidden = false;
    message.textContent = `${data.orders.length}টি অর্ডার পাওয়া গেছে।`;
    if (!data.orders.length) {
      list.append(text('p', 'order-meta', 'এখনো কোনো অর্ডার নেই।'));
      return;
    }
    for (const order of data.orders) {
      const card = text('article', 'order-card', '');
      const head = text('div', 'order-head', '');
      const heading = text('strong', '', `${order.email} · ${order.id}`);
      const status = text('span', 'order-status', order.status.toUpperCase());
      head.append(heading, status);
      card.append(head);
      const amount = order.payment_amount && order.payment_currency
        ? `${order.payment_amount} ${order.payment_currency}`
        : '—';
      const method = ({ bkash: 'bKash', nagad: 'Nagad', legacy: 'পুরোনো অর্ডার' })[order.payment_method] || '—';
      card.append(text('div', 'order-meta', `WhatsApp: ${order.whatsapp} · Display price: ৳${order.price_bdt} · Method: ${method} · Payment: ${amount}`));
      if (order.payment_verification_source) card.append(text('div', 'order-meta', `Verification: ${order.payment_verification_source}`));
      card.append(text('div', 'order-meta', `Created: ${new Date(order.created_at).toLocaleString()}${order.paid_at ? ` · Paid: ${new Date(order.paid_at).toLocaleString()}` : ''}`));
      if (order.note) card.append(text('div', 'order-note', `Note: ${order.note}`));
      const actions = text('div', 'order-actions', '');
      const copyButton = text('button', 'button button-light button-small', 'Order ID কপি');
      copyButton.type = 'button';
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(order.id);
          $('#adminMessage').textContent = 'Order ID কপি করা হয়েছে।';
        } catch {
          $('#adminMessage').textContent = `Order ID: ${order.id}`;
        }
      });
      actions.append(copyButton);
      const fulfill = text('button', 'button button-primary button-small', 'Fulfilled হিসেবে চিহ্নিত করুন');
      fulfill.type = 'button';
      fulfill.disabled = order.status !== 'paid';
      fulfill.title = order.status !== 'paid' ? 'শুধু verified paid অর্ডার fulfill করা যাবে' : '';
      fulfill.addEventListener('click', async () => {
        fulfill.disabled = true;
        try {
          const result = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/fulfill`, {
            method: 'POST',
            headers: { 'x-admin-token': adminToken, Accept: 'application/json' }
          });
          const body = await result.json().catch(() => ({}));
          if (!result.ok) throw new Error(body.error || 'Update করা যায়নি।');
          await loadOrders();
        } catch (error) {
          $('#adminMessage').textContent = error.message;
          fulfill.disabled = false;
        }
      });
      actions.append(fulfill);
      card.append(actions);
      list.append(card);
    }
  } catch (error) {
    wrap.hidden = true;
    message.textContent = error.message;
  }
}

$('#adminLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  adminToken = $('#adminToken').value.trim();
  await loadOrders();
});

$('#reloadOrders').addEventListener('click', loadOrders);

$('#downloadBackup').addEventListener('click', async () => {
  const button = $('#downloadBackup');
  const message = $('#adminMessage');
  button.disabled = true;
  message.textContent = 'ডেটাবেস ব্যাকআপ তৈরি হচ্ছে…';

  try {
    const response = await fetch('/api/admin/backup', {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'ব্যাকআপ ডাউনলোড করা যায়নি।');
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const disposition = response.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);

    link.href = objectUrl;
    link.download = filenameMatch
      ? filenameMatch[1]
      : `ars-store-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    message.textContent = 'ব্যাকআপ ডাউনলোড শুরু হয়েছে। ফাইলটি নিরাপদ স্থানে রাখুন।';
  } catch (error) {
    message.textContent = error.message || 'ব্যাকআপ ডাউনলোড করা যায়নি।';
  } finally {
    button.disabled = false;
  }
});
