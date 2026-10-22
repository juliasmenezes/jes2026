/* =====================================================
   JES 2026 — firebase-setup.js
   Inicializa o Firebase (Firestore) via CDN modular
   Cache persistente: recarregamentos abrem instantaneamente
   e o mesário continua operando se a rede oscilar
   ===================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBny-GK_-KIdB8s-olEFUIjVYuU3joHB-U",
  authDomain: "jes-2026-906cf.firebaseapp.com",
  projectId: "jes-2026-906cf",
  storageBucket: "jes-2026-906cf.firebasestorage.app",
  messagingSenderId: "686701500681",
  appId: "1:686701500681:web:9734146c32e0ada1a09bd8",
  measurementId: "G-J2KVLYX4E2"
};

const app = initializeApp(firebaseConfig);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (err) {
  /* Navegadores sem IndexedDB (ex.: aba anônima restrita) usam o cache em memória */
  console.warn('Cache persistente indisponível, usando memória:', err);
  db = getFirestore(app);
}

window.__firebase = { app: app, db: db };

/* Defer to next microtask so app.js (also a module) has a chance to register its listener */
setTimeout(function () {
  window.dispatchEvent(new Event('firebase-ready'));
}, 0);
