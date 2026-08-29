// public/js/app.js
import { auth } from "./firebase.js";
import { initAuth, renderAuthScreen, renderVerifyScreen, signOutUser, updateAuthPhoto, completeEmailLink } from "./auth.js";
import { apiPost } from "./api.js";
import * as store from "./store.js";

/* ---------------- State ---------------- */
const state = {
  user: null,
  profile: null,
  route: "home",
  posts: [],
  postsUnsub: null,
  dashboardTab: "library",
  studio: { step: 0, outline: [], meta: null, generating: false },
  writer: null
};

/* ---------------- Helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const elFrom = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const renderRichText = (t) => escapeHtml(t)
  .replace(/@(\w+)/g, '<span class="mention">@$1</span>')
  .replace(/#(\w+)/g, '<span class="hashtag">#$1</span>')
  .replace(/\n/g, "<br>");
const formatNum = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : (n || 0);
const refreshIcons = () => window.lucide && lucide.createIcons();

const ottleLogo = (size = "md") => {
  const h = size === "lg" ? "h-9" : size === "sm" ? "h-7" : "h-8";
  return `<img src="./logo.png" alt="Ottle" class="${h} w-auto object-contain">`;
};

let revealObserver;
function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  }
  $$(".reveal:not(.in)").forEach((el) => revealObserver.observe(el));
}

const skeletonBooks = (n) => `<div class="animate-fadeIn max-w-7xl mx-auto px-6 py-10">
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
    ${Array.from({ length: n }).map(() => `
      <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl overflow-hidden border border-cream-300/50 dark:border-navy-700">
        <div class="aspect-[3/4] skeleton"></div>
        <div class="p-4 space-y-2"><div class="h-4 w-3/4 skeleton"></div><div class="h-3 w-1/2 skeleton"></div><div class="h-4 w-1/4 skeleton mt-2"></div></div>
      </div>`).join("")}
  </div></div>`;

const skeletonPosts = (n) => `<div class="space-y-5">
  ${Array.from({ length: n }).map(() => `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700">
      <div class="flex items-center gap-3 mb-3"><div class="w-11 h-11 rounded-full skeleton"></div><div class="flex-1 space-y-2"><div class="h-3 w-1/3 skeleton"></div><div class="h-3 w-1/4 skeleton"></div></div></div>
      <div class="space-y-2"><div class="h-3 w-full skeleton"></div><div class="h-3 w-5/6 skeleton"></div><div class="h-3 w-2/3 skeleton"></div></div>
    </div>`).join("")}
  </div>`;

/* ---------- Generated covers ---------- */
const CSS_COVERS = [
  { c1: "#1c2950", c2: "#0d1429", pat: "pat-rays", frame: true },
  { c1: "#f5a623", c2: "#e08e0b", pat: "pat-dots", frame: false },
  { c1: "#0ea5e9", c2: "#1c2950", pat: "pat-waves", frame: true },
  { c1: "#9c6240", c2: "#684230", pat: "pat-grid", frame: false },
  { c1: "#155e75", c2: "#083344", pat: "pat-dots", frame: true },
  { c1: "#7e22ce", c2: "#3b0764", pat: "pat-rays", frame: false },
  { c1: "#166534", c2: "#052e16", pat: "pat-waves", frame: true },
  { c1: "#be123c", c2: "#4c0519", pat: "pat-grid", frame: false }
];

function coverArt(book, cls = "", scale = 1) {
  const c = book?.cover;
  if (c?.type === "image" && c.dataUrl) {
    return `<div class="${cls}" style="height:100%"><img src="${c.dataUrl}" class="w-full h-full object-cover rounded-inherit" alt=""></div>`;
  }
  const p = CSS_COVERS[c?.preset ?? 0] || CSS_COVERS[0];
  return `<div class="${cls}" style="height:100%"><div class="cover-css ${p.pat}${p.frame ? " cover-frame" : ""}" style="--c1:${p.c1};--c2:${p.c2};font-size:${scale}em">
      <span class="cover-title">${escapeHtml(book?.title || "Untitled")}</span>
      <span class="cover-author">${escapeHtml((book?.ownerName || "").slice(0, 26))}</span>
    </div></div>`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  t.className = "fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 text-sm shadow-xl animate-scaleIn";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function applyTheme() {
  const theme = localStorage.getItem("ottle-theme") || "light";
  state.theme = theme;
  const html = document.documentElement;
  html.classList.toggle("dark", theme === "dark");
  html.classList.toggle("light", theme !== "dark");
}
function toggleTheme() {
  const next = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("ottle-theme", next); applyTheme();
}

function fileToDataUrl(file, max = 256, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---------- Styled prompt/confirm (native dialogs ki jagah) ---------- */
function ottlePrompt({ title, value = "", placeholder = "", okText = "Create" } = {}) {
  return new Promise((resolve) => {
    const back = elFrom(`<div class="fixed inset-0 z-[60] modal-backdrop flex items-center justify-center p-4 animate-fadeIn">
      <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-sm p-6 animate-scaleIn font-display">
        <h3 class="font-bold text-lg mb-3">${escapeHtml(title || "")}</h3>
        <input id="opIn" class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm mb-4" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
        <div class="flex gap-2">
          <button id="opCancel" class="flex-1 py-2.5 rounded-xl bg-cream-200 dark:bg-navy-700 font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition">Cancel</button>
          <button id="opOk" class="flex-1 py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition">${okText}</button>
        </div>
      </div></div>`);
    document.body.appendChild(back);
    const inp = $("#opIn", back);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const done = (v) => { back.remove(); resolve(v); };
    $("#opOk", back).onclick = () => done((inp.value || "").trim());
    $("#opCancel", back).onclick = () => done(null);
    back.addEventListener("mousedown", (e) => { if (e.target === back) done(null); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done((inp.value || "").trim());
      if (e.key === "Escape") done(null);
    });
  });
}

function ottleConfirm(message, { okText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const btnCls = danger
      ? "bg-red-500 hover:bg-red-600 text-white"
      : "bg-amber-500 text-navy-900";
    const back = elFrom(`<div class="fixed inset-0 z-[60] modal-backdrop flex items-center justify-center p-4 animate-fadeIn">
      <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-sm p-6 animate-scaleIn font-display text-center">
        <p class="text-sm leading-relaxed mb-5">${message}</p>
        <div class="flex gap-2">
          <button id="ocCancel" class="flex-1 py-2.5 rounded-xl bg-cream-200 dark:bg-navy-700 font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition">Cancel</button>
          <button id="ocOk" class="flex-1 py-2.5 rounded-xl ${btnCls} font-semibold transition">${okText}</button>
        </div>
      </div></div>`);
    document.body.appendChild(back);
    const done = (v) => { back.remove(); resolve(v); };
    $("#ocOk", back).onclick = () => done(true);
    $("#ocCancel", back).onclick = () => done(false);
    back.addEventListener("mousedown", (e) => { if (e.target === back) done(false); });
  });
}

/* ---------------- Auth boot ---------------- */
function boot() {
  applyTheme();
  const root = $("#root");
  completeEmailLink().then((handled) => {
    if (handled) return; // link verify ho gaya, page khud reload hoga
    window.addEventListener("scroll", () => {
    const bar = document.getElementById("scrollProgress");
    if (bar) {
      const h = document.documentElement;
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
    }
  }, { passive: true });
  initAuth({
    onLogout: () => { cleanup(); root.innerHTML = ""; renderLanding(root); },
    onVerifyNeeded: (u) => { cleanup(); root.innerHTML = ""; renderVerifyScreen(root, u); },
    onEnter: async (u) => {
      state.user = u;
      root.innerHTML = "";
      state.profile = await store.ensureProfile(u.uid, { displayName: u.displayName, email: u.email, photoURL: u.photoURL });
      // Sync custom profile photo (Firestore is source of truth; Auth may be empty for email signups)
      if (!u.photoURL && state.profile?.photoURL) {
        u.photoURL = state.profile.photoURL;
        updateAuthPhoto(state.profile.photoURL).catch(() => {});
      }
      renderShell();
      renderRoute();
    }
  });
  // loading state
    root.innerHTML = `<div class="min-h-screen flex items-center justify-center"><div class="w-10 h-10 rounded-full border-4 border-amber-500 border-t-transparent animate-spin"></div></div>`;
  });
}

window.openAuth = (mode = "login") => {
  cleanup();
  const root = $("#root"); root.innerHTML = "";
  renderAuthScreen(root);
  if (mode === "signup") { const t = $("#tabSignup"); t && t.click(); }
};

/* ---------------- Logged-out landing page (alag webpage) ---------------- */
function animateCounters(scope) {
  $$("[data-count]", scope).forEach((el) => {
    const to = parseFloat(el.dataset.count); const suf = el.dataset.suffix || "";
    let cur = 0; const step = to / 38;
    const t = setInterval(() => {
      cur += step; if (cur >= to) { cur = to; clearInterval(t); }
      el.textContent = Math.floor(cur).toLocaleString() + suf;
    }, 22);
  });
}

async function renderLanding(root) {
  const stat = (label, count, suffix = "") => `
    <div>
      <p class="text-3xl sm:text-4xl font-extrabold font-display text-amber-600 dark:text-amber-400" data-count="${count}" data-suffix="${suffix}">${Number(count).toLocaleString() + suffix}</p>
      <p class="text-xs text-navy-500 dark:text-cream-300/80 mt-1">${label}</p>
    </div>`;
  const feat = (icon, title, desc, c) => `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-7 border border-cream-300/50 dark:border-navy-700 card-hover reveal group">
      <div class="w-12 h-12 rounded-xl bg-${c}-100 dark:bg-${c}-900/40 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-6 transition">
        <i data-lucide="${icon}" class="w-6 h-6 text-${c}-600 dark:text-${c}-400"></i>
      </div>
      <h3 class="text-xl font-bold mb-2 font-display">${title}</h3>
      <p class="text-sm text-navy-500 dark:text-cream-300/80 leading-relaxed">${desc}</p>
    </div>`;
  const step = (n, icon, title, desc) => `
    <div class="flex gap-4 items-start reveal">
      <div class="w-11 h-11 shrink-0 rounded-2xl bg-navy-800 dark:bg-amber-500 text-cream-100 dark:text-navy-900 flex items-center justify-center font-bold">${n}</div>
      <div><h4 class="font-semibold mb-1 flex items-center gap-2"><i data-lucide="${icon}" class="w-4 h-4 text-amber-500"></i>${title}</h4><p class="text-sm text-navy-500 dark:text-cream-300/80">${desc}</p></div>
    </div>`;
  let books = [], authors = 0;
  try { books = await store.getBooks(); } catch (e) {}
  try { authors = (await store.listUsers()).length; } catch (e) {}
  const featured = books.slice(0, 3);
  const heroBook = books[0];
  root.innerHTML = `
  <div class="font-display">
    <nav class="sticky top-0 z-40 bg-cream-50/90 dark:bg-navy-950/90 backdrop-blur-md border-b border-cream-300/50 dark:border-navy-700/60">
      <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        ${ottleLogo("lg")}
        <div class="hidden md:flex items-center gap-7 text-sm font-medium text-navy-600 dark:text-cream-300">
          <a href="#features" class="hover:text-amber-600 transition">Features</a>
          <a href="#how" class="hover:text-amber-600 transition">How it works</a>
          <a href="#pricing" class="hover:text-amber-600 transition">Pricing</a>
        </div>
        <div class="flex gap-2">
          <button onclick="openAuth('login')" class="px-4 py-2 rounded-full text-sm font-semibold hover:bg-cream-200 dark:hover:bg-navy-800 transition">Log in</button>
          <button onclick="openAuth('signup')" class="px-5 py-2 rounded-full text-sm font-semibold bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 hover:scale-105 transition btn-shine">Sign up free</button>
        </div>
      </div>
    </nav>

    <section class="relative overflow-hidden">
      <div class="absolute inset-0 pay-hero"></div>
      <div class="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-amber-500/20 blur-3xl animate-floatBlob"></div>
      <div class="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-sky-400/10 blur-3xl float-slow"></div>
      <div class="relative max-w-7xl mx-auto px-6 py-20 sm:py-28 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span class="inline-block px-3 py-1 rounded-full bg-white/10 text-amber-300 text-xs font-semibold mb-6 animate-slideUp">✦ The modern writing platform</span>
          <h1 class="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-cream-100 leading-[1.05] mb-6 animate-slideUp">Publish. Read. <span class="text-amber-400">Connect.</span></h1>
          <p class="max-w-xl text-lg text-cream-200/80 mb-8 animate-slideUp">Ottle is the home for independent storytellers — sell your eBooks, grow a social following, and draft with AI Studio.</p>
          <div class="flex flex-wrap gap-4 animate-slideUp">
            <button onclick="openAuth('signup')" class="px-7 py-3.5 rounded-full bg-amber-500 hover:bg-amber-600 text-navy-900 font-semibold transition btn-shine flex items-center gap-2"><i data-lucide="sparkles" class="w-5 h-5"></i> Start writing free</button>
            <button onclick="openAuth('login')" class="px-7 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-cream-100 font-semibold border border-white/20 transition flex items-center gap-2"><i data-lucide="book-open" class="w-5 h-5"></i> Browse Marketplace</button>
          </div>
        </div>
        <div class="relative hidden md:block">
          <div class="ml-auto w-64 rounded-2xl bg-cream-50 dark:bg-navy-800 p-4 shadow-2xl rotate-3 animate-floatBlob card-hover">
            ${heroBook ? `
              <div class="aspect-[3/4] rounded-xl bg-cover bg-center mb-3" style="background-image:url('https://picsum.photos/seed/${heroBook.cover}/300/400')"></div>
              <p class="font-bold">${escapeHtml(heroBook.title)}</p>
              <p class="text-xs text-navy-400">by ${escapeHtml(heroBook.ownerName || heroBook.author)}</p>
            ` : `
              <div class="aspect-[3/4] rounded-xl bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center text-center p-3">
                <p class="text-cream-100/80 text-sm leading-snug">Your book,<br>published here.</p>
              </div>
              <p class="font-bold mt-3">Your title</p>
              <p class="text-xs text-navy-400">by you</p>
            `}
          </div>
          <div class="absolute -bottom-6 -left-6 w-44 rounded-2xl bg-cream-50 dark:bg-navy-800 p-3 shadow-2xl -rotate-6 float-slow">
            <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ Blue Tick</p>
            <p class="text-[11px] text-navy-400 mt-1">Verified author badge</p>
          </div>
        </div>
      </div>
    </section>

    <section class="border-y border-cream-300/50 dark:border-navy-700/60 bg-cream-50/60 dark:bg-navy-900/30">
      <div class="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center reveal">
        ${stat("Books on marketplace", books.length)}
        ${stat("Authors", authors)}
        <div><p class="text-3xl sm:text-4xl font-extrabold font-display text-amber-600 dark:text-amber-400">₹19</p><p class="text-xs text-navy-500 dark:text-cream-300/80 mt-1">Blue Tick / year</p></div>
        <div><p class="text-3xl sm:text-4xl font-extrabold font-display text-amber-600 dark:text-amber-400">Free</p><p class="text-xs text-navy-500 dark:text-cream-300/80 mt-1">to start writing</p></div>
      </div>
    </section>

    <section id="features" class="max-w-7xl mx-auto px-6 py-20">
      <div class="text-center max-w-2xl mx-auto mb-12 reveal">
        <h2 class="text-3xl sm:text-4xl font-extrabold mb-3">Everything an indie author needs</h2>
        <p class="text-navy-500 dark:text-cream-300">One calm, focused space — from first draft to published page.</p>
      </div>
      <div class="grid md:grid-cols-3 gap-6">
        ${feat("book-open", "Marketplace", "Sell your eBooks to a global audience with zero upfront cost and fair royalties.", "navy")}
        ${feat("users", "Ottle Connect", "Build a following, share snippets, and engage with readers through a beautiful social feed.", "amber")}
        ${feat("sparkles", "AI Studio", "Turn a single prompt into a full chapter outline and streaming manuscript draft.", "sky")}
      </div>
    </section>

    <section id="how" class="max-w-7xl mx-auto px-6 pb-20 grid md:grid-cols-2 gap-10">
      <div class="reveal">${step(1, "pen-line", "Draft", "Outline and write with Ottle AI Studio or your own words.")}
        <div class="mt-5">${step(2, "upload", "Publish", "List your eBook in the marketplace in minutes.")}</div>
        <div class="mt-5">${step(3, "share-2", "Grow", "Share updates, gain readers, and build your brand on Connect.")}</div>
      </div>
      <div class="bg-cream-200 dark:bg-navy-800 rounded-3xl p-8 card-hover reveal reveal-left flex flex-col justify-center">
        <h3 class="text-2xl font-bold mb-3">Verified authors win trust</h3>
        <p class="text-sm text-navy-500 dark:text-cream-300/80 mb-5">Get a Blue Tick for just ₹19/year — a verified badge that boosts reach and shows readers you're the real deal. Admins carry a Gold Tick.</p>
        <button onclick="openAuth('signup')" class="self-start px-5 py-2.5 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 font-semibold hover:scale-105 transition">Create your account</button>
      </div>
    </section>

    <section class="max-w-7xl mx-auto px-6 py-20">
      <div class="text-center max-w-2xl mx-auto mb-10 reveal">
        <h2 class="text-3xl sm:text-4xl font-extrabold mb-3 font-display">On the marketplace</h2>
        <p class="text-navy-500 dark:text-cream-300">Real books published by Ottle authors.</p>
      </div>
      ${featured.length ? `<div class="grid sm:grid-cols-3 gap-6">
        ${featured.map(b=>`
          <div class="group bg-cream-50 dark:bg-navy-800 rounded-2xl overflow-hidden border border-cream-300/50 dark:border-navy-700 card-hover reveal">
            <div class="aspect-[3/4] bg-cover bg-center group-hover:scale-105 transition duration-500" style="background-image:url('https://picsum.photos/seed/${b.cover}/300/400')"></div>
            <div class="p-4"><h3 class="font-bold leading-snug group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">${escapeHtml(b.title)}</h3><p class="text-xs text-navy-400">${escapeHtml(b.ownerName || b.author)}</p></div>
          </div>`).join("")}
      </div>` : `<p class="text-center text-navy-400 py-10">No books published yet — be the first author on Ottle!</p>`}
    </section>

    <section id="pricing" class="max-w-7xl mx-auto px-6 pb-20">
      <div class="bg-gradient-to-br from-navy-800 to-navy-950 rounded-3xl p-10 text-center reveal reveal-scale">
        <h2 class="text-3xl font-extrabold text-cream-100 mb-2">Start free. Upgrade when you're ready.</h2>
        <p class="text-cream-200/70 mb-6">Core platform is free forever. Blue Tick verification is just <span class="text-amber-400 font-bold">₹19/year</span>.</p>
        <button onclick="openAuth('signup')" class="px-6 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-navy-900 font-semibold transition btn-shine">Join Ottle</button>
      </div>
    </section>

    <footer class="border-t border-cream-300 dark:border-navy-700 mt-8 py-8">
      <div class="max-w-7xl mx-auto px-6 text-center text-sm text-navy-400">
        <div class="mb-2 flex justify-center">${ottleLogo("sm")}</div>
        <p>Publish. Read. Connect. — The modern home for independent storytelling.</p>
      </div>
    </footer>
  </div>`;
  refreshIcons();
  observeReveals();
  animateCounters(root);
}

function cleanup() {
  if (state.postsUnsub) { state.postsUnsub(); state.postsUnsub = null; }
}

/* ---------------- Shell / Nav ---------------- */
function renderShell() {
  const root = $("#root");
  const p = state.profile;
  const initial = (p?.displayName || "O")[0]?.toUpperCase();
  const myPhoto = p?.photoURL || state.user.photoURL;
  const avatar = myPhoto
    ? `<img src="${myPhoto}" class="w-8 h-8 rounded-full ring-2 ring-amber-400/60" alt="">`
    : `<div class="w-8 h-8 rounded-full bg-navy-800 dark:bg-amber-500 text-cream-100 dark:text-navy-900 flex items-center justify-center font-semibold text-sm">${initial}</div>`;

  root.innerHTML = `
  <div id="scrollProgress" class="fixed top-0 left-0 h-1 bg-gradient-to-r from-amber-500 to-sky-500 z-[60] origin-left scale-x-0"></div>
  <nav class="sticky top-0 z-40 bg-cream-50/90 dark:bg-navy-900/90 backdrop-blur-md border-b border-cream-300/50 dark:border-navy-700/60">
    <div class="max-w-7xl mx-auto px-4 sm:px-6">
      <div class="flex items-center justify-between h-16 gap-4">
        <button onclick="navigate('home')" data-route="home" class="flex items-center gap-2 shrink-0 group">${ottleLogo()}</button>
        <div class="hidden md:flex flex-1 max-w-md items-center">
          <div class="relative w-full">
            <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-navy-400"></i>
            <input id="globalSearch" type="text" placeholder="Search authors (@username)..."
              class="w-full pl-9 pr-3 py-2 rounded-full bg-cream-200/60 dark:bg-navy-800 border border-transparent focus:border-amber-500 outline-none text-sm transition">
          </div>
        </div>
        <div class="flex items-center gap-1 sm:gap-2 text-sm">
          <button data-route="marketplace" onclick="navigate('marketplace')" class="nav-link px-2 sm:px-3 py-2 font-medium hover:text-amber-600 dark:hover:text-amber-400">Browse</button>
          <button data-route="connect" onclick="navigate('connect')" class="nav-link px-2 sm:px-3 py-2 font-medium hover:text-amber-600 dark:hover:text-amber-400">Connect</button>
          <button data-route="writer" onclick="navigate('writer')" class="nav-link px-2 sm:px-3 py-2 font-medium hover:text-amber-600 dark:hover:text-amber-400 flex items-center gap-1"><i data-lucide="pen-line" class="w-4 h-4"></i> Write</button>
          <button data-route="studio" onclick="navigate('studio')" class="nav-link px-2 sm:px-3 py-2 font-medium hover:text-amber-600 dark:hover:text-amber-400">AI Studio</button>
          <button onclick="toggleTheme()" class="ml-1 p-2 rounded-full hover:bg-cream-200 dark:hover:bg-navy-800 transition" title="Toggle theme">
            <i data-lucide="moon" id="tiMoon" class="w-5 h-5"></i><i data-lucide="sun" id="tiSun" class="w-5 h-5 hidden"></i>
          </button>
          <div class="relative" id="profileWrap">
            <button onclick="toggleProfile()" class="flex items-center gap-2 p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-800 transition">${avatar}</button>
            <div id="profileMenu" class="hidden absolute right-0 mt-2 w-56 bg-cream-50 dark:bg-navy-800 rounded-xl shadow-xl border border-cream-300 dark:border-navy-700 overflow-hidden animate-scaleIn z-50">
              <div class="px-4 py-3 border-b border-cream-300 dark:border-navy-700">
                <p class="font-semibold text-sm flex items-center gap-1">${escapeHtml(p?.displayName || "Author")} ${tickBadge(store.tickOf(p))}</p>
                <p class="text-xs text-navy-400">${escapeHtml(p?.handle || "")}</p>
                ${p?.role === "admin" ? '<p class="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-0.5">Admin · Gold tick</p>' : ""}
                ${p?.emailVerified ? '<p class="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Email verified ✓</p>' : '<p class="text-xs text-navy-400 mt-0.5">Email not verified</p>'}
              </div>
              <button onclick="navigate('dashboard')" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2"><i data-lucide="layout-dashboard" class="w-4 h-4"></i> Dashboard</button>
              <button onclick="openEditProfile()" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2"><i data-lucide="user-cog" class="w-4 h-4"></i> Edit profile / username</button>
              ${!p?.blueTick ? `<button onclick="openVerifyModal()" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2 text-sky-600 dark:text-sky-400"><i data-lucide="badge-check" class="w-4 h-4"></i> Get Blue Tick · ₹19/yr</button>` : `<div class="px-4 py-2.5 text-sm text-sky-600 dark:text-sky-400 flex items-center gap-2"><i data-lucide="badge-check" class="w-4 h-4"></i> Blue Tick active</div>`}
              ${!p?.phoneVerified ? `<button onclick="openPhoneVerify()" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2 text-emerald-600 dark:text-emerald-400"><i data-lucide="phone" class="w-4 h-4"></i> Verify phone number</button>` : `<div class="px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2"><i data-lucide="phone" class="w-4 h-4"></i> Phone verified</div>`}
              <button onclick="navigate('studio')" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2"><i data-lucide="sparkles" class="w-4 h-4"></i> AI Studio</button>
              <button onclick="navigate('marketplace')" class="w-full text-left px-4 py-2.5 text-sm hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2"><i data-lucide="book-open" class="w-4 h-4"></i> Marketplace</button>
              <hr class="border-cream-300 dark:border-navy-700">
              <button onclick="doSignOut()" class="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-2"><i data-lucide="log-out" class="w-4 h-4"></i> Sign out</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="md:hidden px-4 pb-3">
      <div class="relative w-full">
        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-navy-400"></i>
        <input id="globalSearchM" type="text" placeholder="Search authors (@username)..." class="w-full pl-9 pr-3 py-2 rounded-full bg-cream-200/60 dark:bg-navy-800 border border-transparent focus:border-amber-500 outline-none text-sm">
      </div>
    </div>
  </nav>
  <main id="app" class="pb-20 lg:pb-0"></main>
  <nav class="bottom-nav lg:hidden">
    <button class="bn-btn" data-route="home" onclick="navigate('home')"><i data-lucide="home" class="w-5 h-5"></i>Home</button>
    <button class="bn-btn" data-route="marketplace" onclick="navigate('marketplace')"><i data-lucide="book-open" class="w-5 h-5"></i>Browse</button>
    <button class="bn-btn" data-route="connect" onclick="navigate('connect')"><i data-lucide="users" class="w-5 h-5"></i>Connect</button>
    <button class="bn-btn" data-route="studio" onclick="navigate('studio')"><i data-lucide="sparkles" class="w-5 h-5"></i>Studio</button>
    <button class="bn-btn" data-route="writer" onclick="navigate('writer')"><i data-lucide="pen-line" class="w-5 h-5"></i>Write</button>
    <button class="bn-btn" data-route="dashboard" onclick="toggleProfile()"><i data-lucide="user" class="w-5 h-5"></i>You</button>
  </nav>
  <footer class="border-t border-cream-300 dark:border-navy-700 mt-16 py-8">
    <div class="max-w-7xl mx-auto px-6 text-center text-sm text-navy-400">
      <div class="mb-2 flex justify-center">${ottleLogo("sm")}</div>
      <p>Publish. Read. Connect. — The modern home for independent storytelling.</p>
    </div>
  </footer>`;
  refreshIcons();
  setActiveNav();
  attachAuthorSearch("globalSearch");
  attachAuthorSearch("globalSearchM");
  $("#tiSun").classList.toggle("hidden", state.theme !== "dark");
  $("#tiMoon").classList.toggle("hidden", state.theme === "dark");
}

window.toggleProfile = () => $("#profileMenu").classList.toggle("hidden");
window.doSignOut = () => signOutUser();
window.state = state;
window.renderShell = renderShell;
window.toggleTheme = toggleTheme;
window.toast = toast;
document.addEventListener("click", (e) => {
  if (!e.target.closest("#profileWrap")) $("#profileMenu")?.classList.add("hidden");
});

function setActiveNav() {
  const r = state.route;
  $$(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.route === r));
  $$(".bn-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === r));
}

async function renderAuthorResults(q, box) {
  q = q.trim().replace(/^@/, "").toLowerCase();
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const users = await store.listUsers();
  const res = users.filter((u) =>
    (u.username || "").toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q)
  ).slice(0, 6);
  box.innerHTML = res.length ? res.map((u) => `
    <button onclick="document.getElementById('${box.id}').classList.add('hidden');openUserProfile('${u.uid}')" class="w-full text-left px-3 py-2.5 hover:bg-cream-200 dark:hover:bg-navy-700 flex items-center gap-3 transition">
      <span class="w-8 h-8 rounded-full bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-cream-100 dark:text-navy-900 text-xs font-bold shrink-0">${escapeHtml((u.displayName || "A")[0]?.toUpperCase() || "A")}</span>
      <span class="min-w-0"><span class="block text-sm font-semibold truncate">${escapeHtml(u.displayName || "Author")} ${tickBadge(store.tickOf(u))}</span>
      <span class="block text-xs text-navy-400 truncate">@${escapeHtml(u.username || "")}</span></span>
    </button>`).join("") : `<p class="px-4 py-3 text-xs text-navy-400">No authors found for "${escapeHtml(q)}"</p>`;
  box.classList.remove("hidden");
  refreshIcons();
}

function attachAuthorSearch(id) {
  const inp = document.getElementById(id); if (!inp) return;
  let box = document.getElementById(id + "_results");
  if (!box) {
    box = elFrom(`<div id="${id}_results" class="hidden absolute left-0 right-0 top-full mt-2 bg-cream-50 dark:bg-navy-800 rounded-xl shadow-xl border border-cream-300 dark:border-navy-700 overflow-hidden z-50"></div>`);
    inp.parentElement.appendChild(box);
  }
  inp.addEventListener("input", () => renderAuthorResults(inp.value, box));
  inp.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = inp.value.trim().replace(/^@/, "").toLowerCase();
    if (!q) return;
    const users = await store.listUsers();
    const hit = users.find((u) => (u.username || "").toLowerCase() === q)
      || users.find((u) => (u.username || "").toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q));
    if (hit) { inp.value = ""; box.classList.add("hidden"); openUserProfile(hit.uid); }
    else toast(`No author found for "@${q}"`);
  });
}

/* ---------------- Router ---------------- */
window.navigate = (route) => {
  if (state.route === "connect" && route !== "connect") cleanup();
  state.route = route;
  $$(".nav-link").forEach(b => b.classList.remove("active"));
  renderRoute();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

function renderRoute() {
  const app = $("#app");
  app.innerHTML = "";
  ({
    home: renderHome, marketplace: renderMarketplace, connect: renderConnect,
    studio: renderStudio, dashboard: renderDashboard, writer: renderWriter
  }[state.route] || renderHome)(app);
  refreshIcons();
  observeReveals();
  setActiveNav();
  app.classList.remove("animate-viewIn"); void app.offsetWidth; app.classList.add("animate-viewIn");
}

/* ---------------- HOME ---------------- */
function renderHome(app) {
  const card = (icon, title, desc, accent) => `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-7 border border-cream-300/50 dark:border-navy-700 card-hover">
      <div class="w-12 h-12 rounded-xl bg-${accent}-100 dark:bg-${accent}-900/40 flex items-center justify-center mb-4">
        <i data-lucide="${icon}" class="w-6 h-6 text-${accent}-600 dark:text-${accent}-400"></i>
      </div>
      <h3 class="text-xl font-bold mb-2">${title}</h3>
      <p class="text-sm text-navy-500 dark:text-cream-300/80 leading-relaxed">${desc}</p>
    </div>`;
  app.innerHTML = `
  <div class="animate-fadeIn">
    <section class="relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950"></div>
      <div class="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-amber-500/20 blur-3xl"></div>
      <div class="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-cream-400/10 blur-3xl"></div>
      <div class="relative max-w-7xl mx-auto px-6 py-24 sm:py-32 text-center">
        <span class="inline-block px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-semibold mb-6 animate-slideUp">✦ The modern writing platform</span>
        <h1 class="text-4xl sm:text-6xl font-extrabold text-cream-100 leading-tight mb-6 animate-slideUp">Publish. Read. <span class="text-amber-400">Connect.</span></h1>
        <p class="max-w-2xl mx-auto text-lg text-cream-200/80 mb-10 animate-slideUp">Ottle is the home for independent storytellers — a marketplace to sell your books, a social feed to grow your readers, and an AI Studio to draft your next masterpiece.</p>
        <div class="flex flex-wrap gap-4 justify-center animate-slideUp">
          <button onclick="openWriter()" class="px-6 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-navy-900 font-semibold transition flex items-center gap-2"><i data-lucide="pen-line" class="w-5 h-5"></i> Start Writing</button>
          <button onclick="navigate('marketplace')" class="px-6 py-3 rounded-full bg-cream-100/10 hover:bg-cream-100/20 text-cream-100 font-semibold border border-cream-100/20 transition flex items-center gap-2"><i data-lucide="book-open" class="w-5 h-5"></i> Browse Marketplace</button>
        </div>
      </div>
    </section>
     <section class="max-w-7xl mx-auto px-6 py-20">
       <div class="grid md:grid-cols-3 gap-6 reveal">
        ${card("book-open", "Marketplace", "Sell your eBooks to a global audience with zero upfront cost and fair royalties.", "navy")}
        ${card("users", "Ottle Connect", "Build a following, share snippets, and engage with readers through a beautiful social feed.", "amber")}
        ${card("sparkles", "AI Studio", "Turn a single prompt into a full chapter outline and streaming manuscript draft.", "navy")}
      </div>
    </section>
     <section class="max-w-7xl mx-auto px-6 pb-20">
       <div class="bg-cream-200 dark:bg-navy-800 rounded-3xl p-10 text-center card-hover reveal reveal-scale">
        <h2 class="text-3xl font-bold mb-4">Join thousands of independent authors</h2>
        <p class="text-navy-500 dark:text-cream-300 mb-6 max-w-xl mx-auto">From first draft to published page — Ottle gives you every tool you need in one calm, focused space.</p>
        <button onclick="navigate('dashboard')" class="px-6 py-3 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 font-semibold hover:scale-105 transition">Open your Dashboard</button>
      </div>
    </section>
  </div>`;
}

/* ---------------- MARKETPLACE ---------------- */
async function renderMarketplace(app) {
  app.innerHTML = skeletonBooks(8);
  const books = await store.getBooks();
  const genres = ["All", "Fantasy", "Romance", "Mystery", "SciFi", "Horror"];
  app.innerHTML = `
  <div class="animate-fadeIn max-w-7xl mx-auto px-6 py-10">
    <div class="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
      <div>
        <h1 class="text-3xl font-extrabold mb-1">Browse Marketplace</h1>
        <p class="text-navy-500 dark:text-cream-300">Discover independent voices across every genre.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        ${genres.map((g, i) => `<button class="px-3 py-1.5 rounded-full text-sm ${i === 0 ? "bg-navy-800 text-cream-100 dark:bg-amber-500 dark:text-navy-900" : "bg-cream-200 dark:bg-navy-800 hover:bg-cream-300 dark:hover:bg-navy-700"} transition">${g}</button>`).join("")}
      </div>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
      ${books.length ? books.map(b => `
        <div class="group bg-cream-50 dark:bg-navy-800 rounded-2xl overflow-hidden border border-cream-300/50 dark:border-navy-700 card-hover cursor-pointer animate-fadeIn" onclick="openBookReader('${b.id}')">
          ${coverArt(b, "aspect-[3/4]", .9)}
          <div class="p-4">
            <h3 class="font-bold leading-snug group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">${escapeHtml(b.title)}</h3>
            <p class="text-xs text-navy-400 mb-2">${escapeHtml(b.ownerName || b.author || "Ottle author")} · ${(b.reads || 0)} reads</p>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-amber-600 dark:text-amber-400">${(b.price || 0) > 0 ? "₹" + b.price : "Free"}</span>
              <span class="text-xs flex items-center gap-1 text-navy-500 dark:text-cream-300"><i data-lucide="star" class="w-3.5 h-3.5 fill-amber-400 text-amber-400"></i>${b.rating || "new"}</span>
            </div>
          </div>
        </div>`).join("") : `<div class="col-span-full text-center py-16 text-navy-400"><i data-lucide="book-open" class="w-10 h-10 mx-auto mb-3 opacity-50"></i><p class="font-medium">No books published yet.</p><button onclick="openWriter()" class="mt-4 px-5 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Write the first one ✍️</button></div>`}
    </div>
  </div>`;
  refreshIcons();
}

window.openBookModal = (title) => {
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl max-w-md w-full p-6 animate-scaleIn">
      <div class="flex justify-between items-start mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
        <button onclick="this.closest('.fixed').remove()" class="p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <p class="text-sm text-navy-500 dark:text-cream-300 mb-6">A beautifully crafted independent title, ready to read on any device. Preview the first three chapters free, then unlock the full manuscript.</p>
      <div class="flex gap-3">
        <button class="flex-1 px-4 py-2.5 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 font-semibold hover:scale-105 transition">Buy now</button>
        <button class="flex-1 px-4 py-2.5 rounded-full bg-cream-200 dark:bg-navy-700 hover:bg-cream-300 dark:hover:bg-navy-600 transition">Add to library</button>
      </div>
    </div>`;
  document.body.appendChild(back); refreshIcons();
};

/* ---------------- CONNECT (social feed) ---------------- */
const tickBadge = (tick) =>
  tick === "gold"
    ? '<i data-lucide="badge-check" class="w-4 h-4 text-amber-400" title="Gold tick · Admin"></i>'
    : tick === "blue"
    ? '<i data-lucide="badge-check" class="w-4 h-4 text-sky-500" title="Verified author"></i>'
    : "";

function renderConnect(app) {
  const p = state.profile;
  app.innerHTML = `
  <div class="animate-fadeIn max-w-7xl mx-auto px-4 sm:px-6 py-8">
    <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-6">
      <aside class="sidebar-mobile hidden lg:block">
        <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700 sticky top-20">
          <h2 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="user-plus" class="w-4 h-4 text-amber-500"></i> Suggested Authors</h2>
          <div id="suggestedAuthors" class="space-y-4">
            <p class="text-xs text-navy-400">Loading authors…</p>
          </div>
        </div>
      </aside>

      <section class="feed-mobile-pad">
        <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-4 border border-cream-300/50 dark:border-navy-700 mb-6 card-hover cursor-text" onclick="openCreatePost()">
          <div class="flex gap-3">
            ${(state.profile?.photoURL || state.user.photoURL) ? `<img src="${state.profile?.photoURL || state.user.photoURL}" class="w-10 h-10 rounded-full object-cover" alt="">` : `<div class="w-10 h-10 rounded-full bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-sm font-bold text-cream-100 dark:text-navy-900">${(state.profile?.displayName || "O")[0]?.toUpperCase()}</div>`}
            <div class="flex-1 bg-cream-200/60 dark:bg-navy-900/40 rounded-full px-4 flex items-center text-navy-400 text-sm">Share an update with your readers...</div>
          </div>
          <div class="flex justify-between mt-3">
            <div class="flex gap-2 ml-12">
              <span class="text-xs px-3 py-1.5 rounded-full bg-cream-200 dark:bg-navy-700 flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i> Media</span>
              <span class="text-xs px-3 py-1.5 rounded-full bg-cream-200 dark:bg-navy-700 flex items-center gap-1"><i data-lucide="book" class="w-3.5 h-3.5"></i> Book link</span>
              <span class="text-xs px-3 py-1.5 rounded-full bg-cream-200 dark:bg-navy-700 flex items-center gap-1"><i data-lucide="hash" class="w-3.5 h-3.5"></i> Tag</span>
            </div>
            <button class="px-4 py-1.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Post</button>
          </div>
        </div>
         <div id="feedList" class="space-y-5">${skeletonPosts(3)}</div>
      </section>

      <aside class="sidebar-mobile hidden lg:block">
        <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700 sticky top-20">
          <h2 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="trending-up" class="w-4 h-4 text-amber-500"></i> Trending Hashtags</h2>
          <div id="trendingTags" class="space-y-1">
            <p class="text-xs text-navy-400">Loading…</p>
          </div>
        </div>
      </aside>
    </div>`;
  refreshIcons();

  loadSuggestedAuthors();
  loadTrendingTags();

  state.postsUnsub = store.subscribePosts((posts) => {
    state.posts = posts; renderFeed(); loadTrendingTags();
  });
}

async function loadSuggestedAuthors() {
  const box = $("#suggestedAuthors"); if (!box) return;
  try {
    const users = await store.listUsers();
    const others = users.filter(u => u.uid !== state.user.uid).slice(0, 4);
    if (!others.length) { box.innerHTML = `<p class="text-xs text-navy-400">No other authors yet.</p>`; return; }
    box.innerHTML = others.map(u => `
      <div class="flex items-center gap-3">
        <div onclick="openUserProfile('${u.uid}')" class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
          ${u.photoURL ? `<img src="${u.photoURL}" class="w-10 h-10 rounded-full" alt="">` : `<div class="w-10 h-10 rounded-full bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-cream-100 dark:text-navy-900 font-semibold">${(u.displayName||"A")[0]?.toUpperCase()}</div>`}
          <div class="min-w-0">
            <p class="text-sm font-semibold truncate flex items-center gap-1">${escapeHtml(u.displayName || "Author")} ${tickBadge(u.goldTick ? "gold" : u.blueTick ? "blue" : "")}</p>
            <p class="text-xs text-navy-400">${escapeHtml(u.handle || "")}</p>
          </div>
        </div>
        <button onclick="event.stopPropagation(); store.toggleFollow(state.user.uid,'${u.uid}').then(()=>loadSuggestedAuthors())" class="text-xs px-3 py-1.5 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 font-medium hover:scale-105 transition">Follow</button>
      </div>`).join("");
    refreshIcons();
  } catch (e) { box.innerHTML = `<p class="text-xs text-navy-400">Sign in to see authors.</p>`; }
}

async function loadTrendingTags() {
  const box = $("#trendingTags"); if (!box) return;
  const counts = {};
  (state.posts || []).forEach(p => {
    (p.content || "").match(/#(\w+)/g)?.forEach(t => { const k = t.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!top.length) { box.innerHTML = `<p class="text-xs text-navy-400">No hashtags yet.</p>`; return; }
  box.innerHTML = top.map((t, i) => `
    <button class="w-full flex items-center justify-between p-2 rounded-lg hover:bg-cream-200 dark:hover:bg-navy-700 transition text-left">
      <div><p class="text-sm font-semibold text-amber-600 dark:text-amber-400">${escapeHtml(t[0])}</p><p class="text-xs text-navy-400">${t[1]} post${t[1] > 1 ? "s" : ""}</p></div>
      <span class="text-xs text-navy-300 dark:text-cream-400 font-bold">#${i + 1}</span>
    </button>`).join("");
  refreshIcons();
}

function renderFeed() {
  const list = $("#feedList"); if (!list) return;
  if (!state.posts.length) { list.innerHTML = `<p class="text-center text-navy-400 py-10">No posts yet. Be the first to share!</p>`; return; }
  list.innerHTML = state.posts.map((p, i) => postCard(p, i)).join("");
  refreshIcons();
}

function postCard(p, i = 0) {
  const liked = p.likedBy?.includes(state.user.uid);
  return `
  <article class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700 card-hover animate-fadeIn" style="animation-delay:${i * 55}ms">
    <div class="flex items-start gap-3">
      ${p.avatar
        ? `<img src="${p.avatar}" ${p.uid ? `onclick="openUserProfile('${p.uid}')" class="w-11 h-11 rounded-full object-cover cursor-pointer hover:opacity-80 transition"` : 'class="w-11 h-11 rounded-full object-cover"'} alt="">`
        : `<div ${p.uid ? `onclick="openUserProfile('${p.uid}')"` : ''} class="w-11 h-11 rounded-full bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-sm font-bold text-cream-100 dark:text-navy-900 shrink-0 ${p.uid ? "cursor-pointer hover:opacity-80 transition" : ""}">${escapeHtml((p.author || "A")[0]?.toUpperCase() || "A")}</div>`}
      <div class="flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          ${p.uid ? `<button onclick="openUserProfile('${p.uid}')" class="font-semibold text-sm hover:underline">${escapeHtml(p.author)}</button>` : `<span class="font-semibold text-sm">${escapeHtml(p.author)}</span>`}
          ${tickBadge(p.tick)}
          <span class="text-navy-400 text-sm">${escapeHtml(p.handle || "")}</span>
          <span class="text-navy-300 dark:text-cream-400 text-sm">· just now</span>
        </div>
        <p class="mt-2 text-sm leading-relaxed">${renderRichText(p.content)}</p>
        ${p.image ? `<img src="${p.image}" class="mt-3 w-full max-h-96 object-cover rounded-xl border border-cream-300/50 dark:border-navy-700" alt="">` : ""}
        ${p.bookLink ? `<div class="mt-3 flex gap-3 items-center bg-cream-200/60 dark:bg-navy-900/40 rounded-xl p-3 border border-cream-300/50 dark:border-navy-700">
          <img src="${p.bookLink.cover}" class="w-12 h-16 rounded-md object-cover" alt="">
          <div><p class="text-xs text-navy-400 mb-0.5">Attached book</p><p class="font-semibold text-sm">${escapeHtml(p.bookLink.title)}</p></div>
        </div>` : ""}
        <div class="flex items-center gap-1 mt-4 text-navy-400">
          <button onclick="likePost('${p.id}')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 transition ${liked ? "text-amber-500" : ""}">
            <i data-lucide="heart" class="w-4 h-4 ${liked ? "fill-amber-500" : ""}"></i><span class="text-xs font-medium">${formatNum(p.likes)}</span>
          </button>
          <button onclick="toggleComments(this)" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 transition">
            <i data-lucide="message-circle" class="w-4 h-4"></i><span class="text-xs font-medium">${formatNum(p.comments)}</span>
          </button>
          <button onclick="sharePost('${p.id}')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 transition">
            <i data-lucide="share-2" class="w-4 h-4"></i><span class="text-xs font-medium">${formatNum(p.shares)}</span>
          </button>
        </div>
        <div class="comment-box hidden mt-3 border-t border-cream-300/50 dark:border-navy-700 pt-3">
          <div class="flex gap-2">
            <input type="text" placeholder="Write a comment..." class="flex-1 text-sm px-3 py-2 rounded-full bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none">
            <button onclick="addComment('${p.id}')" class="px-3 py-2 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 text-xs font-semibold">Send</button>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

window.likePost = (id) => { store.toggleLike(id, state.user.uid).catch(() => toast("Could not like post")); };
window.toggleComments = (btn) => btn.closest("article").querySelector(".comment-box").classList.toggle("hidden");
window.sharePost = () => toast("Link copied to clipboard");
window.addComment = (id) => { store.addComment(id).catch(() => {}); toast("Comment posted"); };

/* ---------------- Blue-tick verification (Razorpay Standard Checkout) ---------------- */
async function payWithRazorpay(amountInr, onSuccess, onFailure) {
  let order;
  try {
    order = await apiPost("/api/create-order", "create-order",
      { amount: amountInr * 100, receipt: "ottle_" + Date.now() });
  } catch (e) { toast("Could not reach payment server."); return onFailure?.(); }
  if (!order || order.error || !order.order_id) { toast((order && (order.detail || order.error)) || "Payment could not start."); return onFailure?.(); }

  const rzp = new Razorpay({
    key: order.key_id,
    order_id: order.order_id,
    amount: order.amount,
    currency: order.currency,
    name: "Ottle",
    description: "Blue Tick Verification (1 yr)",
    prefill: { email: state.user.email || "" },
    theme: { color: "#0ea5e9" },
    modal: { ondismiss: () => { toast("Payment cancelled."); onFailure?.(); } },
    handler: async (res) => {
      try {
        const v = await apiPost("/api/verify-payment", "verify-payment", res);
        if (v && v.verified) return onSuccess(res);
        toast((v && v.error) || "Payment verification failed.");
      } catch (_) { toast("Verification request failed."); }
      onFailure?.();
    }
  });
  rzp.on("payment.failed", () => { toast("Payment failed. Try another method."); onFailure?.(); });
  rzp.open();
}

window.openVerifyModal = () => {
  const price = store.BLUE_TICK_YEARLY_INR;
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="w-full max-w-md overflow-hidden rounded-3xl bg-cream-50 dark:bg-navy-800 pay-card animate-scaleIn font-display">
      <div class="pay-hero px-6 py-7 text-center relative">
        <button onclick="this.closest('.fixed').remove()" class="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-cream-100"><i data-lucide="x" class="w-5 h-5"></i></button>
        <div class="w-14 h-14 mx-auto rounded-2xl bg-white/15 flex items-center justify-center mb-3 glow"><i data-lucide="badge-check" class="w-7 h-7 text-sky-300"></i></div>
        <h2 class="text-2xl font-extrabold text-cream-100">Get your Blue Tick</h2>
        <p class="text-cream-200/80 text-sm mt-1">Verified author badge · 12 months</p>
      </div>
      <div class="p-6">
        <div class="flex items-center justify-between bg-cream-200/60 dark:bg-navy-900/40 rounded-2xl p-4 mb-5">
          <div class="flex items-center gap-3">
            <i data-lucide="badge-check" class="w-6 h-6 text-sky-500"></i>
            <div><p class="font-bold">Blue Tick Verification</p><p class="text-xs text-navy-400">Valid for 1 year · auto-renews</p></div>
          </div>
          <p class="text-2xl font-extrabold text-amber-600 dark:text-amber-400">₹${price}<span class="text-sm font-medium text-navy-400">/yr</span></p>
        </div>

        <p class="text-xs font-semibold text-navy-500 dark:text-cream-300 mb-2">WHAT YOU GET</p>
        <ul class="space-y-2 mb-5 text-sm">
          ${["Verified badge next to your name everywhere", "Higher trust & reach with readers", "Priority in Connect & Marketplace", "A glowing profile ring"]
            .map(b => `<li class="flex items-center gap-2 text-navy-600 dark:text-cream-300"><i data-lucide="check-circle-2" class="w-4 h-4 text-sky-500"></i>${b}</li>`).join("")}
        </ul>

        <p class="text-xs font-semibold text-navy-500 dark:text-cream-300 mb-2">PAY WITH</p>
        <div class="grid grid-cols-2 gap-2 mb-5">
          ${[["upi","UPI"],["credit-card","Card"],["landmark","Net Banking"],["smartphone","Wallet"]]
            .map(([ic, lb], i) => `<button class="pay-method rounded-xl py-2.5 flex items-center justify-center gap-2 text-sm font-medium ${i === 0 ? "sel" : ""}" data-m="${lb}"><i data-lucide="${ic}" class="w-4 h-4"></i>${lb}</button>`).join("")}
        </div>

        <div class="flex items-center justify-between text-sm mb-4 bg-cream-100 dark:bg-navy-900/50 rounded-xl px-4 py-3">
          <span class="text-navy-500 dark:text-cream-300">Blue Tick (1 yr)</span>
          <span class="font-bold">₹${price}</span>
        </div>

        <button id="payBtn" class="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold transition btn-shine flex items-center justify-center gap-2">
          <i data-lucide="lock" class="w-4 h-4"></i> Pay ₹${price} & Get Verified
        </button>
        <p class="text-[11px] text-navy-400 text-center mt-3 flex items-center justify-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i> Secured checkout · Cancel anytime</p>
      </div>
    </div>`;
  document.body.appendChild(back); refreshIcons();

  back.querySelectorAll(".pay-method").forEach((m) => m.onclick = () => {
    back.querySelectorAll(".pay-method").forEach((x) => x.classList.remove("sel"));
    m.classList.add("sel");
  });

  $("#payBtn", back).onclick = () => {
    const btn = $("#payBtn", back);
    btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="w-5 h-5 animate-spin"></i> Processing…`; refreshIcons();
    const resetBtn = () => { btn.disabled = false; btn.innerHTML = `<i data-lucide="lock" class="w-4 h-4"></i> Pay ₹${price} & Get Verified`; refreshIcons(); };
    payWithRazorpay(price, async () => {
      await store.purchaseBlueTick(state.user.uid, price);
      state.profile = await store.getUserProfile(state.user.uid);
      back.innerHTML = `
        <div class="bg-cream-50 dark:bg-navy-800 rounded-3xl w-full max-w-md p-8 text-center animate-scaleIn font-display">
          <div class="w-16 h-16 mx-auto rounded-full bg-sky-500/15 flex items-center justify-center mb-4"><i data-lucide="check" class="w-8 h-8 text-sky-500"></i></div>
          <h2 class="text-2xl font-extrabold mb-2">You're verified!</h2>
          <p class="text-sm text-navy-500 dark:text-cream-300 mb-6">Your Blue Tick is active for 12 months. ₹${price} charged.</p>
          <button onclick="this.closest('.fixed').remove()" class="px-6 py-2.5 rounded-full bg-sky-500 text-white font-semibold hover:scale-105 transition">Done</button>
        </div>`;
      refreshIcons();
      $("#profileMenu")?.classList.add("hidden");
      toast("Blue Tick activated — ₹" + price + " charged");
    }, resetBtn);
  };
};

/* ---------------- Edit profile / username ---------------- */
window.openEditProfile = () => {
  const p = state.profile;
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-md p-6 animate-scaleIn">
      <div class="flex justify-between items-start mb-4">
        <h2 class="text-xl font-bold flex items-center gap-2"><i data-lucide="user-cog" class="w-5 h-5 text-amber-500"></i> Edit profile</h2>
        <button onclick="this.closest('.fixed').remove()" class="p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="flex items-center gap-4 mb-4">
        ${state.user.photoURL
          ? `<img id="epAvatar" src="${state.user.photoURL}" class="w-16 h-16 rounded-full object-cover ring-2 ring-amber-400/60">`
          : `<div id="epAvatar" class="w-16 h-16 rounded-full bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-xl font-bold text-cream-100 dark:text-navy-900">${(p?.displayName||"O")[0]?.toUpperCase()}</div>`}
        <label class="cursor-pointer px-3 py-1.5 rounded-full bg-cream-200 dark:bg-navy-700 text-sm font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition flex items-center gap-2">
          <i data-lucide="camera" class="w-4 h-4"></i> Change photo<input id="epPhoto" type="file" accept="image/*" class="hidden">
        </label>
      </div>
      <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Display name</label>
      <input id="epName" type="text" value="${escapeHtml(p?.displayName || "")}" class="w-full px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm mb-3">
      <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Username</label>
      <div class="flex items-center mb-1 px-3 py-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus-within:border-amber-500">
        <span class="text-navy-400 text-sm mr-1">@</span>
        <input id="epUser" type="text" value="${escapeHtml(p?.username || "")}" placeholder="yourname" class="flex-1 bg-transparent outline-none text-sm">
      </div>
      <p class="text-xs text-navy-400 mb-4">Letters, numbers & underscores only. Shown as your handle across Ottle.</p>
      <button id="epSave" class="w-full py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-105 transition">Save changes</button>
    </div>`;
  document.body.appendChild(back); refreshIcons();
  let newPhoto = null;
  $("#epPhoto", back).onchange = async () => {
    const f = $("#epPhoto", back).files[0]; if (!f) return;
    try { newPhoto = await fileToDataUrl(f, 256, 0.82); const a = $("#epAvatar", back); if (a.tagName === "IMG") a.src = newPhoto; }
    catch (_) { toast("Could not read image"); }
  };
  $("#epSave", back).onclick = async () => {
    const name = $("#epName", back).value.trim();
    const user = $("#epUser", back).value.trim().replace(/[^a-z0-9_]/gi, "");
    if (!name) return toast("Display name can't be empty");
    try {
      await store.updateProfile(state.user.uid, { displayName: name, username: user, photoURL: newPhoto });
      if (newPhoto) { state.user.photoURL = newPhoto; updateAuthPhoto(newPhoto).catch(() => {}); }
      state.profile = await store.getUserProfile(state.user.uid);
      toast("Profile updated"); back.remove();
      $("#profileMenu")?.classList.add("hidden");
      renderShell();
    } catch (e) { toast(e.message || "Could not save"); }
  };
};

window.openCreatePost = () => {
  const MAX = 280;
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-lg p-5 animate-scaleIn">
      <div class="flex justify-between items-center mb-4">
        <h2 class="font-bold text-lg">Create a post</h2>
        <button onclick="this.closest('.fixed').remove()" class="p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="flex gap-3">
        ${state.user.photoURL ? `<img src="${state.user.photoURL}" class="w-10 h-10 rounded-full" alt="">` : `<div class="w-10 h-10 rounded-full bg-navy-800 dark:bg-amber-500"></div>`}
        <div class="flex-1">
          <textarea id="postText" rows="4" maxlength="${MAX}" placeholder="What are you working on? Use #hashtags and @mentions..."
            class="w-full bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-navy-400"></textarea>
          <input id="postImgInput" type="file" accept="image/*" class="hidden">
          <img id="postImgPreview" class="hidden mt-2 w-full max-h-64 object-cover rounded-xl border border-cream-300/50 dark:border-navy-700" alt="">
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-cream-300/50 dark:border-navy-700">
            <div class="flex gap-1">
              <button onclick="document.getElementById('postImgInput').click()" class="p-2 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 text-sky-600 dark:text-sky-400" title="Add image"><i data-lucide="image" class="w-4 h-4"></i></button>
              <button class="p-2 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 text-navy-500" title="Add hashtag"><i data-lucide="hash" class="w-4 h-4"></i></button>
            </div>
            <div class="flex items-center gap-3">
              <span id="charCount" class="text-xs text-navy-400">0/${MAX}</span>
              <button id="postSubmit" disabled class="px-4 py-1.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition">Post</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back); refreshIcons();
  const ta = $("#postText", back), count = $("#charCount", back), submit = $("#postSubmit", back);
  let postImage = null;
  $("#postImgInput", back).onchange = async () => {
    const f = $("#postImgInput", back).files[0]; if (!f) return;
    try {
      postImage = await fileToDataUrl(f, 900, 0.8);
      const pv = $("#postImgPreview", back); pv.src = postImage; pv.classList.remove("hidden");
    } catch (_) { toast("Could not read image"); }
  };
  ta.focus();
  ta.addEventListener("input", () => {
    const len = ta.value.length; count.textContent = `${len}/${MAX}`;
    count.classList.toggle("text-red-500", len > MAX - 20); submit.disabled = len === 0 || len > MAX;
  });
  submit.addEventListener("click", async () => {
    const text = ta.value.trim(); if (!text) return;
    const p = state.profile;
    await store.addPost({
      uid: state.user.uid, author: p?.displayName || state.user.email,
      handle: p?.handle || "", avatar: p?.photoURL || "",
      tick: store.tickOf(p), content: text,
      image: postImage, bookLink: null
    });
    back.remove(); toast("Post published");
  });
};

/* ---------------- Public user profile (Instagram/LinkedIn style) ---------------- */
window.openUserProfile = async (uid) => {
  const app = $("#app"); if (!app) return;
  state._prevRoute = state.route;
  app.innerHTML = `<div class="py-24 text-center text-navy-400"><div class="w-8 h-8 mx-auto rounded-full border-4 border-amber-500 border-t-transparent animate-spin"></div></div>`;
  let u, posts, pubs;
  try { [u, posts, pubs] = await Promise.all([store.getUserProfile(uid), store.getPostsByUser(uid), store.getPublishedByOwner(uid).catch(() => [])]); }
  catch (e) { app.innerHTML = `<p class="text-center py-24 text-navy-400">Could not load profile.</p>`; return; }
  if (!u) { app.innerHTML = `<p class="text-center py-24 text-navy-400">User not found.</p>`; return; }

  const me = state.user.uid;
  const isMe = me === uid;
  const following = (u.followers || []).includes(me);
  const initial = (u.displayName || "A")[0]?.toUpperCase();
  const avatar = u.photoURL
    ? `<img src="${u.photoURL}" class="w-24 h-24 rounded-full ring-4 ring-cream-50 dark:ring-navy-800 object-cover relative z-10 -mt-12" alt="">`
    : `<div class="w-24 h-24 rounded-full bg-navy-800 dark:bg-amber-500 relative z-10 -mt-12 flex items-center justify-center text-3xl font-bold text-cream-100 dark:text-navy-900 ring-4 ring-cream-50 dark:ring-navy-800">${initial}</div>`;

  app.innerHTML = `
  <div class="max-w-3xl mx-auto animate-viewIn font-display">
    <button onclick="navigate('${state._prevRoute || "connect"}')" class="flex items-center gap-1 text-sm text-navy-500 hover:text-amber-600 px-6 pt-4 transition"><i data-lucide="arrow-left" class="w-4 h-4"></i> Back</button>
    <div class="h-32 sm:h-40 rounded-b-3xl bg-gradient-to-r from-navy-800 via-navy-700 to-navy-900 dark:from-navy-900 dark:to-navy-950 relative overflow-hidden mt-2">
      <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/20 blur-2xl"></div>
      ${store.tickOf(u) === "gold" ? '<span class="ottle-admin-badge">Ottle Admin</span>' : ""}
    </div>
    <div class="px-6">
      <div class="flex items-end justify-between">
        ${avatar}
        <div class="mb-2">
          ${isMe
            ? `<button onclick="openEditProfile()" class="px-4 py-2 rounded-full bg-cream-200 dark:bg-navy-700 font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition text-sm">Edit profile</button>`
            : `<button id="followBtn" class="px-5 py-2 rounded-full font-semibold text-sm transition ${following ? "bg-cream-200 dark:bg-navy-700 hover:bg-cream-300 dark:hover:bg-navy-600" : "bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 hover:scale-105"}">${following ? "Following" : "Follow"}</button>`}
        </div>
      </div>
      <div class="mt-3">
        <h1 class="text-2xl font-extrabold flex items-center gap-2">${escapeHtml(u.displayName || "Author")} ${tickBadge(store.tickOf(u))}</h1>
        <p class="text-navy-400 text-sm">${escapeHtml(u.handle || "")}</p>
        <p class="text-sm text-navy-600 dark:text-cream-300 mt-3 max-w-xl">${escapeHtml(u.bio || "Independent author on Ottle. Sharing stories, one chapter at a time.")}</p>
      </div>
      <div class="flex gap-8 mt-4 mb-2 text-sm">
        <span><b class="font-bold">${posts.length}</b> Posts</span>
        <span><b class="font-bold">${(u.followers || []).length}</b> Followers</span>
        <span><b class="font-bold">${(u.following || []).length}</b> Following</span>
      </div>
      ${pubs?.length ? `
      <div class="mt-4">
        <h3 class="font-bold text-sm mb-3 flex items-center gap-2"><i data-lucide="library" class="w-4 h-4 text-amber-500"></i> Published Works</h3>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          ${pubs.slice(0, 8).map(b => `
            <button onclick="openBookReader('${b.id}')" class="rounded-lg overflow-hidden card-hover aspect-[3/4]">${coverArt(b, "", .5)}</button>`).join("")}
        </div>
      </div>` : ""}
      <hr class="border-cream-300 dark:border-navy-700 my-4">
      <h3 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="layout-grid" class="w-4 h-4 text-amber-500"></i> Posts</h3>
      <div class="space-y-5 pb-10">
        ${posts.length ? posts.map((p, i) => postCard(p, i)).join("") : `<p class="text-center text-navy-400 py-10">No posts yet.</p>`}
      </div>
    </div>
  </div>`;
  refreshIcons();
  $("#followBtn")?.addEventListener("click", async () => {
    await store.toggleFollow(me, uid);
    openUserProfile(uid);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
};

/* ---------------- WRITER (Write by Yourself) + READER ---------------- */
window.openWriter = async (bookId = null) => {
  if (bookId) {
    const b = await store.getBookById(bookId);
    if (!b || b.ownerId !== state.user.uid) return toast("Book not found");
    state.writer = { bookId, meta: b, chapters: await store.getChapters(bookId), active: 0 };
  } else {
    const t = await ottlePrompt({ title: "✍️ Start a new book", placeholder: "My New Book", okText: "Create draft" });
    if (t === null) return;
    const title = t.trim() || "Untitled";
    try {
      const id = await store.createBook({ uid: state.user.uid, ownerName: state.profile?.displayName || "", title });
      state.writer = { bookId: id, meta: { id, title, blurb: "", genre: "General", status: "draft", ownerName: state.profile?.displayName || "", cover: null }, chapters: [], active: -1 };
    } catch (e) { return toast("Draft failed: " + (e.code || e.message || "unknown")); }
  }
  navigate("writer");
};

function renderWriter(app) {
  const host = app || $("#app");
  const W = state.writer;
  if (!W) { host.innerHTML = `<p class="text-center py-20 text-navy-400">No book open. <button onclick="openWriter()" class="text-amber-600 underline">Start one</button></p>`; return; }
  const m = W.meta;
  const ch = W.chapters[W.active];
  host.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 animate-fadeIn">
    <div class="flex flex-wrap items-center gap-2 mb-5">
      <button onclick="navigate('dashboard')" class="p-2 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700 transition"><i data-lucide="arrow-left" class="w-5 h-5"></i></button>
      <input id="wTitle" value="${escapeHtml(m.title)}" class="font-display text-xl font-extrabold bg-transparent outline-none focus:border-b-2 border-amber-500 min-w-[200px] flex-1">
      <span class="text-xs px-3 py-1 rounded-full ${m.status === "published" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-cream-200 dark:bg-navy-700 text-navy-500 dark:text-cream-300"}">${m.status === "published" ? "● Published" : "● Draft"}</span>
      <span id="wSaveInd" class="text-xs text-navy-400"></span>
      <div class="flex gap-2 ml-auto flex-wrap">
        <button onclick="openCoverDesigner()" class="px-4 py-2 rounded-full bg-cream-200 dark:bg-navy-700 text-sm font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition flex items-center gap-2"><i data-lucide="palette" class="w-4 h-4"></i> Cover</button>
        <button onclick="openBookDetails()" class="px-4 py-2 rounded-full bg-cream-200 dark:bg-navy-700 text-sm font-medium hover:bg-cream-300 dark:hover:bg-navy-600 transition flex items-center gap-2"><i data-lucide="info" class="w-4 h-4"></i> Details</button>
        <button onclick="publishMyBook()" class="px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-navy-900 text-sm font-semibold transition btn-shine flex items-center gap-2"><i data-lucide="upload" class="w-4 h-4"></i> ${m.status === "published" ? "Published ✓" : "Publish"}</button>
        <button onclick="deleteMyBook()" class="p-2 rounded-full text-red-500 hover:bg-red-500/10 transition" title="Delete book"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>
    </div>
    <div id="writerGrid" class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      <aside id="chapSide" class="bg-cream-50 dark:bg-navy-800 rounded-2xl border border-cream-300/50 dark:border-navy-700 p-4 self-start">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-sm">Chapters</h3>
          <button onclick="addChapterW()" class="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition"><i data-lucide="plus" class="w-4 h-4"></i></button>
        </div>
        <div class="space-y-1 max-h-[55vh] overflow-auto" id="chapList">
          ${W.chapters.map((c, i) => `
            <div class="chap-item group flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm ${i === W.active ? "active" : ""}" onclick="selectChapterW(${i})">
              <span class="text-navy-400 text-xs w-5">${i + 1}</span>
              <span class="flex-1 truncate">${escapeHtml(c.title)}</span>
              <button onclick="event.stopPropagation();moveChapterW(${i},-1)" class="opacity-0 group-hover:opacity-100 text-navy-400 hover:text-navy-700 dark:hover:text-cream-100"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
              <button onclick="event.stopPropagation();moveChapterW(${i},1)" class="opacity-0 group-hover:opacity-100 text-navy-400 hover:text-navy-700 dark:hover:text-cream-100"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>
              <button onclick="event.stopPropagation();renameChapterW(${i})" class="opacity-0 group-hover:opacity-100 text-navy-400 hover:text-sky-500"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
              <button onclick="event.stopPropagation();deleteChapterW(${i})" class="opacity-0 group-hover:opacity-100 text-navy-400 hover:text-red-500"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
            </div>`).join("") || `<p class="text-xs text-navy-400 px-2">No chapters yet. Add one!</p>`}
        </div>
        <button onclick="toggleFocusMode()" class="mt-3 w-full py-2 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 text-xs font-medium hover:bg-cream-200 dark:hover:bg-navy-900/70 transition flex items-center justify-center gap-1.5"><i data-lucide="eye-off" class="w-3.5 h-3.5"></i> Focus mode</button>
      </aside>
      <section class="bg-cream-50 dark:bg-navy-800 rounded-2xl border border-cream-300/50 dark:border-navy-700 p-6 sm:p-8">
        ${ch ? `
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-bold text-lg font-display">${escapeHtml(ch.title)}</h2>
          <span id="wWordCount" class="text-xs text-navy-400">${ch.words || 0} words</span>
        </div>
        <textarea id="wEditor" class="writer-area w-full bg-transparent font-serif text-[16px] leading-8 outline-none placeholder:text-navy-300 dark:placeholder:text-cream-500" placeholder="Start writing your story... (autosaves as you type)">${escapeHtml(ch.content || "")}</textarea>
        ` : `<div class="h-[60vh] flex flex-col items-center justify-center text-center text-navy-400">
          <div class="w-16 h-16 rounded-2xl bg-cream-200 dark:bg-navy-700 flex items-center justify-center mb-4"><i data-lucide="pen-line" class="w-8 h-8"></i></div>
          <p class="font-medium">Write by yourself, chapter by chapter.</p>
          <button onclick="addChapterW()" class="mt-4 px-5 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Add first chapter</button>
        </div>`}
      </section>
    </div>
  </div>`;
  refreshIcons();

  // Title live-save
  let tT = null;
  $("#wTitle").addEventListener("input", (e) => {
    m.title = e.target.value.trim() || "Untitled";
    clearTimeout(tT); tT = setTimeout(() => store.updateBook(W.bookId, { title: m.title }).catch(() => {}), 800);
  });

  if (!ch) return;
  const ta = $("#wEditor"), wc = $("#wWordCount"), ind = $("#wSaveInd");
  let saveT = null;
  ta.addEventListener("input", () => {
    ch.content = ta.value;
    ch.words = (ta.value.trim().match(/\S+/g) || []).length;
    wc.textContent = `${ch.words} words`;
    ind.textContent = "Saving…";
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try { await store.saveChapter(W.bookId, ch.id, { content: ch.content, words: ch.words }); ind.textContent = "Saved ✓"; }
      catch (_) { ind.textContent = "Save failed"; }
    }, 1200);
  });
  ta.focus();
}

window.selectChapterW = async (i) => {
  const W = state.writer; if (!W) return;
  W.active = i;
  renderWriter();
};
window.addChapterW = async () => {
  const W = state.writer; if (!W) return;
  const t = await ottlePrompt({ title: `Add Chapter ${W.chapters.length + 1}`, placeholder: "Chapter title…", okText: "Add" });
  if (t === null) return;
  try {
    const id = await store.addChapter(W.bookId, t.trim(), W.chapters.length);
    W.chapters.push({ id, title: t.trim(), content: "", words: 0, order: W.chapters.length });
    W.active = W.chapters.length - 1;
    renderWriter();
  } catch (e) { toast("Add failed: " + (e.code || e.message || "unknown").replace("permission-denied", "RULES BLOCKED — publish firestore.rules!")); }
};
window.renameChapterW = async (i) => {
  const W = state.writer; const c = W?.chapters[i]; if (!c) return;
  const t = await ottlePrompt({ title: "Rename chapter", value: c.title, okText: "Rename" });
  if (t === null) return;
  c.title = t.trim() || c.title;
  await store.saveChapter(W.bookId, c.id, { title: c.title }).catch(() => {});
  renderWriter();
};
window.deleteChapterW = async (i) => {
  const W = state.writer; const c = W?.chapters[i]; if (!c) return;
  if (!(await ottleConfirm(`Delete <b>"${escapeHtml(c.title)}"</b>?<br><span class="text-xs text-navy-400">This cannot be undone.</span>`, { okText: "Delete", danger: true }))) return;
  await store.deleteChapter(W.bookId, c.id).catch(() => {});
  W.chapters.splice(i, 1);
  if (W.active >= W.chapters.length) W.active = W.chapters.length - 1;
  renderWriter();
};
window.moveChapterW = async (i, dir) => {
  const W = state.writer; if (!W) return;
  const j = i + dir;
  if (j < 0 || j >= W.chapters.length) return;
  const arr = W.chapters;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  await Promise.all(arr.map((c, k) => store.saveChapter(W.bookId, c.id, { order: k }).catch(() => {})));
  W.active = j;
  renderWriter();
};
window.toggleFocusMode = () => {
  $("#chapSide")?.classList.toggle("hidden");
  document.getElementById("writerGrid")?.classList.toggle("lg:grid-cols-[280px_1fr]");
};

window.openBookDetails = () => {
  const W = state.writer; if (!W) return;
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-md p-6 animate-scaleIn">
      <h2 class="font-bold text-lg mb-4 flex items-center gap-2"><i data-lucide="info" class="w-5 h-5 text-amber-500"></i> Book details</h2>
      <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Blurb (shown on marketplace)</label>
      <textarea id="bdBlurb" rows="4" class="w-full text-sm p-3 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none resize-none mb-3">${escapeHtml(W.meta.blurb || "")}</textarea>
      <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Genre</label>
      <select id="bdGenre" class="w-full text-sm p-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none mb-4">
        ${["General","Fantasy","Romance","Mystery","Sci-Fi","Horror","Literary Fiction","Poetry","Non-fiction"].map(g => `<option ${W.meta.genre === g ? "selected" : ""}>${g}</option>`).join("")}
      </select>
      <button id="bdSave" class="w-full py-2.5 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition">Save details</button>
    </div>`;
  document.body.appendChild(back); refreshIcons();
  $("#bdSave", back).onclick = async () => {
    W.meta.blurb = $("#bdBlurb", back).value.trim();
    W.meta.genre = $("#bdGenre", back).value;
    await store.updateBook(W.bookId, { blurb: W.meta.blurb, genre: W.meta.genre }).catch(() => {});
    toast("Details saved"); back.remove();
  };
};

window.publishMyBook = async () => {
  const W = state.writer; if (!W) return;
  if (W.meta.status === "published") { W.meta.status = "draft"; await store.updateBook(W.bookId, { status: "draft" }); toast("Unpublished — back to draft"); renderWriter(); return; }
  if (!W.chapters.some(c => (c.content || "").trim())) return toast("Write at least one chapter before publishing");
  await store.publishBookNow(W.bookId);
  W.meta.status = "published";
  toast("🎉 Your book is LIVE on the marketplace!");
  renderWriter();
};

window.deleteMyBook = async () => {
  const W = state.writer; if (!W) return;
  if (!(await ottleConfirm(`Delete <b>"${escapeHtml(W.meta.title)}"</b> and all its chapters?`, { okText: "Delete forever", danger: true }))) return;
  try { await store.deleteBookCompletely(W.bookId); toast("Book deleted"); navigate("dashboard"); }
  catch (_) { toast("Could not delete"); }
};

/* Cover Designer */
window.openCoverDesigner = () => {
  const W = state.writer; if (!W) return;
  let selPreset = W.meta.cover?.type === "css" ? (W.meta.cover.preset ?? 0) : null;
  let selImg = W.meta.cover?.type === "image" ? W.meta.cover.dataUrl : null;
  const back = elFrom(`<div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4 animate-fadeIn" onclick="if(event.target===this)this.remove()"></div>`);
  back.innerHTML = `
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl w-full max-w-lg p-6 animate-scaleIn max-h-[90vh] overflow-auto">
      <div class="flex justify-between items-center mb-4">
        <h2 class="font-bold text-lg flex items-center gap-2"><i data-lucide="palette" class="w-5 h-5 text-amber-500"></i> Cover Designer</h2>
        <button onclick="this.closest('.fixed').remove()" class="p-1 rounded-full hover:bg-cream-200 dark:hover:bg-navy-700"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="flex gap-2 mb-5">
        <button id="tabDesign" class="flex-1 py-2 rounded-full text-sm font-semibold bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100">Create your cover</button>
        <button id="tabImage" class="flex-1 py-2 rounded-full text-sm font-semibold bg-cream-200 dark:bg-navy-700">Custom image</button>
      </div>
      <div id="paneDesign">
        <div class="grid grid-cols-4 gap-3 mb-5" id="presetGrid">
          ${CSS_COVERS.map((_, i) => `
            <button data-p="${i}" class="cd-preset rounded-xl overflow-hidden ring-offset-2 ring-offset-transparent transition ${selPreset === i ? "ring-2 ring-amber-500" : ""}">
              ${coverArt({ title: W.meta.title, ownerName: W.meta.ownerName, cover: { type: "css", preset: i } }, "aspect-[3/4]", .55)}
            </button>`).join("")}
        </div>
      </div>
      <div id="paneImage" class="hidden">
        <input id="cdImgInput" type="file" accept="image/*" class="hidden">
        <button id="cdPick" class="w-full py-3 rounded-xl border-2 border-dashed border-cream-300 dark:border-navy-600 text-sm font-medium text-navy-500 dark:text-cream-300 hover:border-amber-500 transition mb-3 flex items-center justify-center gap-2"><i data-lucide="image-plus" class="w-4 h-4"></i> Upload custom cover image</button>
        <img id="cdPreview" src="${selImg || ""}" class="hidden mx-auto h-44 rounded-xl object-cover mb-4">
      </div>
      <button id="cdSave" class="w-full py-3 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.01] transition btn-shine">Save cover</button>
    </div>`;
  document.body.appendChild(back); refreshIcons();

  const showPane = (which) => {
    $("#paneDesign", back).classList.toggle("hidden", which !== "design");
    $("#paneImage", back).classList.toggle("hidden", which !== "image");
    $("#tabDesign", back).className = `flex-1 py-2 rounded-full text-sm font-semibold ${which === "design" ? "bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100" : "bg-cream-200 dark:bg-navy-700"}`;
    $("#tabImage", back).className = `flex-1 py-2 rounded-full text-sm font-semibold ${which === "image" ? "bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100" : "bg-cream-200 dark:bg-navy-700"}`;
  };
  $("#tabDesign", back).onclick = () => showPane("design");
  $("#tabImage", back).onclick = () => showPane("image");

  back.querySelectorAll(".cd-preset").forEach(b => b.onclick = () => {
    selPreset = parseInt(b.dataset.p); selImg = null;
    back.querySelectorAll(".cd-preset").forEach(x => x.classList.remove("ring-2", "ring-amber-500"));
    b.classList.add("ring-2", "ring-amber-500");
  });
  $("#cdPick", back).onclick = () => $("#cdImgInput", back).click();
  $("#cdImgInput", back).onchange = async () => {
    const f = $("#cdImgInput", back).files[0]; if (!f) return;
    try {
      selImg = await fileToDataUrl(f, 600, 0.82); selPreset = null;
      const pv = $("#cdPreview", back); pv.src = selImg; pv.classList.remove("hidden");
    } catch (_) { toast("Could not read image"); }
  };
  $("#cdSave", back).onclick = async () => {
    const cover = selImg ? { type: "image", dataUrl: selImg } : (selPreset !== null ? { type: "css", preset: selPreset } : null);
    if (!cover) return toast("Pick a design or upload an image first");
    W.meta.cover = cover;
    await store.updateBook(W.bookId, { cover }).catch(() => {});
    toast("Cover saved 🎨"); back.remove(); renderWriter();
  };
};

/* Reader */
const R_THEMES = ["light", "sepia", "dark"];
window.openBookReader = async (bookId) => {
  const app = $("#app");
  app.innerHTML = `<div class="py-24 text-center text-navy-400"><div class="w-8 h-8 mx-auto rounded-full border-4 border-amber-500 border-t-transparent animate-spin"></div></div>`;
  let slot;
  try { slot = await store.openShelfSlot(state.user.uid, bookId, state.profile); }
  catch (_) { slot = { ok: true, existed: true, data: {} }; }
  if (!slot.ok) {
    app.innerHTML = `
    <div class="max-w-md mx-auto mt-20 text-center animate-scaleIn font-display">
      <div class="bg-cream-50 dark:bg-navy-800 rounded-3xl p-8 border border-cream-300/50 dark:border-navy-700">
        <div class="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4"><i data-lucide="library-big" class="w-8 h-8 text-amber-500"></i></div>
        <h2 class="text-xl font-extrabold mb-2">Free reading limit reached</h2>
        <p class="text-sm text-navy-500 dark:text-cream-300 mb-5">You've opened ${slot.limit} books on the free plan. Get a Blue Tick for just ₹19/year and read unlimited books.</p>
        <button onclick="openVerifyModal()" class="w-full py-3 rounded-xl bg-sky-500 text-white font-semibold hover:scale-[1.01] transition mb-3 flex items-center justify-center gap-2"><i data-lucide="badge-check" class="w-4 h-4"></i> Get unlimited reading · ₹19/yr</button>
        <button onclick="navigate('marketplace')" class="text-sm text-navy-400 hover:text-amber-600 transition">Back to marketplace</button>
      </div>
    </div>`;
    refreshIcons(); observeReveals(); setActiveNav();
    return;
  }
  const [book, chapters] = await Promise.all([store.getBookById(bookId), store.getChapters(bookId)]);
  if (!book) { app.innerHTML = `<p class="text-center py-24 text-navy-400">Book not found.</p>`; return; }

  let idx = Math.min(slot.data?.lastChapter ?? 0, Math.max(0, chapters.length - 1));
  let theme = localStorage.getItem("ottle-rtheme") || "light";
  let fs = parseFloat(localStorage.getItem("ottle-rfont") || "1");

  const themeCls = { light: "bg-cream-50 text-navy-900", sepia: "bg-[#f0e6d2] text-[#4a3728]", dark: "bg-navy-950 text-cream-100" };
  app.innerHTML = `
  <div class="max-w-3xl mx-auto px-4 pb-16 animate-viewIn font-serif">
    <div class="sticky top-16 z-30 -mx-4 px-4 py-2.5 bg-cream-100/95 dark:bg-navy-950/95 backdrop-blur flex items-center gap-2 border-b border-cream-300/40 dark:border-navy-800">
      <button onclick="navigate('marketplace')" class="p-2 rounded-full hover:bg-cream-200 dark:hover:bg-navy-800 transition"><i data-lucide="arrow-left" class="w-4 h-4"></i></button>
      <span class="font-display font-bold truncate flex-1 text-sm sm:text-base">${escapeHtml(book.title)}</span>
      <select id="rChapSel" class="text-xs px-2 py-1.5 rounded-lg bg-cream-200 dark:bg-navy-800 outline-none max-w-[140px]">
        ${chapters.map((c, i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${i + 1}. ${escapeHtml(c.title)}</option>`).join("")}
      </select>
      <button id="rFontDn" class="px-2 py-1 rounded-lg bg-cream-200 dark:bg-navy-800 text-xs font-bold hover:bg-cream-300 dark:hover:bg-navy-700">A-</button>
      <button id="rFontUp" class="px-2 py-1 rounded-lg bg-cream-200 dark:bg-navy-800 text-xs font-bold hover:bg-cream-300 dark:hover:bg-navy-700">A+</button>
      <button id="rThemeBtn" class="px-2 py-1 rounded-lg bg-cream-200 dark:bg-navy-800 text-xs hover:bg-cream-300 dark:hover:bg-navy-700" title="Reading theme"><i data-lucide="sun-moon" class="w-4 h-4"></i></button>
    </div>
    <div id="rBody" class="rounded-b-3xl px-2 sm:px-8 py-10 transition-colors ${themeCls[theme]}">
      <h1 id="rTitle" class="font-display text-3xl font-extrabold mb-8"></h1>
      <div id="rText" class="leading-relaxed whitespace-pre-wrap min-h-[40vh]"></div>
    </div>
    <div class="flex items-center justify-between mt-6">
      <button id="rPrev" class="px-4 py-2.5 rounded-full bg-cream-200 dark:bg-navy-800 text-sm font-semibold disabled:opacity-40 hover:bg-cream-300 dark:hover:bg-navy-700 transition">← Previous</button>
      <span id="rProg" class="text-xs text-navy-400"></span>
      <button id="rNext" class="px-4 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold disabled:opacity-40 hover:bg-amber-600 transition">Next →</button>
    </div>
  </div>`;
  refreshIcons();

  const body = $("#rBody"), rTitle = $("#rTitle"), rText = $("#rText"),
        prev = $("#rPrev"), next = $("#rNext"), prog = $("#rProg"), sel = $("#rChapSel");

  const paint = () => {
    const c = chapters[idx];
    rTitle.textContent = c?.title || "The End";
    rText.textContent = c?.content?.trim()
      ? c.content
      : (idx === chapters.length ? "— You've reached the end of this book. Hope you enjoyed the journey! —" : "This chapter is still being written by the author…");
    prev.disabled = idx <= 0;
    next.disabled = idx >= chapters.length;
    prog.textContent = `Chapter ${Math.min(idx + 1, chapters.length)} of ${chapters.length}`;
    sel.value = String(idx);
    window.scrollTo({ top: 0 });
    store.saveReadingProgress(state.user.uid, bookId, idx, 0).catch(() => {});
  };

  sel.onchange = () => { idx = parseInt(sel.value); paint(); };
  prev.onclick = () => { if (idx > 0) { idx--; paint(); } };
  next.onclick = () => { if (idx < chapters.length) { idx++; paint(); } };

  const setFs = (v) => { fs = Math.min(1.6, Math.max(.8, v)); rText.style.fontSize = fs + "em"; localStorage.setItem("ottle-rfont", fs); };
  setFs(fs);
  $("#rFontUp").onclick = () => setFs(fs + .12);
  $("#rFontDn").onclick = () => setFs(fs - .12);

  $("#rThemeBtn").onclick = () => {
    theme = R_THEMES[(R_THEMES.indexOf(theme) + 1) % R_THEMES.length];
    localStorage.setItem("ottle-rtheme", theme);
    body.className = `rounded-b-3xl px-2 sm:px-8 py-10 transition-colors ${themeCls[theme]}`;
  };

  if (window._readerScroll) window.removeEventListener("scroll", window._readerScroll);
  let scT = null;
  window._readerScroll = () => {
    clearTimeout(scT);
    scT = setTimeout(() => {
      const el = $("#rBody"); if (!el) return;
      const total = el.scrollHeight - window.innerHeight;
      const pct = Math.max(0, Math.min(100, Math.round((window.scrollY / (total || 1)) * 100)));
      store.saveReadingProgress(state.user.uid, bookId, idx, pct).catch(() => {});
    }, 600);
  };
  window.addEventListener("scroll", window._readerScroll, { passive: true });

  paint();
};

/* ---------------- AI STUDIO (deep) ---------------- */
const GENRE_OPENERS = {
  Fantasy: "The old magic had slept for a thousand years, and it woke the moment she touched the stone.",
  Romance: "They had agreed it was just coffee — purely practical, no strings, no second date.",
  Mystery: "The letter arrived without a stamp, and the handwriting belonged to a dead woman.",
  "Sci-Fi": "Orbital Station Keth-9 went silent at 03:14, nine minutes before the first body was found.",
  Horror: "The house had been empty for decades, yet every morning the curtains were drawn differently.",
  "Literary Fiction": "Margaret counted the days by the mail that didn't come, and the silence that did."
};

function buildOutline(prompt, genre, chapters) {
  const n = Math.max(4, Math.min(12, chapters | 0 || 8));
  const themes = (prompt.match(/[a-zA-Z]{4,}/g) || []).slice(0, 3);
  const kw = themes.length ? themes.join(", ") : "the central mystery";
  const beats = [
    ["The Quiet Departure", "Introduce the protagonist and the ordinary world they are about to leave behind."],
    ["A Door Unlocked", "An inciting incident disrupts everything and sets the journey in motion around " + kw + "."],
    ["Shadows Gather", "Tension rises as the first major obstacle reveals the true stakes."],
    ["The Confession", "A pivotal relationship deepens, changing the hero's motivation."],
    ["Into the Storm", "The midpoint crisis forces a bold choice with no turning back."],
    ["Fractured Alliances", "A betrayal unravels the plan and isolates the protagonist."],
    ["The Long Night", "The darkest hour tests every lesson learned so far."],
    ["Reckoning", "The climax resolves the central conflict in a surprising, tone-true way."],
    ["Morning After", "The fallout and a quietly transformed world."],
    ["The Open Page", "A hopeful epilogue that hints at what comes next."],
    ["Echoes", "A late twist reframes earlier events and deepens the lore."],
    ["Home, Rewritten", "The protagonist returns changed, closing the arc with quiet resolution."]
  ];
  return Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1} — ${beats[i][0]}`, summary: beats[i][1] }));
}

function renderStudio(app) {
  app.innerHTML = `
  <div class="animate-fadeIn max-w-7xl mx-auto px-4 sm:px-6 py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-extrabold flex items-center gap-2"><i data-lucide="sparkles" class="w-7 h-7 text-amber-500"></i> Ottle AI Studio</h1>
      <p class="text-navy-500 dark:text-cream-300">Describe your idea. Watch it become an outline, then a manuscript.</p>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
      <aside class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700 lg:sticky lg:top-20 self-start">
        <h2 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="sliders-horizontal" class="w-4 h-4 text-amber-500"></i> Control Center</h2>
        <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Your prompt *</label>
        <textarea id="promptInput" rows="5" placeholder="Describe your book idea, plot twists, characters, worldbuilding..."
          class="w-full text-sm p-3 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border outline-none focus:border-amber-500 resize-none mb-1"></textarea>
        <p id="promptError" class="text-xs text-red-500 mb-3 hidden">Please enter at least 20 characters describing your book idea.</p>
        <div class="grid grid-cols-2 gap-3 mb-3">
          ${sel("genreInput", "Genre", ["Fantasy","Romance","Mystery","Sci-Fi","Horror","Literary Fiction"])}
          ${sel("wordsInput", "Word Count", ["Short (~5k)","Novella (~20k)","Novel (~60k)","Epic (~100k)"])}
          ${sel("toneInput", "Tone", ["Whimsical","Dark","Hopeful","Satirical","Melancholic"])}
          ${sel("perspInput", "Perspective", ["First Person","Third Person Limited","Third Person Omniscient","Second Person"])}
          ${sel("audienceInput", "Audience", ["YA","Adult","New Adult","Middle Grade"])}
          ${sel("langInput", "Language", ["English","Spanish","French","German"])}
        </div>
        <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">Chapters</label>
        <input id="chaptersInput" type="number" min="4" max="12" value="8"
          class="w-full text-sm p-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border outline-none focus:border-amber-500 mb-3">
        <button id="generateBtn" onclick="generateOutline()" class="w-full py-3 rounded-xl bg-amber-500 text-navy-900 font-semibold hover:scale-[1.02] transition flex items-center justify-center gap-2">
          <i data-lucide="wand-2" class="w-5 h-5"></i> Generate Outline
        </button>
        <div id="stepRow" class="flex items-center justify-between mt-5 text-xs">
          ${stepPill(0, "Prompt")}${stepPill(1, "Outline")}${stepPill(2, "Manuscript")}
        </div>
      </aside>
      <section class="bg-cream-50 dark:bg-navy-800 rounded-2xl border border-cream-300/50 dark:border-navy-700 min-h-[500px] flex flex-col">
        <div class="flex items-center justify-between px-5 py-3 border-b border-cream-300/50 dark:border-navy-700">
          <span class="text-sm font-semibold flex items-center gap-2"><i data-lucide="file-text" class="w-4 h-4 text-amber-500"></i> Live Manuscript</span>
          <div id="genStatus" class="text-xs text-navy-400 flex items-center gap-1.5"></div>
        </div>
        <div id="editorArea" class="flex-1 p-6 overflow-auto">${studioPlaceholder()}</div>
      </section>
    </div>
  </div>`;
  refreshIcons();
}

const sel = (id, label, opts) => `
  <div>
    <label class="block text-xs font-semibold mb-1 text-navy-500 dark:text-cream-300">${label}</label>
    <select id="${id}" class="w-full text-sm p-2.5 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border outline-none focus:border-amber-500">
      ${opts.map(o => `<option>${o}</option>`).join("")}
    </select>
  </div>`;

const stepPill = (n, label) => {
  const active = state.studio.step >= n;
  return `<div class="flex items-center gap-1.5 ${active ? "text-amber-600 dark:text-amber-400" : "text-navy-300 dark:text-cream-500"}">
    <span class="w-5 h-5 rounded-full flex items-center justify-center ${active ? "bg-amber-500 text-navy-900" : "bg-cream-200 dark:bg-navy-700"} font-bold">${n + 1}</span>${label}</div>`;
};
const updateStepPills = () => { const r = $("#stepRow"); if (r) r.innerHTML = stepPill(0,"Prompt")+stepPill(1,"Outline")+stepPill(2,"Manuscript"); };
const studioPlaceholder = () => `<div class="h-full flex flex-col items-center justify-center text-center text-navy-400 dark:text-cream-400">
  <div class="w-16 h-16 rounded-2xl bg-cream-200 dark:bg-navy-700 flex items-center justify-center mb-4"><i data-lucide="pen-line" class="w-8 h-8"></i></div>
  <p class="font-medium">Your manuscript will appear here</p>
  <p class="text-sm mt-1 max-w-sm">Fill in the Control Center and hit "Generate Outline" to begin drafting with Ottle AI.</p>
</div>`;

window.generateOutline = () => {
  const prompt = $("#promptInput").value.trim();
  if (prompt.length < 20) { $("#promptError").classList.remove("hidden"); $("#promptInput").classList.add("border-red-500"); return; }
  $("#promptError").classList.add("hidden"); $("#promptInput").classList.remove("border-red-500");

  const meta = {
    prompt, genre: $("#genreInput").value, words: $("#wordsInput").value, tone: $("#toneInput").value,
    perspective: $("#perspInput").value, audience: $("#audienceInput").value, language: $("#langInput").value,
    chapters: $("#chaptersInput").value | 0
  };
  state.studio.meta = meta;
  state.studio.outline = buildOutline(prompt, meta.genre, meta.chapters);
  state.studio.step = 1; updateStepPills();

  const status = $("#genStatus");
  status.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulseRing"></span> Generating outline...`;
  const btn = $("#generateBtn"); btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="w-5 h-5 animate-spin"></i> Working...`;
  refreshIcons();

  setTimeout(() => {
    renderOutlineEditor();
    status.innerHTML = `<span class="text-green-500 flex items-center gap-1"><i data-lucide="check-circle" class="w-4 h-4"></i> Outline ready</span>`;
    refreshIcons(); btn.disabled = false; btn.innerHTML = `<i data-lucide="wand-2" class="w-5 h-5"></i> Regenerate`;
  }, 1500);
};

function renderOutlineEditor() {
  const area = $("#editorArea"); const m = state.studio.meta;
  area.innerHTML = `
  <div class="animate-fadeIn">
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="font-bold text-lg">Chapter Outline</h3>
        <p class="text-xs text-navy-400">${m.genre} · ${m.tone} tone · ${m.perspective} · ${m.audience} · ${m.language}</p>
      </div>
      <div class="flex gap-2">
        <button onclick="startDrafting()" class="px-4 py-2 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition flex items-center gap-2"><i data-lucide="pen-line" class="w-4 h-4"></i> Start Drafting</button>
        <button onclick="saveDraft()" class="px-4 py-2 rounded-full bg-cream-200 dark:bg-navy-700 text-sm font-semibold hover:bg-cream-300 dark:hover:bg-navy-600 transition">Save draft</button>
      </div>
    </div>
    <p class="text-xs text-navy-400 mb-3">Click any chapter summary to refine it before drafting.</p>
    <ol class="space-y-2" id="outlineList">
      ${state.studio.outline.map((c, i) => `
        <li class="flex gap-3 items-start bg-cream-200/50 dark:bg-navy-900/40 rounded-xl p-3 card-hover">
          <span class="w-7 h-7 shrink-0 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 flex items-center justify-center text-xs font-bold">${i + 1}</span>
          <div class="flex-1">
            <p class="text-sm font-semibold">${escapeHtml(c.title)}</p>
            <p class="text-sm summary editable text-navy-600 dark:text-cream-300/80" contenteditable="true" data-i="${i}">${escapeHtml(c.summary)}</p>
          </div>
        </li>`).join("")}
    </ol>
  </div>`;
  refreshIcons();
  $$(".summary.editable").forEach(s => s.addEventListener("blur", () => {
    state.studio.outline[s.dataset.i].summary = s.textContent.trim();
  }));
}

window.startDrafting = () => {
  state.studio.step = 2; updateStepPills();
  const area = $("#editorArea"); const status = $("#genStatus");
  const m = state.studio.meta;
  status.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulseRing"></span> Drafting chapter 1...`;

  const opener = GENRE_OPENERS[m.genre] || "It began, as these things often do, with a small and ordinary choice.";
  const text =
`${opener}

${state.user.displayName || "The protagonist"} had not asked for any of this. The ${m.tone.toLowerCase()} weight of the day settled as they considered what the outline had promised — that by the final page, nothing would be the same.

Written in ${m.perspective.toLowerCase()}, the story moves with the rhythm of ${m.audience} fiction: intimate where it needs to be, vast when the world demands it. The language is ${m.language}, the voice lean, the stakes quietly enormous.

They stepped forward.

The first chapter sets the terms: a world that looks stable only from a distance, a secret threaded through the ordinary, and a choice that cannot be unmade. Around it, the outline's tenor hums — ${state.studio.outline[0]?.summary || "the beginning of everything"}.

And so the manuscript begins, one sentence at a time, the way all good books do.`;

  area.innerHTML = `<div class="max-w-2xl mx-auto animate-fadeIn">
    <h3 class="font-serif text-2xl font-bold mb-1">${escapeHtml(state.studio.outline[0]?.title || "Chapter 1")}</h3>
    <p class="text-xs text-navy-400 mb-5">Draft generated by Ottle AI · streaming · ${m.language}</p>
    <div id="streamText" class="font-serif text-[15px] leading-8 whitespace-pre-wrap min-h-[300px]"></div>
    <span id="cursor" class="inline-block w-2 h-5 bg-amber-500 align-middle animate-blink"></span>
    <div class="mt-5 flex gap-2">
      <button onclick="saveDraft()" class="px-4 py-2 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Save draft</button>
      <button onclick="regenerateFromHere()" class="px-4 py-2 rounded-full bg-cream-200 dark:bg-navy-700 text-sm font-semibold hover:bg-cream-300 dark:hover:bg-navy-600 transition">Rewrite</button>
    </div>
  </div>`;

  const target = $("#streamText"); let i = 0;
  const timer = setInterval(() => {
    if (i >= text.length) {
      clearInterval(timer); $("#cursor")?.remove();
      status.innerHTML = `<span class="text-green-500 flex items-center gap-1"><i data-lucide="check-circle" class="w-4 h-4"></i> Draft saved</span>`;
      refreshIcons();
      // make editable
      target.setAttribute("contenteditable", "true");
      target.classList.add("outline-none", "focus:bg-cream-100", "dark:focus:bg-navy-900/40", "rounded");
      target.insertAdjacentHTML("afterend", `<p class="text-xs text-navy-400 mt-4 flex items-center gap-1"><i data-lucide="info" class="w-3.5 h-3.5"></i> Editable first draft — keep writing or save to your library.</p>`);
      refreshIcons();
      return;
    }
    target.textContent += text[i++]; area.scrollTop = area.scrollHeight;
  }, 14);
};

window.regenerateFromHere = () => { $("#editorArea").innerHTML = studioPlaceholder(); state.studio.step = 1; updateStepPills(); generateOutline(); };

window.saveDraft = async () => {
  if (!state.studio.meta) return toast("Generate an outline first");
  const manuscript = $("#streamText")?.textContent || "";
  await store.saveDraft({
    uid: state.user.uid,
    title: state.studio.outline[0]?.title || "Untitled draft",
    outline: state.studio.outline, manuscript, meta: state.studio.meta
  });
  toast("Draft saved to your library");
};

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(app) {
  const p = state.profile;
  app.innerHTML = `
  <div class="animate-fadeIn max-w-7xl mx-auto px-4 sm:px-6 py-8">
    <div class="flex items-center gap-4 mb-8">
      ${(p?.photoURL || state.user.photoURL) ? `<img src="${p?.photoURL || state.user.photoURL}" class="w-16 h-16 rounded-2xl ring-2 ring-amber-400/60 object-cover" alt="">` : `<div class="w-16 h-16 rounded-2xl bg-navy-800 dark:bg-amber-500 flex items-center justify-center text-2xl font-bold text-cream-100 dark:text-navy-900">${(p?.displayName||"O")[0]?.toUpperCase()}</div>`}
      <div>
        <h1 class="text-2xl font-extrabold flex items-center gap-2">${escapeHtml(p?.displayName || "Author")} ${tickBadge(store.tickOf(p))}</h1>
        <p class="text-sm text-navy-400">${escapeHtml(p?.handle || "")}${p?.role === "admin" ? " · Admin" : ""}</p>
      </div>
      <button onclick="openWriter()" class="ml-auto px-4 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition flex items-center gap-2 btn-shine"><i data-lucide="pen-line" class="w-4 h-4"></i> Write a Book</button>
    </div>
    <div class="flex gap-1 mb-6 bg-cream-200/60 dark:bg-navy-800 rounded-full p-1 w-fit">
      <button id="tab-library" onclick="setTab('library')" class="px-5 py-2 rounded-full text-sm font-medium transition">My Reading Library</button>
      <button id="tab-author" onclick="setTab('author')" class="px-5 py-2 rounded-full text-sm font-medium transition">Ottle Author Hub</button>
      ${p?.role === "admin" ? '<button id="tab-admin" onclick="setTab(\'admin\')" class="px-5 py-2 rounded-full text-sm font-medium transition text-amber-600 dark:text-amber-400">Admin</button>' : ""}
    </div>
    <div id="tabContent"></div>
  </div>`;
  setTab(state.dashboardTab);
}

window.setTab = (tab) => {
  state.dashboardTab = tab; const p = state.profile;
  const cls = (id, active) => { const e = $(id); if (e) e.className = `px-5 py-2 rounded-full text-sm font-medium transition ${active ? "bg-navy-800 text-cream-100 dark:bg-amber-500 dark:text-navy-900" : "text-navy-500 dark:text-cream-300"}`; };
  cls("#tab-library", tab === "library");
  cls("#tab-author", tab === "author");
  cls("#tab-admin", tab === "admin");
  const c = $("#tabContent");
  if (tab === "library") { c.innerHTML = `<div id="libBox">${skeletonBooks(3)}</div>`; loadLibrary(); }
  else if (tab === "admin") { c.innerHTML = adminView(); initAdminPanel(); }
  else { c.innerHTML = authorView(p); loadAuthorHub(p); }
  refreshIcons();
};

/* ---------------- Admin panel (gold-tick admins only) ---------------- */
function adminView() {
  return `
  <div class="animate-fadeIn space-y-6">
    <div class="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3">
      <i data-lucide="shield" class="w-5 h-5 text-amber-600 dark:text-amber-400"></i>
      <p class="text-sm">Admin access — manage verifications, content, and the marketplace.</p>
    </div>
    <div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 class="font-bold text-red-600 dark:text-red-400 flex items-center gap-2"><i data-lucide="alert-triangle" class="w-4 h-4"></i> Danger Zone</h3>
        <p class="text-xs text-navy-400 mt-0.5">Delete ALL other accounts (test accounts included) with their posts. Only your logged-in account stays.</p>
      </div>
      <button onclick="adminPurgeUsers()" class="px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition shrink-0">Purge all other users</button>
    </div>
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700">
      <h3 class="font-bold mb-3">Users &amp; Verifications</h3>
      <div id="adminUsers" class="space-y-2"><p class="text-sm text-navy-400">Loading users…</p></div>
    </div>
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700">
      <h3 class="font-bold mb-3">Moderate Posts</h3>
      <div id="adminPosts" class="space-y-2"><p class="text-sm text-navy-400">Loading posts…</p></div>
    </div>
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700">
      <h3 class="font-bold mb-3">Add Book to Marketplace</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <input id="bkTitle" placeholder="Title" class="px-3 py-2 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
        <input id="bkAuthor" placeholder="Author" class="px-3 py-2 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
        <input id="bkPrice" type="number" step="0.01" placeholder="Price (₹)" class="px-3 py-2 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
        <input id="bkCover" placeholder="Cover seed (e.g. tea)" class="px-3 py-2 rounded-xl bg-cream-200/60 dark:bg-navy-900/40 border border-transparent focus:border-amber-500 outline-none text-sm">
      </div>
      <button onclick="adminAddBook()" class="mt-3 px-4 py-2 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Add Book</button>
    </div>
  </div>`;
}

async function initAdminPanel() {
  if (state.profile?.role !== "admin") return;
  const uBox = $("#adminUsers"); const pBox = $("#adminPosts");
  const users = await store.listUsers();
  uBox.innerHTML = users.map(u => `
    <div class="flex items-center gap-3 bg-cream-200/50 dark:bg-navy-900/40 rounded-xl p-3">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold flex items-center gap-1">${escapeHtml(u.displayName || "Author")} ${tickBadge(u.goldTick ? "gold" : u.blueTick ? "blue" : "")}</p>
        <p class="text-xs text-navy-400">${escapeHtml(u.email || "")} · ${u.role || "user"}</p>
      </div>
      <button onclick="adminSetRole('${u.uid}')" class="text-xs px-3 py-1.5 rounded-full bg-cream-200 dark:bg-navy-700 hover:bg-cream-300 dark:hover:bg-navy-600">${u.role === "admin" ? "Remove Admin" : "Make Admin"}</button>
      <button onclick="adminSetBlue('${u.uid}')" class="text-xs px-3 py-1.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25">${u.blueTick ? "Revoke Blue" : "Give Blue"}</button>
      <button onclick="adminDeleteUser('${u.uid}')" class="text-xs px-3 py-1.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25">Delete</button>
    </div>`).join("");
  // use live posts from state
  pBox.innerHTML = (state.posts || []).map(p => `
    <div class="flex items-center gap-3 bg-cream-200/50 dark:bg-navy-900/40 rounded-xl p-3">
      <div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">${escapeHtml(p.author)}</p><p class="text-xs text-navy-400 truncate">${escapeHtml(p.content)}</p></div>
      <button onclick="adminDeletePost('${p.id}')" class="text-xs px-3 py-1.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25">Delete</button>
    </div>`).join("") || `<p class="text-sm text-navy-400">No posts.</p>`;
}

window.adminSetRole = async (uid) => {
  const u = (await store.listUsers()).find(x => x.uid === uid);
  await store.setUserRole(uid, u?.role === "admin" ? "user" : "admin");
  toast("User role updated"); initAdminPanel();
};
window.adminSetBlue = async (uid) => {
  const u = (await store.listUsers()).find(x => x.uid === uid);
  await store.setUserBlue(uid, !u?.blueTick);
  toast("Blue tick updated"); initAdminPanel();
};
window.adminDeletePost = async (id) => { await store.deletePostAsAdmin(id); toast("Post removed"); };
window.adminAddBook = async () => {
  const title = $("#bkTitle").value.trim(), author = $("#bkAuthor").value.trim();
  const price = parseFloat($("#bkPrice").value), cover = $("#bkCover").value.trim() || "book";
  if (!title || !author || isNaN(price)) return toast("Fill title, author and price");
  await store.addBook({ title, author, price, rating: 0, cover, tags: [] });
  toast("Book added to marketplace"); $("#bkTitle").value = ""; $("#bkAuthor").value = ""; $("#bkPrice").value = ""; $("#bkCover").value = "";
};

window.adminPurgeUsers = async () => {
  const users = await store.listUsers();
  const targets = users.filter((u) => u.uid !== state.user.uid);
  if (!targets.length) return toast("Only your account remains — nothing to delete");
  if (!(await ottleConfirm(`<b>${targets.length} accounts</b> + unke saare posts delete karne hain?<br><span class="text-xs text-navy-400">Sirf tumhara logged-in account bachega.</span>`, { okText: "Delete all", danger: true }))) return;
  let n = 0;
  for (const t of targets) { try { await store.deleteUserAndPosts(t.uid); n++; } catch (_) {} }
  toast(n + " accounts deleted");
  initAdminPanel();
};

window.adminDeleteUser = async (uid) => {
  const u = (await store.listUsers()).find((x) => x.uid === uid);
  if (u?.uid === state.user.uid) return toast("You can't delete yourself");
  if (store.ADMIN_EMAILS.includes(u?.email)) return toast("Admin account can't be deleted");
  if (!(await ottleConfirm("Delete this user and all their posts?", { okText: "Delete", danger: true }))) return;
  try { await store.deleteUserAndPosts(uid); toast("User deleted"); initAdminPanel(); }
  catch (_) { toast("Could not delete user"); }
};

async function loadLibrary() {
  const box = document.getElementById("libBox"); if (!box) return;
  try {
    const shelf = await store.getShelf(state.user.uid);
    if (!shelf.length) {
      box.innerHTML = `<div class="text-center py-16 text-navy-400 animate-fadeIn"><i data-lucide="bookmark" class="w-10 h-10 mx-auto mb-3 opacity-50"></i>
        <p class="font-medium">Your shelf is empty.</p>
        <p class="text-sm mt-1">Open any book from the marketplace — 3 free on the free plan, unlimited with Blue Tick.</p>
        <button onclick="navigate('marketplace')" class="mt-4 px-5 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">Browse books</button></div>`;
      refreshIcons(); return;
    }
    const books = await Promise.all(shelf.map((s) => store.getBookById(s.bookId)));
    box.innerHTML = `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 animate-fadeIn">
      ${shelf.map((s, i) => {
        const b = books[i]; if (!b) return "";
        return `
        <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-4 border border-cream-300/50 dark:border-navy-700 card-hover cursor-pointer" onclick="openBookReader('${b.id}')">
          <div class="flex gap-4">
            <div class="w-16 h-24 rounded-lg overflow-hidden shrink-0">${coverArt(b, "", .45)}</div>
            <div class="flex-1 min-w-0">
              <h3 class="font-bold leading-snug truncate">${escapeHtml(b.title)}</h3>
              <p class="text-xs text-navy-400 mb-3 truncate">${escapeHtml(b.ownerName || "")}</p>
              <div class="flex items-center justify-between text-xs text-navy-400 mb-1"><span>Chapter ${(s.lastChapter ?? 0) + 1}</span><span>${Math.min(99, Math.max(2, s.lastScroll || 0))}%</span></div>
              <div class="h-1.5 rounded-full bg-cream-200 dark:bg-navy-700 overflow-hidden"><div class="h-full rounded-full bg-amber-500 transition-all duration-700" style="width:${Math.min(100, Math.max(3, s.lastScroll || 0))}%"></div></div>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
    refreshIcons();
  } catch (_) { box.innerHTML = `<p class="text-center py-10 text-sm text-navy-400">Could not load your shelf.</p>`; }
}

const authorView = (p) => `
  <div class="animate-fadeIn space-y-6">
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${metric("book-open", "Books Published", '<span id="mBooks">…</span>')}
      ${metric("users", "Followers", '<span id="mFollowers">…</span>')}
      ${metric("user-plus", "Following", '<span id="mFollowing">…</span>')}
      ${metric("file-text", "Saved Drafts", '<span id="mDrafts">…</span>')}
    </div>
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-6 border border-cream-300/50 dark:border-navy-700">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold flex items-center gap-2"><i data-lucide="library" class="w-4 h-4 text-amber-500"></i> My Books</h3>
        <button onclick="openWriter()" class="px-3 py-1.5 rounded-full bg-amber-500 text-navy-900 text-xs font-semibold hover:scale-105 transition">+ New Book</button>
      </div>
      <div id="myBooks" class="space-y-3"><p class="text-sm text-navy-400">Loading…</p></div>
    </div>
    <div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-6 border border-cream-300/50 dark:border-navy-700">
      <h3 class="font-bold mb-1 flex items-center gap-2"><i data-lucide="activity" class="w-4 h-4 text-amber-500"></i> My recent posts</h3>
      <p class="text-xs text-navy-400 mb-4">Live from Ottle Connect</p>
      <div id="ahPosts" class="space-y-3"><p class="text-sm text-navy-400">Loading…</p></div>
    </div>
  </div>`;

async function loadAuthorHub(p) {
  const uid = state.user.uid;
  try {
    const [posts, drafts, myBooks] = await Promise.all([
      store.getPostsByUser(uid),
      store.getDrafts(uid).catch(() => []),
      store.getMyBooks(uid).catch(() => [])
    ]);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set("mBooks", myBooks.filter(b => b.status === "published").length + " / " + myBooks.length);
    set("mFollowers", (p?.followers || []).length);
    set("mFollowing", (p?.following || []).length);
    set("mDrafts", drafts.length);
    const mb = document.getElementById("myBooks");
    if (mb) {
      mb.innerHTML = myBooks.length ? myBooks.map(b => `
        <div class="flex items-center gap-4 bg-cream-200/50 dark:bg-navy-900/40 rounded-xl p-3">
          <div class="w-10 h-14 rounded-lg overflow-hidden shrink-0">${coverArt({ title: b.title, ownerName: b.ownerName, cover: b.cover }, "", .45)}</div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm truncate">${escapeHtml(b.title)}</p>
            <p class="text-xs text-navy-400">${b.status === "published" ? "🟢 Live ·" : "📝 Draft ·"} ${(b.reads || 0)} reads</p>
          </div>
          <button onclick="openWriter('${b.id}')" class="px-3 py-1.5 rounded-full bg-navy-800 dark:bg-amber-500 dark:text-navy-900 text-cream-100 text-xs font-semibold hover:scale-105 transition">Edit</button>
          <button onclick="delFromHub('${b.id}')" class="px-2 py-1.5 rounded-full text-red-500 hover:bg-red-500/10 text-xs"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>`).join("") : `
        <div class="text-center py-6">
          <p class="text-sm text-navy-400 mb-3">No books yet — your story is waiting.</p>
          <button onclick="openWriter()" class="px-5 py-2.5 rounded-full bg-amber-500 text-navy-900 text-sm font-semibold hover:scale-105 transition">✍️ Start writing</button>
        </div>`;
    }
    const box = document.getElementById("ahPosts");
    if (box) box.innerHTML = posts.length ? posts.slice(0, 5).map((pt) => `
      <button onclick="openUserProfile('${uid}')" class="w-full text-left flex items-center gap-3 bg-cream-200/50 dark:bg-navy-900/40 rounded-xl p-3 hover:bg-cream-200 dark:hover:bg-navy-900/70 transition">
        <i data-lucide="message-square" class="w-4 h-4 text-amber-500 shrink-0"></i>
        <span class="text-sm truncate flex-1">${escapeHtml((pt.content || "").slice(0, 90))}</span>
        <span class="text-xs text-navy-400 shrink-0"><i data-lucide="heart" class="w-3 h-3 inline fill-amber-400 text-amber-400"></i> ${pt.likes || 0}</span>
      </button>`).join("") : `<p class="text-sm text-navy-400">No posts yet — share something on Connect!</p>`;
    refreshIcons();
  } catch (_) {}
}

window.delFromHub = async (bookId) => {
  if (!(await ottleConfirm("Delete this book and all its chapters?", { okText: "Delete", danger: true }))) return;
  try { await store.deleteBookCompletely(bookId); toast("Book deleted"); loadAuthorHub(state.profile); }
  catch (_) { toast("Could not delete"); }
};
const metric = (icon, label, value) => `<div class="bg-cream-50 dark:bg-navy-800 rounded-2xl p-5 border border-cream-300/50 dark:border-navy-700 card-hover">
  <div class="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center mb-3"><i data-lucide="${icon}" class="w-5 h-5 text-amber-600 dark:text-amber-400"></i></div>
  <p class="text-2xl font-extrabold">${value}</p><p class="text-xs text-navy-400 mt-1">${label}</p>
</div>`;

/* ---------------- Init ---------------- */
boot();
