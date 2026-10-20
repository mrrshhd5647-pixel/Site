'use strict';

const $ = (selector) => document.querySelector(selector);
let mode = 'login';
let loggedInUser = null;
let resetToken = '';

function setMessage(element, message, kind = '') {
  element.textContent = message || '';
  element.className = 'auth-message';
  if (kind) element.classList.add(`is-${kind}`);
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  const forgot = mode === 'forgot';
  const resetting = mode === 'reset';

  $('#authTabs').hidden = forgot || resetting || Boolean(loggedInUser);
  $('#authLinks').hidden = Boolean(loggedInUser);
  $('#forgotLink').hidden = registering || forgot || resetting;
  $('#backToLogin').hidden = !(forgot || resetting);
  $('#nameField').hidden = !registering;
  $('#emailField').hidden = resetting;
  $('#passwordField').hidden = forgot;
  $('#confirmField').hidden = !(registering || resetting);
  $('#authLinks').hidden = forgot || resetting || Boolean(loggedInUser);
  $('#changePasswordPanel').hidden = !loggedInUser;
  $('#authForm').hidden = Boolean(loggedInUser);

  $('#loginTab').classList.toggle('is-active', !registering);
  $('#registerTab').classList.toggle('is-active', registering);
  $('#loginTab').setAttribute('aria-selected', String(!registering));
  $('#registerTab').setAttribute('aria-selected', String(registering));
  $('#password').autocomplete = registering ? 'new-password' : 'current-password';

  if (forgot) {
    $('#authTitle').textContent = 'পাসওয়ার্ড রিসেট করুন';
    $('#authIntro').textContent = 'আপনার অ্যাকাউন্টের ইমেইল দিন। রিসেট লিংক পাঠানো হবে।';
    $('#submitButton').textContent = 'রিসেট লিংক পাঠান';
    $('#passwordHint').textContent = '';
  } else if (resetting) {
    $('#authTitle').textContent = 'নতুন পাসওয়ার্ড সেট করুন';
    $('#authIntro').textContent = 'নতুন পাসওয়ার্ড দিন এবং নিশ্চিত করুন।';
    $('#passwordLabel').textContent = 'নতুন পাসওয়ার্ড';
    $('#password').autocomplete = 'new-password';
    $('#submitButton').textContent = 'পাসওয়ার্ড রিসেট করুন';
    $('#passwordHint').textContent = 'কমপক্ষে ১০ অক্ষরের পাসওয়ার্ড ব্যবহার করুন।';
  } else if (registering) {
    $('#authTitle').textContent = 'নতুন অ্যাকাউন্ট তৈরি করুন';
    $('#authIntro').textContent = 'ইমেইল ও শক্তিশালী পাসওয়ার্ড দিয়ে অ্যাকাউন্ট খুলুন।';
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
$('#forgotLink').addEventListener('click', () => setMode('forgot'));
$('#backToLogin').addEventListener('click', () => {
  resetToken = '';
  history.replaceState(null, '', '/auth');
  setMode('login');
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

  setMessage(message, '');
  if (mode !== 'reset' && !validEmail(email)) {
    setMessage(message, 'সঠিক ইমেইল ঠিকানা দিন।', 'error');
    return;
  }

  if (mode === 'forgot') {
    button.disabled = true;
    button.textContent = 'পাঠানো হচ্ছে…';
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'রিসেট লিংক পাঠানো যায়নি।');
      setMessage(message, data.message || 'ইমেইলটি থাকলে রিসেট লিংক পাঠানো হবে। Inbox ও Spam ফোল্ডার দেখুন।', 'success');
    } catch (error) {
      setMessage(message, error.message || 'ইমেইল পাঠানো যায়নি।', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'রিসেট লিংক পাঠান';
    }
    return;
  }

  if (mode === 'reset') {
    if (!resetToken) {
      setMessage(message, 'রিসেট টোকেন পাওয়া যায়নি। আবার Forgot Password করুন।', 'error');
      return;
    }
    if (password.length < 10 || password.length > 128) {
      setMessage(message, 'নতুন পাসওয়ার্ড ১০ থেকে ১২৮ অক্ষরের মধ্যে হতে হবে।', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setMessage(message, 'দুটি পাসওয়ার্ড মিলছে না।', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'পাসওয়ার্ড পরিবর্তন হচ্ছে…';
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: resetToken, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'পাসওয়ার্ড রিসেট করা যায়নি।');
      history.replaceState(null, '', '/auth');
      resetToken = '';
      $('#password').value = '';
      $('#confirmPassword').value = '';
      setMode('login');
      setMessage(message, data.message || 'পাসওয়ার্ড পরিবর্তন হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।', 'success');
    } catch (error) {
      setMessage(message, error.message || 'পাসওয়ার্ড রিসেট করা যায়নি।', 'error');
    } finally {
      button.disabled = false;
      button.textContent = mode === 'reset' ? 'পাসওয়ার্ড রিসেট করুন' : 'লগইন করুন';
    }
    return;
  }

  if (mode === 'register' && password.length < 10) {
    setMessage(message, 'পাসওয়ার্ড কমপক্ষে ১০ অক্ষরের হতে হবে।', 'error');
    return;
  }
  if (password.length > 128) {
    setMessage(message, 'পাসওয়ার্ড সর্বোচ্চ ১২৮ অক্ষরের হতে পারবে।', 'error');
    return;
  }
  if (mode === 'register' && password !== confirmPassword) {
    setMessage(message, 'দুটি পাসওয়ার্ড মিলছে না।', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = mode === 'register' ? 'অ্যাকাউন্ট তৈরি হচ্ছে…' : 'লগইন হচ্ছে…';
  try {
    const response = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password, name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'অনুরোধ সম্পন্ন করা যায়নি।');
    setMessage(message, mode === 'register' ? 'অ্যাকাউন্ট তৈরি হয়েছে।' : 'লগইন সফল।', 'success');
    window.location.assign('/');
  } catch (error) {
    setMessage(message, error.message || 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।', 'error');
  } finally {
    button.disabled = false;
    button.textContent = mode === 'register' ? 'অ্যাকাউন্ট তৈরি করুন' : 'লগইন করুন';
  }
});

$('#changePasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const currentPassword = $('#currentPassword').value;
  const newPassword = $('#newPassword').value;
  const confirmPassword = $('#newPasswordConfirm').value;
  const message = $('#changePasswordMessage');
  const button = $('#changePasswordButton');
  setMessage(message, '');

  if (newPassword.length < 10 || newPassword.length > 128) {
    setMessage(message, 'নতুন পাসওয়ার্ড ১০ থেকে ১২৮ অক্ষরের মধ্যে হতে হবে।', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setMessage(message, 'নতুন পাসওয়ার্ড দুটি মিলছে না।', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'পরিবর্তন হচ্ছে…';
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'পাসওয়ার্ড পরিবর্তন করা যায়নি।');
    $('#changePasswordForm').reset();
    setMessage(message, data.message || 'পাসওয়ার্ড পরিবর্তন হয়েছে।', 'success');
  } catch (error) {
    setMessage(message, error.message || 'পাসওয়ার্ড পরিবর্তন করা যায়নি।', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'পাসওয়ার্ড পরিবর্তন করুন';
  }
});

$('#logoutButton').addEventListener('click', async () => {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    window.location.assign('/auth');
  }
});

async function initialize() {
  const url = new URL(window.location.href);
  if (url.pathname === '/auth/reset') {
    resetToken = url.searchParams.get('token') || '';
    setMode('reset');
    if (!/^[a-f0-9]{64}$/i.test(resetToken)) {
      setMessage($('#authMessage'), 'রিসেট লিংকটি সঠিক নয়। আবার Forgot Password করুন।', 'error');
    }
  } else {
    setMode('login');
  }

  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await response.json();
    if (data.user && url.pathname !== '/auth/reset') {
      loggedInUser = data.user;
      $('#authTabs').hidden = true;
      $('#authForm').hidden = true;
      $('#authLinks').hidden = true;
      $('#changePasswordPanel').hidden = false;
      $('#loggedInEmail').textContent = data.user.email;
      $('#authTitle').textContent = 'আপনার অ্যাকাউন্ট';
      $('#authIntro').textContent = 'এখান থেকে পাসওয়ার্ড পরিবর্তন অথবা লগআউট করতে পারবেন।';
      setMessage($('#authMessage'), '');
    }
  } catch {
    // The login form remains available if the session check fails.
  }
}

initialize();
