// public/js/store.js — Firestore data layer for Ottle (real data only)
import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, arrayUnion, arrayRemove,
  increment, where, limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Gold-tick admins (pre-verified, full access)
export const ADMIN_EMAILS = ["raptorayush8@gmail.com", "r4908994@gmail.com"];
export const BLUE_TICK_YEARLY_INR = 19;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const tickOf = (profile) =>
  profile?.goldTick ? "gold" : profile?.blueTick ? "blue" : null;

/* ---------- Posts (Ottle Connect) ---------- */
export function subscribePosts(onChange) {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function addPost({ uid, author, handle, avatar, tick, content, bookLink, image }) {
  await addDoc(collection(db, "posts"), {
    uid, author, handle, avatar, tick: tick || null, content, bookLink: bookLink || null,
    image: image || null,
    createdAt: serverTimestamp(), likes: 0, likedBy: [], comments: 0, shares: 0
  });
}

export async function toggleLike(postId, uid) {
  const ref = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  const likedBy = snap.data()?.likedBy || [];
  if (likedBy.includes(uid)) await updateDoc(ref, { likedBy: arrayRemove(uid), likes: increment(-1) });
  else await updateDoc(ref, { likedBy: arrayUnion(uid), likes: increment(1) });
}

export async function addComment(postId) {
  await updateDoc(doc(db, "posts", postId), { comments: increment(1) });
}

export async function deletePostAsAdmin(postId) {
  await deleteDoc(doc(db, "posts", postId));
}

/* ---------- Marketplace books (real, added by users/admins) ---------- */
export async function getBooks() {
  const snap = await getDocs(query(collection(db, "books"), orderBy("title")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.status !== "draft");
}

export async function addBook(book) {
  return addDoc(collection(db, "books"), book);
}

export async function deleteBook(id) {
  await deleteDoc(doc(db, "books", id));
}

/* ---------- Users (real profiles) ---------- */
export async function ensureProfile(uid, { displayName, email, photoURL }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const isAdmin = ADMIN_EMAILS.includes(email);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: displayName || email?.split("@")[0] || "Ottle Author",
      username: (email?.split("@")[0] || "author").toLowerCase().replace(/[^a-z0-9_]/g, ""),
      email: email || "",
      photoURL: photoURL || "",
      handle: "@" + (email?.split("@")[0] || "author").toLowerCase().replace(/[^a-z0-9_]/g, ""),
      role: isAdmin ? "admin" : "user",
      goldTick: isAdmin,
      blueTick: false,
      blueTickExpiry: null,
      phone: "",
      phoneVerified: false,
      emailVerified: false,
      library: [], published: [], earnings: [],
      following: [], followers: [], bio: "",
      createdAt: serverTimestamp()
    });
  } else if (isAdmin) {
    // upgrade existing profile to gold/admin if it predates this change
    const data = snap.data();
    if (data.role !== "admin" || !data.goldTick) {
      await updateDoc(ref, { role: "admin", goldTick: true });
    }
  }
  return (await getDoc(ref)).data();
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateProfile(uid, { displayName, username, photoURL } = {}) {
  const fields = {};
  if (displayName) fields.displayName = displayName;
  if (photoURL) fields.photoURL = photoURL;
  if (username) {
    const u = username.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!u) throw new Error("Username can only use letters, numbers and _");
    const snap = await getDocs(query(collection(db, "users"), where("username", "==", u), limit(1)));
    if (snap.docs.some((d) => d.id !== uid)) throw new Error("@" + u + " is already taken — pick another");
    fields.username = u; fields.handle = "@" + u;
  }
  await updateDoc(doc(db, "users", uid), fields);
}

export async function listUsers() {
  const snap = await getDocs(query(collection(db, "users"), limit(100)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function setUserRole(uid, role) {
  await updateDoc(doc(db, "users", uid), { role, goldTick: role === "admin" });
}

export async function getPostsByUser(uid) {
  const snap = await getDocs(query(collection(db, "posts"), where("uid", "==", uid)));
  const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return posts;
}

export async function toggleFollow(myUid, targetUid) {
  const me = doc(db, "users", myUid);
  const them = doc(db, "users", targetUid);
  const m = await getDoc(me); const t = await getDoc(them);
  const myFollowing = m.data()?.following || [];
  const theirFollowers = t.data()?.followers || [];
  if (myFollowing.includes(targetUid)) {
    await updateDoc(me, { following: arrayRemove(targetUid) });
    await updateDoc(them, { followers: arrayRemove(myUid) });
  } else {
    await updateDoc(me, { following: arrayUnion(targetUid) });
    await updateDoc(them, { followers: arrayUnion(myUid) });
  }
}

export async function deleteUserAndPosts(uid) {
  const snap = await getDocs(query(collection(db, "posts"), where("uid", "==", uid)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "users", uid));
}
export async function setUserBlue(uid, value) {
  await updateDoc(doc(db, "users", uid), {
    blueTick: value,
    blueTickExpiry: value ? Date.now() + YEAR_MS : null
  });
}

/* ---------- Blue-tick verification (₹19/year) ---------- */
export async function purchaseBlueTick(uid, amount = BLUE_TICK_YEARLY_INR) {
  // Payment is handled by your gateway; this records the real verified state.
  await updateDoc(doc(db, "users", uid), {
    blueTick: true,
    blueTickExpiry: Date.now() + YEAR_MS,
    blueTickPurchases: increment(1),
    blueTickAmount: amount
  });
}

/* ---------- Phone verification (SMS OTP via Firebase) ---------- */
export async function setPhoneVerified(uid, phone) {
  await updateDoc(doc(db, "users", uid), { phoneVerified: true, phone: phone || "" });
}

/* ---------- Email verification via MailboxLayer (backend-validated) ---------- */
export async function setEmailVerified(uid, value = true) {
  await updateDoc(doc(db, "users", uid), { emailVerified: value });
}

/* ---------- Books / Writer / Reader ---------- */
export async function createBook({ uid, ownerName, title }) {
  const ref = await addDoc(collection(db, "books"), {
    ownerId: uid, ownerName: ownerName || "", title: title || "Untitled",
    blurb: "", genre: "General", price: 0, status: "draft",
    cover: null, reads: 0, rating: 0, ratingCount: 0, createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateBook(bookId, fields) {
  await updateDoc(doc(db, "books", bookId), fields);
}

export async function publishBookNow(bookId) {
  await updateDoc(doc(db, "books", bookId), { status: "published" });
}

export async function deleteBookCompletely(bookId) {
  const chs = await getDocs(collection(db, "books", bookId, "chapters"));
  await Promise.all(chs.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "books", bookId));
}

export async function getBookById(bookId) {
  const s = await getDoc(doc(db, "books", bookId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function getMyBooks(uid) {
  const snap = await getDocs(query(collection(db, "books"), where("ownerId", "==", uid)));
  const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return arr;
}

export async function getPublishedByOwner(uid) {
  const arr = await getMyBooks(uid);
  return arr.filter((b) => b.status === "published");
}

/* chapters */
export async function addChapter(bookId, title, order) {
  const ref = await addDoc(collection(db, "books", bookId, "chapters"),
    { title: title || "Untitled Chapter", content: "", words: 0, order });
  return ref.id;
}
export async function saveChapter(bookId, chId, fields) {
  await updateDoc(doc(db, "books", bookId, "chapters", chId), fields);
}
export async function deleteChapter(bookId, chId) {
  await deleteDoc(doc(db, "books", bookId, "chapters", chId));
}
export async function getChapters(bookId) {
  const snap = await getDocs(collection(db, "books", bookId, "chapters"));
  const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return arr;
}

/* Reading shelf — free users: max 3 books; gold/blue/admin: unlimited */
export async function openShelfSlot(uid, bookId, profile) {
  const ref = doc(db, "users", uid, "shelf", bookId);
  const snap = await getDoc(ref);
  if (snap.exists()) return { ok: true, existed: true, data: snap.data() };
  const unlimited = !!(profile?.goldTick || profile?.blueTick || profile?.role === "admin");
  if (!unlimited) {
    const all = await getDocs(collection(db, "users", uid, "shelf"));
    if (all.size >= 3) return { ok: false, limit: 3 };
  }
  await setDoc(ref, { addedAt: Date.now(), lastChapter: 0, lastScroll: 0 });
  await updateDoc(doc(db, "books", bookId), { reads: increment(1) }).catch(() => {});
  return { ok: true, existed: false, data: { addedAt: Date.now(), lastChapter: 0, lastScroll: 0 } };
}

export async function getShelf(uid) {
  const snap = await getDocs(collection(db, "users", uid, "shelf"));
  return snap.docs.map((d) => ({ bookId: d.id, ...d.data() }));
}

export async function saveReadingProgress(uid, bookId, lastChapter, lastScroll) {
  await setDoc(doc(db, "users", uid, "shelf", bookId),
    { lastChapter, lastScroll }, { merge: true });
}

/* ---------- AI Studio drafts ---------- */
export async function saveDraft({ uid, title, outline, manuscript, meta }) {
  return addDoc(collection(db, "users", uid, "drafts"), {
    title, outline, manuscript, meta, createdAt: serverTimestamp()
  });
}
export async function getDrafts(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "drafts"), orderBy("createdAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
