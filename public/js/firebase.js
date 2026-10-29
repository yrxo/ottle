// public/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCWZqodMphE_c3ius68zkyvijjpsZDuf8Q",
  authDomain: "ottleb.firebaseapp.com",
  projectId: "ottleb",
  storageBucket: "ottleb.firebasestorage.app",
  messagingSenderId: "742280216335",
  appId: "1:742280216335:web:5278eee071c2e82a93c87a",
  measurementId: "G-V8K96X0ERB"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Groq — real LLM for AI Studio. Replace with your own key from https://console.groq.com
export const GROQ_API_KEY = "";
export const GROQ_MODEL = "llama-3.1-8b-instant";

export async function groqChat(messages, { temperature = 0.7, maxTokens = 1500 } = {}) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set — add your key in public/js/firebase.js");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature, max_tokens: maxTokens })
  });
  if (!r.ok) throw new Error("Groq API error: " + (await r.text()).slice(0, 200));
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}
