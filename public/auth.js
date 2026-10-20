'use strict';

const $ = (selector) => document.querySelector(selector);
let mode = 'login';

function setMessage(element, message, kind = '') {
  element.textContent = message || '';
  element.className = 'auth-message';
  if (kind) element.classList.add(`is-${kind}`);
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  $('#authTabs').hidden = false;
  $('#nameField').hidden = !registering;
  $('#confirmField').hidden = !registering;
  $('#authLinks').hidden = registering;
  $('#loginTab').classList.toggle('is-active', !registering);
  $('#registerTab').classList.toggle('is-active', registering);
  $('#loginTab').setAttribute('aria-selected', String(!registering));
  $('#registerTab').setAttribute('aria-selected', String(registering));
  $('#password').autocomplete = registering ? 'new-password' : 'current-password';
  $('#password').placeholder = registering ? 'কমপক্ষে ১০ অক্ষর' : 'আপনার পাসওয়ার্ড';

  if (registering) {
    $('#authTitle').textContent = 'নতুন অ্যাকাউন্ট তৈরি করুন';
    $('#authIntro').textContent = 'ইমেইল ও পাসওয়ার্ড দিয়ে আপনার ARS Store অ্যাকাউন্ট খুলুন।';
    $('#passwordLabel').textContent = 'পাসওয়ার্ড';
    $('#submitButton').textContent = 'অ্যাকাউন্ট তৈরি করুন';
    $('#passwordHint').textContent = 'কমপক্ষে ১০ অক্ষরের পাসওয়ার্ড দিন।';
  } else {
    $('#authTitle').textContent = 'আপনার অ্যাকাউন্টে প্রবেশ করুন';
    $('#authIntro').textContent = 'ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন, অথবা নতুন অ্যাকাউন্ট তৈরি করুন।';
    $('#passwordLabel').textContent = 'পাসওয়ার্ড';
    $('#submitButton').textContent = 'লগইন করুন';
    $('#passwordHint').textContent = 'আপনার অ্যাকাউন্টের পাসওয়ার্ড দিন।';
  }
  setMessage($('#authMessage'), '');
}

$('#loginTab').addEventListener('click', () => setMode('login'));
$('#registerTab').addEventListener('click', () => setMode('register'));
$('#forgotLink').addEventListener('click', () => {
  setMessage(
    $('#authMessage'),
    'পাসওয়ার্ড ভুলে গেলে ARS Store অ্যাডমিনের সঙ্গে যোগাযোগ করুন। আপনার অ্যাকাউন্টের ইমেইল ঠিকানাটি জানাবেন।',
    'info'
  );
});

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('#email').value.trim().toLowerCase();
  const password = $('#password').value;
  const confirmPassword = $('#confirmPassword').value;
  const name = $('#name').value.trim();
  const message = $('#authMessage');
  const button = $('#submitButton');
  const registering = mode === 'register';

  setMessage(message, '');
  if (!validEmail(email)) {
    setMessage(message, 'সঠিক ইমেইল ঠিকানা দিন।', 'error');
    return;
  }
  if (registering && (password.length < 10 || password.length > 128)) {
    setMessage(message, 'পাসওয়ার্ড ১০ থেকে ১২৮ অক্ষরের মধ্যে হতে হবে।', 'error');
    return;
  }
  if (password.length < 1 || password.length > 128) {
    setMessage(message, 'সঠিক পাসওয়ার্ড দিন।', 'error');
    return;
  }
  if (registering && password !== confirmPassword) {
    setMessage(message, 'দুটি পাসওয়ার্ড মিলছে না।', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = registering ? 'অ্যাকাউন্ট তৈরি হচ্ছে…' : 'লগইন হচ্ছে…';
  try {
    const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password, name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'অনুরোধ সম্পন্ন করা যায়নি।');
    window.location.assign('/');
  } catch (error) {
    setMessage(message, error.message || 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।', 'error');
  } finally {
    button.disabled = false;
    button.textContent = registering ? 'অ্যাকাউন্ট তৈরি করুন' : 'লগইন করুন';
  }
});

async function initialize() {
  setMode('login');
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await response.json();
    if (data.user) window.location.assign('/');
  } catch {
    // Keep the login form available if the session check fails.
  }
}

initialize();
