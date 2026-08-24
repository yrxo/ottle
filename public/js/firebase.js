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
