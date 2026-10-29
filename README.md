# Ottle — Publish. Read. Connect.

eBook publishing platform for independent storytellers: marketplace, social feed (Connect), 24h Stories, DM inbox, AI Studio, chapter-by-chapter writer, reader with offline/PDF, Blue Tick verification (₹19/yr via Razorpay), and PWA.

## What's in Ottle 2.0 (latest update)

| Feature | What it does |
|---|---|
| **Real AI Studio** | Groq LLM generates book outlines + chapter drafts from your prompt (set `GROQ_API_KEY` in `public/js/firebase.js`) |
| **Real Book Store** | Buy books with Razorpay; authors get sale notifications + earnings |
| **Real Comments** | Text comments with likes, replies, and delete on Connect posts |
| **Notifications** | Bell icon — likes, comments, follows, and book sale alerts |
| **Reading Streaks** | 🔥 Daily reading streak + daily coin rewards (10–40 coins) |
| **PWA** | Installable as an app (`manifest.json` + `sw.js`), works offline |
| **Writer** | Cover designer, chapter manager, autosave, publish to marketplace |
| **Reader** | Ch1 free, Ch2-3 free after signup, Ch4+ = 10 coins; sepia/dark themes, font size, PDF export |
| **Admin panel** | Gold-tick admin: manage users, blue ticks, posts, add books, purge test accounts |

## Tech stack

- Frontend: vanilla JS modules, Tailwind CSS (CDN), Lucide icons, jsPDF, Razorpay Checkout
- Backend: Python `server.py` (static server + email OTP + Razorpay) or Netlify function (`netlify/functions/ottle-api.js`)
- Database: Firebase Firestore (auth + data)
- Email: MailboxLayer validation + Brevo/SMTP delivery (demo mode prints codes to console)

## Local run

```powershell
# Install Python deps (none needed beyond stdlib)
cd ottle-main
python server.py
# or double-click Ottle.bat (Windows)
# Open http://localhost:5173
```

`server.py` reads `.env` next to it. Create `.env` with:

```ini
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_SECRET=...
OTTLE_BREVO_KEY=...
OTTLE_FROM_EMAIL=you@example.com
MAILBOXLAYER_KEY=...
```

Without env vars, email goes to **demo mode** (codes printed to console + `demo_codes.log`).

## Deploy

- **Netlify**: connects `index.html` + `netlify/functions/ottle-api.js`. Set env vars in Netlify dashboard.
- **Railway**: `railway.toml` runs `python server.py`.

## Firebase

Config is in `public/js/firebase.js` (project `ottleb`). Firestore rules: publish `firestore.rules` via Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

Admin emails (gold tick): `raptorayush8@gmail.com`, `r4908994@gmail.com`.

## Git

```bash
git init
git remote add origin https://github.com/yrxo/ottle.git
git branch -M main
git add .
git commit -m "Ottle 2.0: real AI, book store, comments, notifications, streaks, PWA"
git push -u origin main
```

## Screenshots / roadmap

- Coming: real-time chat with presence, audio chapters, author revenue payouts, Hindi/Hinglish AI output
