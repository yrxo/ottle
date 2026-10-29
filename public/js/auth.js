// public/js/auth.js — Firebase Auth UI + state
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail,
  signInWithPopup, signInWithPhoneNumber, RecaptchaVerifier, PhoneAuthProvider,
  linkWithCredential, signInWithCredential, updateProfile as fbUpdateProfile,
  applyActionCode, sendEmailVerification as fbSendLink
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth, googleProvider } from "./firebase.js";
import * as store from "./store.js";
import { apiPost } from "./api.js";

let handlers = {};
let phoneVerifier = null;

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function getPhoneVerifier() {
  if (phoneVerifier) { try { phoneVerifier.clear(); } catch (_) {} }
  phoneVerifier = new RecaptchaVerifier("recaptcha-container", { size: "invisible" }, auth);
  return phoneVerifier;
}

async function backendValidateEmail(email) {
  try {
    const r = await fetch("/api/verify-email", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email })
    }).then((x) => x.json());
    return r; // { valid: bool|null, disposable, format_valid, ... }
  } catch (e) {
    return { valid: null, error: String(e) };
  }
}

export function initAuth(h) {
  handlers = h;
  onAuthStateChanged(auth, async (user) => {
    if (!user) return handlers.onLogout?.();
    const profile = await store.ensureProfile(user.uid, {
      displayName: user.displayName, email: user.email, photoURL: user.photoURL
    });
    // Google sign-ins are treated as verified
    if (user.providerData[0]?.providerId === "google.com") {
      if (!profile.emailVerified) await store.setEmailVerified(user.uid, true);
      return handlers.onEnter?.(user);
    }
    // Email/password: verify by code (our backend validates + sends a code)
    if (profile.emailVerified) return handlers.onEnter?.(user);
    return handlers.onVerifyNeeded?.(user);
  });
}

export function signOutUser() { return signOut(auth); }

export async function updateAuthPhoto(url) {
  if (auth.currentUser && url) await fbUpdateProfile(auth.currentUser, { photoURL: url });
}

/* Static-host fallback (Netlify): agar email verification LINK par click karke wapas aaya
   (URL me oobCode), to usse apply karo aur Firestore flag set karo. */
export async function completeEmailLink() {
  const p = new URLSearchParams(window.location.search);
  const oob = p.get("oobCode");
  if (!oob || p.get("mode") !== "verifyEmail") return false;
  let ok = false;
  try { await applyActionCode(auth, oob); ok = true; } catch (_) {}
  if (ok && auth.currentUser) {
    await store.setEmailVerified(auth.currentUser.uid, true).catch(() => {});
  }
  window.history.replaceState({}, "", window.location.pathname);
  window.location.reload();
  return true;
}

export function renderAuthScreen(root) {
  root.innerHTML = `
  <div class="min-h-screen flex items-center justify-center px-4 py-10 theme-transition">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-navy-800 dark:bg-amber-500 flex items-center justify-center shadow-lg mb-3">
          <span class="text-cream-100 dark:text-navy-900 font-extrabold text-2xl">O</span>
        </div>
        <h1 class="text-3xl font-extrabold tracking-tight">Ottle</h1>
        <p class="text-sm text-navy-500 dark:text-cream-300">Publish. Read. Connect.</p>
      </div>

      <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl shadow-xl border border-cream-300/60 dark:border-navy-700 p-6">
        <div class="flex gap-1 mb-5 bg-cream-200/60 dark:bg-navy-900/40 rounded-full p-1 text-sm font-medium">
          <button id="tabLogin" class="flex-1 py-2 rounded-full transition bg-navy-800 text-cream-100 dark:bg-amber-500 dark:text-navy-900">Log in</button>
          <button id="tabSignup" class="flex-1 py-2 rounded-full transition text-navy-500 dark:text-cream-300">Sign up</button>
        </div>

        <form id="authForm" class="space-y-3">
          <div id="nameField" class="hidden">
            <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Display name</label>
            <input id="displayName" type="text" autocomplete="name"
              class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Email</label>
            <input id="email" type="email" required autocomplete="email"
              class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Password</label>
            <input id="password" type="password" required minlength="6" autocomplete="current-password"
              class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
          </div>
          <p id="authError" class="text-xs text-red-500 hidden"></p>
          <button type="submit" id="authSubmit"
            class="w-full py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition">Log in</button>
        </form>

        <div class="flex items-center gap-3 my-4 text-xs text-navy-400">
          <div class="h-px flex-1 bg-cream-300 dark:bg-navy-700"></div>or<div class="h-px flex-1 bg-cream-300 dark:bg-navy-700"></div>
        </div>

        <button id="googleBtn"
          class="w-full py-2.5 rounded-xl bg-cream-200/70 dark:bg-navy-900/40 border border-cream-300 dark:border-navy-600 font-medium hover:bg-cream-300 dark:hover:bg-navy-700 transition flex items-center justify-center gap-2 text-sm">
          <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.3-2 3l3.2 2.5c1.9-1.7 3-4.3 3-7.4 0-.7-.1-1.3-.3-2z"/><path fill="#34A853" d="M6.5 14.3l-1 .8C6 17 8.8 19 12 19c2.6 0 4.8-1 6.5-2.7l-3.2-2.5c-.9.6-2 1-3.3 1-2.5 0-4.7-1.7-5.4-4.1H1v.8C2.6 16.8 5.3 19.5 8.4 19.5c3.1 0 5.8-2.5 6.6-5.6z" transform="translate(0 -2)"/><path fill="#4285F4" d="M12 5c1.6 0 3 .5 4.1 1.6l3-3C17.3 1.7 14.8.8 12 .8 8.4.8 5.2 2.7 3.5 5.4l1 1C5.8 4.5 8.7 3 12 3z" transform="translate(0 1.8)"/><path fill="#FBBC05" d="M6.5 9.3c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9v-.8H1C.4 6.5 0 8.1 0 10s.4 3.5 1 4.9l1-.8c-.4-.9-.6-1.9-.6-2.9s.2-2 .6-2.9z" transform="translate(1 2)"/></svg>
          Continue with Google
        </button>

        <button id="forgotBtn" class="w-full mt-3 text-xs text-navy-400 hover:text-amber-600 transition">Forgot password?</button>
      </div>
    </div>
  </div>`;

  // Phone verification entry
  const phoneBtn = document.createElement("button");
  phoneBtn.className = "w-full mt-2 py-2.5 rounded-xl bg-cream-200/70 dark:bg-navy-900/40 border border-cream-300 dark:border-navy-600 font-medium hover:bg-cream-300 dark:hover:bg-navy-700 transition flex items-center justify-center gap-2 text-sm";
  phoneBtn.innerHTML = `<i data-lucide="phone" class="w-4 h-4"></i> Continue with phone`;
  phoneBtn.onclick = () => openPhoneVerify();
  root.querySelector("#authForm").parentElement.appendChild(phoneBtn);

  // Show all accounts on signin page — requested
  const acctWrap = document.createElement("div");
  acctWrap.className = "mt-6 pt-5 border-t border-cream-200 dark:border-navy-700";
  acctWrap.innerHTML = `<p class="text-xs font-semibold text-navy-500 dark:text-cream-300 mb-3 flex items-center gap-1.5"><i data-lucide="users" class="w-3.5 h-3.5 text-sage-500"></i> Community</p><div id="authUsers" class="flex flex-wrap gap-2"><p class="text-xs text-navy-400">Loading authors…</p></div>`;
  root.querySelector("#authForm").parentElement.appendChild(acctWrap);
  store.listUsers().then(users => {
    const box = acctWrap.querySelector("#authUsers");
    const head = acctWrap.querySelector("p");
    if (head) head.innerHTML = `<i data-lucide="users" class="w-3.5 h-3.5 text-sage-500"></i> Community — ${users.length} authors`;
    if (!users.length) { box.innerHTML = `<p class="text-xs text-navy-400">Be the first to join!</p>`; return; }
    box.innerHTML = users.slice(0, 20).map(u => `
      <div class="flex flex-col items-center gap-1 w-[52px]">
        <img src="${u.photoURL || `https://i.pravatar.cc/100?u=${u.uid}`}" class="w-10 h-10 rounded-full object-cover ring-2 ring-white dark:ring-navy-800 shadow-sm">
        <span class="text-[10px] leading-none truncate w-full text-center">${u.displayName ? u.displayName.split(" ")[0] : (u.username || "User")}</span>
      </div>`).join("") + (users.length > 20 ? `<span class="text-xs text-navy-400 self-center">+${users.length - 20} more</span>` : "");
    if (window.lucide) lucide.createIcons();
  }).catch(() => {});
  if (window.lucide) lucide.createIcons();

  const tabLogin = root.querySelector("#tabLogin");
  const tabSignup = root.querySelector("#tabSignup");
  const nameField = root.querySelector("#nameField");
  const submit = root.querySelector("#authSubmit");
  const form = root.querySelector("#authForm");
  const errEl = root.querySelector("#authError");
  let mode = "login";

  const setMode = (m) => {
    mode = m;
    tabLogin.className = `flex-1 py-2 rounded-full transition ${m === "login" ? "bg-navy-800 text-cream-100 dark:bg-amber-500 dark:text-navy-900" : "text-navy-500 dark:text-cream-300"}`;
    tabSignup.className = `flex-1 py-2 rounded-full transition ${m === "signup" ? "bg-navy-800 text-cream-100 dark:bg-amber-500 dark:text-navy-900" : "text-navy-500 dark:text-cream-300"}`;
    nameField.classList.toggle("hidden", m !== "signup");
    submit.textContent = m === "login" ? "Log in" : "Create account";
  };
  tabLogin.onclick = () => setMode("login");
  tabSignup.onclick = () => setMode("signup");

  const showError = (msg) => { errEl.textContent = msg; errEl.classList.remove("hidden"); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    submit.disabled = true; submit.textContent = "Please wait...";
    const email = root.querySelector("#email").value.trim();
    const password = root.querySelector("#password").value;
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const name = root.querySelector("#displayName").value.trim() || email.split("@")[0];
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await cred.user.updateProfile({ displayName: name });
        // onAuthStateChanged validates the email via MailboxLayer (backend) and marks it verified
      }
    } catch (err) {
      showError(prettyError(err.code));
    } finally {
      submit.disabled = false; submit.textContent = mode === "login" ? "Log in" : "Create account";
    }
  };

  root.querySelector("#googleBtn").onclick = async () => {
    errEl.classList.add("hidden");
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { showError(prettyError(err.code)); }
  };

  root.querySelector("#forgotBtn").onclick = async () => {
    const email = root.querySelector("#email").value.trim();
    if (!email) return showError("Enter your email above first.");
    try { await sendPasswordResetEmail(auth, email); showError("Password reset email sent to " + email); }
    catch (err) { showError(prettyError(err.code)); }
  };
}

async function sendEmailCode(email, idToken = "") {
  return apiPost("/api/email/send-code", "send-code", { email, idToken });
}
async function verifyEmailCode(email, code) {
  return apiPost("/api/email/verify-code", "verify-code", { email, code });
}

function wireOtpBoxes(rowEl, { onComplete, onInput } = {}) {
  const inputs = [...rowEl.querySelectorAll(".otp-box")];
  const getCode = () => inputs.map((i) => i.value).join("");
  const reset = () => { inputs.forEach((i) => (i.value = "")); inputs[0].focus(); };
  inputs.forEach((inp, idx) => {
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(-1);
      if (inp.value && idx < 5) inputs[idx + 1].focus();
      onInput?.(getCode());
      if (getCode().length === 6) onComplete?.(getCode());
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && idx > 0) inputs[idx - 1].focus();
    });
    inp.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      t.split("").forEach((ch, i) => { if (inputs[i]) inputs[i].value = ch; });
      onInput?.(getCode());
      if (t.length === 6) onComplete?.(getCode());
      else inputs[Math.min(t.length, 5)].focus();
    });
  });
  return { inputs, getCode, reset };
}

export function renderVerifyScreen(root, user) {
  const boxes = Array.from({ length: 6 }, (_, i) =>
    `<input class="otp-box" data-i="${i}" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="digit ${i + 1}">`).join("");  root.innerHTML = `
  <div class="min-h-screen flex items-center justify-center px-4 theme-transition font-display">
    <div class="w-full max-w-md bg-cream-50 dark:bg-navy-800 rounded-2xl shadow-xl border border-cream-300/60 dark:border-navy-700 p-8 text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4">
        <i data-lucide="mail-check" class="w-7 h-7 text-amber-600 dark:text-amber-400"></i>
      </div>
      <h2 class="text-xl font-bold mb-1">Verify your email</h2>
      <p class="text-sm text-navy-500 dark:text-cream-300">${esc(user.email)}</p>
      <p id="codeHint" class="text-xs text-navy-400 mt-1 mb-5">Sending your 6-digit code…</p>
      <div id="otpRow" class="flex justify-center gap-2 mb-5">${boxes}</div>
      <button id="verifyCodeBtn" disabled class="w-full py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition disabled:opacity-40 disabled:cursor-not-allowed mb-3 flex items-center justify-center gap-2">
        <i data-lucide="shield-check" class="w-4 h-4"></i> Verify
      </button>
      <button id="resendBtn" disabled class="w-full py-2.5 rounded-xl bg-cream-200/70 dark:bg-navy-900/40 font-medium hover:bg-cream-300 dark:hover:bg-navy-700 transition disabled:opacity-50 mb-2">
        Resend code (<span id="cdText">–</span>s)
      </button>
      <button id="signoutBtn" class="text-xs text-navy-400 hover:text-red-500 transition">Use a different email</button>
    </div>
  </div>`;
  if (window.lucide) lucide.createIcons();

  const q = (s) => root.querySelector(s);
  const hint = q("#codeHint"), vbtn = q("#verifyCodeBtn"), rbtn = q("#resendBtn"), cd = q("#cdText"), row = q("#otpRow");
  let timer = null;

  const setCooldown = (s) => {
    clearInterval(timer);
    rbtn.disabled = true;
    const tick = () => {
      cd.textContent = s;
      if (s <= 0) { clearInterval(timer); rbtn.disabled = false; rbtn.textContent = "Resend code"; }
      s--;
    };
    tick();
    timer = setInterval(tick, 1000);
  };

  const otp = wireOtpBoxes(row, { onComplete: (c) => verify(c), onInput: () => refresh() });
  const getCode = otp.getCode;
  const resetBoxes = otp.reset;
  const refresh = () => { vbtn.disabled = otp.getCode().length !== 6; };

  async function send() {
    hint.textContent = "Sending your code…";
    let r = null;
    try {
      const idToken = await user.getIdToken().catch(() => "");
      r = await sendEmailCode(user.email, idToken);
    } catch (_) { r = null; } // network fail -> static hosting fallback
    if (r && r.sent) {
      hint.textContent = `Enter the 6-digit code we emailed you. Valid ${r.ttl_min || 10} min.`;
      setCooldown(r.cooldown || 45);
      resetBoxes();
      return;
    }
    // Static-host fallback: Firebase verification LINK (no backend needed)
    try {
      await fbSendLink(user);
      hint.innerHTML = '📡 Static mode: we emailed a <b>verification link</b> instead of a code.<br>Open it from this same browser to finish verifying.';
      setCooldown(60);
    } catch (_) {
      hint.textContent = "Could not send right now — tap Resend.";
      setCooldown(30);
    }
  }

  async function verify() {
    const code = getCode();
    if (code.length !== 6) return;
    vbtn.disabled = true; vbtn.textContent = "Verifying…";
    try {
      const r = await verifyEmailCode(user.email, code);
      if (r.ok) { vbtn.textContent = "Verified ✓"; await store.setEmailVerified(user.uid, true); window.location.reload(); return; }
      hint.textContent = r.message || "Verification failed.";
      row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
      resetBoxes(); refresh();
    } catch (_) { hint.textContent = "Network error — try again."; refresh(); }
    vbtn.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i> Verify';
    if (window.lucide) lucide.createIcons();
  }

  vbtn.onclick = () => verify();
  rbtn.onclick = send;
  q("#signoutBtn").onclick = () => signOutUser();
  send(); // auto-send on load
}

/* ---------------- Phone verification (SMS OTP via Firebase) ---------------- */
window.openPhoneVerify = () => {
  const back = document.createElement("div");
  back.className = "fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn";
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-md p-6 animate-scaleIn">
      <div class="flex justify-between items-start mb-3">
        <h2 class="text-xl font-bold flex items-center gap-2"><i data-lucide="phone" class="w-5 h-5 text-amber-500"></i> Verify phone number</h2>
        <button onclick="this.closest('.fixed').remove()" class="p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <p class="text-sm text-navy-500 dark:text-cream-300 mb-4">We'll send a one-time code via SMS. Your number is kept private and marked verified.</p>
      <div id="recaptcha-container"></div>
      <input id="phoneInput" type="tel" placeholder="+91 98765 43210" autocomplete="tel"
        class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm mb-3">
      <button id="sendOtp" class="w-full py-2.5 rounded-xl bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 font-semibold hover:scale-[1.01] transition">Send OTP</button>
      <div id="otpWrap" class="hidden mt-3">
        <div id="phoneOtpRow" class="flex justify-center gap-2 mb-4">${Array.from({ length: 6 }, () => '<input class="otp-box" type="text" inputmode="numeric" maxlength="1">').join("")}</div>
        <button id="verifyOtp" class="w-full py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition">Verify & Confirm</button>
      </div>
      <p id="phoneError" class="text-xs text-red-500 mt-3 hidden"></p>
    </div>`;
  document.body.appendChild(back);
  if (window.lucide) lucide.createIcons();

  const phoneInput = back.querySelector("#phoneInput");
  const sendBtn = back.querySelector("#sendOtp");
  const otpWrap = back.querySelector("#otpWrap");
  const otpRow = back.querySelector("#phoneOtpRow");
  const otp = wireOtpBoxes(otpRow);
  const verifyBtn = back.querySelector("#verifyOtp");
  const errEl = back.querySelector("#phoneError");
  const showErr = (m) => { errEl.textContent = m; errEl.classList.remove("hidden"); };
  const shakeRow = () => { otpRow.classList.remove("shake"); void otpRow.offsetWidth; otpRow.classList.add("shake"); otp.reset(); };
  const phone = () => phoneInput.value.trim();

  const verifier = getPhoneVerifier();
  let confirmation;
  sendBtn.onclick = async () => {
    const p = phone();
    if (!p.startsWith("+")) return showErr("Include country code, e.g. +91 98765 43210");
    errEl.classList.add("hidden"); sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    try {
      confirmation = await signInWithPhoneNumber(auth, p, verifier);
      otpWrap.classList.remove("hidden");
      if (window.toast) window.toast("OTP sent to " + p);
      let s = 60; sendBtn.disabled = true;
      const iv = setInterval(() => {
        sendBtn.textContent = `Resend OTP (${s}s)`;
        if (s-- <= 0) { clearInterval(iv); sendBtn.disabled = false; sendBtn.textContent = "Resend OTP"; }
      }, 1000);
    } catch (e) {
      showErr(prettyError(e.code) || e.message || "Could not send OTP");
      sendBtn.disabled = false; sendBtn.textContent = "Send OTP";
    }
  };
  verifyBtn.onclick = async () => {
    const code = otp.getCode();
    if (code.length !== 6) return showErr("Enter the 6-digit code");
    try {
      const cred = PhoneAuthProvider.credential(confirmation.verificationId, code);
      if (auth.currentUser) {
        await linkWithCredential(auth.currentUser, cred);
        await store.setPhoneVerified(auth.currentUser.uid, phone());
        if (window.state && window.state.user) {
          window.state.profile = await store.getUserProfile(auth.currentUser.uid);
          window.renderShell?.();
        }
        if (window.toast) window.toast("Phone verified & linked to your account");
      } else {
        const res = await signInWithCredential(auth, cred);
        await store.setPhoneVerified(res.user.uid, phone());
        if (window.toast) window.toast("Phone verified — signed in");
      }
      back.remove();
    } catch (e) {
      shakeRow();
      const msg = e.code === "auth/credential-already-in-use" || e.code === "auth/phone-number-already-exists"
        ? "This number is already linked to another account."
        : e.code === "auth/invalid-verification-code" ? "Wrong code — try again." : "Could not verify. Check the code.";
      showErr(msg);
    }
  };
};

function prettyError(code) {
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return map[code] || code;
}
