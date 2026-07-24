// firebase-shared.js
// Modul Firebase + identiti murid (Nama/Kelas/PIN) dikongsi oleh semua permainan
// projek "Seronoknya Bahasa". Setiap fail HTML game memuatkan fail ini sebagai
// <script type="module" src="firebase-shared.js"></script> selepas menetapkan
// window.SERONOK_GAME_ID kepada ID unik game tersebut, contoh:
//
//   <script>window.SERONOK_GAME_ID = 'teka-gambar-bm';</script>
//   <script type="module" src="firebase-shared.js"></script>
//
// Selepas siap dimuatkan, fail ini mendedahkan window.FirebaseAPI dan
// menghantar event "firebase-api-ready" supaya skrip utama (classic script)
// setiap game boleh mula guna fungsi di dalamnya.
//
// PENTING (nota diagnostik): initializeApp()/getFirestore() TIDAK menyentuh
// rangkaian sama sekali -- ia cuma membina objek SDK secara tempatan. Jadi
// isReady()==true tidak bermakna sambungan ke Firestore sebenarnya berjaya;
// ia cuma bermakna SDK berjaya dimuatkan. Kegagalan sebenar (rangkaian,
// firewall, gstatic.com disekat) berlaku semasa import SDK ITU SENDIRI, atau
// semasa panggilan getDoc/setDoc pertama. Sebab itu kod di bawah guna
// dynamic import() dibalut try/catch supaya SEBARANG kegagalan (termasuk
// import gagal) dapat ditangkap dan sebabnya didedahkan melalui
// window.FirebaseAPI.getInitError(), bukan hanya "belum tersedia" generik.

window.FirebaseAPI = window.FirebaseAPI || {};
let db = null;
let initError = null;
let dbApp = null;
let firestoreFns = null;
let authFns = null;
let authInst = null;

const GAME_ID = window.SERONOK_GAME_ID;
if (!GAME_ID) {
  console.error("firebase-shared.js: sila tetapkan window.SERONOK_GAME_ID sebelum memuatkan fail ini.");
}

// Bunyi jawapan (betul/salah) -- disintesis terus guna Web Audio API, TIADA fail
// audio luaran diperlukan. Sengaja diletak di luar aliran Firebase supaya bunyi
// tetap berfungsi walaupun Firebase gagal sambung.
let audioCtx = null;
function getAudioCtx() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}
function playTone(freq, startTime, duration, type, vol) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startTime;
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}
const soundAPI = {
  playCorrect() {
    try {
      playTone(523.25, 0,    0.13, 'sine', 0.22); // C5
      playTone(659.25, 0.09, 0.13, 'sine', 0.22); // E5
      playTone(783.99, 0.18, 0.24, 'sine', 0.24); // G5
    } catch (e) {}
  },
  playWrong() {
    try {
      playTone(190, 0,    0.16, 'sawtooth', 0.16);
      playTone(140, 0.14, 0.24, 'sawtooth', 0.16);
    } catch (e) {}
  }
};
window.FirebaseAPI.sound = soundAPI;

const firebaseConfig = {
  apiKey: "AIzaSyDlmo9-iUOR5aBjoWg5Rqk8TVhYY7mr7Ik",
  authDomain: "seronoknyabahasa.firebaseapp.com",
  projectId: "seronoknyabahasa",
  storageBucket: "seronoknyabahasa.firebasestorage.app",
  messagingSenderId: "512712221726",
  appId: "1:512712221726:web:f6f3a95a3591b365493a0f"
};

async function initFirebase() {
  try {
    const [{ initializeApp }, firestoreMod, authMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js")
    ]);
    firestoreFns = firestoreMod;
    authFns = authMod;
    dbApp = initializeApp(firebaseConfig);
    db = firestoreFns.getFirestore(dbApp);
    authInst = authFns.getAuth(dbApp);

    // isReady() only proves the SDK loaded -- do one cheap real network round-trip
    // (reading a single doc that may or may not exist) so we know connectivity itself
    // actually works, not just that the SDK objects were constructed.
    try {
      // NOTA: ID dokumen TIDAK BOLEH bermula & berakhir dengan "__" (cth. "__foo__") --
      // Firestore menempah corak itu untuk kegunaan dalaman dan akan tolak dengan ralat
      // "invalid-argument: Resource id ... is reserved". Ini pernah jadi punca sebenar
      // kegagalan probe ini walaupun sambungan rangkaian sebenarnya OK.
      const probeRef = firestoreFns.doc(db, "students", "connectivity_probe");
      await firestoreFns.getDoc(probeRef);
    } catch (netErr) {
      initError = `SDK dimuatkan tetapi sambungan ke Firestore gagal: ${netErr.code || netErr.message || netErr}`;
      console.error("Firestore connectivity probe gagal:", netErr);
      db = null;
    }
  } catch (e) {
    initError = `Gagal muatkan Firebase SDK daripada gstatic.com: ${e.message || e}`;
    console.error("Firebase SDK import/init gagal:", e);
  }

  window.dispatchEvent(new Event("firebase-api-ready"));
}

function slugify(text) {
  return text.toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Object.assign(window.FirebaseAPI, {
  isReady() { return !!db; },
  getInitError() { return initError; },

  slugify,
  sha256Hex,

  // Cipta profil murid baru (kali pertama) ATAU sahkan PIN sedia ada (kali seterusnya)
  // Koleksi DIKONGSI merentasi semua permainan: /students/{studentId}
  async verifyOrCreateProfile(studentId, name, kelas, pinHash) {
    if (!db) return { ok: false, status: 'offline', reason: initError };
    try {
      const { doc, getDoc, setDoc, serverTimestamp } = firestoreFns;
      const ref = doc(db, "students", studentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          name: name,
          kelas: kelas,
          pinHash: pinHash,
          createdAt: serverTimestamp()
        });
        return { ok: true, status: 'created' };
      } else {
        const data = snap.data();
        if (data.pinHash === pinHash) {
          return { ok: true, status: 'verified' };
        } else {
          return { ok: false, status: 'mismatch' };
        }
      }
    } catch (e) {
      console.error("Gagal sahkan/cipta profil:", e);
      return { ok: false, status: 'error', reason: e.message };
    }
  },

  // Cari profil murid sedia ada (nama/kelas) tanpa perlu sahkan PIN -- guna oleh
  // dashboard-ibubapa.html untuk ibu bapa/guru "tambah anak" (baca sahaja, tiada PIN).
  async getStudentProfile(studentId) {
    if (!db) return null;
    try {
      const { doc, getDoc } = firestoreFns;
      const snap = await getDoc(doc(db, "students", studentId));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.error("Gagal cari profil murid:", e);
      return null;
    }
  },

  // Baca satu dokumen markah untuk MANA-MANA game/level -- tidak terikat kepada
  // window.SERONOK_GAME_ID semasa, kerana dashboard perlu baca merentasi semua game.
  async getScoreAny(gameId, levelId, studentId) {
    if (!db) return null;
    try {
      const { doc, getDoc } = firestoreFns;
      const snap = await getDoc(doc(db, "games", gameId, "kampung", levelId, "scores", studentId));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.error("Gagal baca markah", gameId, levelId, e);
      return null;
    }
  },

  // Dokumen ibu bapa/guru: /parents/{uid} -- { children: [studentId, ...] }
  async getParentDoc(uid) {
    if (!db) return null;
    try {
      const { doc, getDoc } = firestoreFns;
      const snap = await getDoc(doc(db, "parents", uid));
      return snap.exists() ? snap.data() : { children: [] };
    } catch (e) {
      console.error("Gagal baca dokumen ibu bapa:", e);
      return { children: [] };
    }
  },
  async addChildToParent(uid, studentId) {
    if (!db) return { ok: false, reason: initError || "offline" };
    try {
      const { doc, setDoc, arrayUnion, serverTimestamp } = firestoreFns;
      await setDoc(doc(db, "parents", uid), {
        children: arrayUnion(studentId),
        updatedAt: serverTimestamp()
      }, { merge: true });
      return { ok: true };
    } catch (e) {
      console.error("Gagal tambah anak:", e);
      return { ok: false, reason: e.message };
    }
  },
  async removeChildFromParent(uid, studentId) {
    if (!db) return { ok: false, reason: initError || "offline" };
    try {
      const { doc, setDoc, arrayRemove } = firestoreFns;
      await setDoc(doc(db, "parents", uid), { children: arrayRemove(studentId) }, { merge: true });
      return { ok: true };
    } catch (e) {
      console.error("Gagal buang anak:", e);
      return { ok: false, reason: e.message };
    }
  },

  // Muatkan semula kemajuan murid untuk satu atau lebih level/kampung dalam game ini
  async loadProgress(studentId, levelIds) {
    const result = {};
    if (!db) return result;
    const { doc, getDoc } = firestoreFns;
    for (const lid of levelIds) {
      try {
        const ref = doc(db, "games", GAME_ID, "kampung", lid, "scores", studentId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          result[lid] = snap.data().stars || 0;
        }
      } catch (e) {
        console.error("Gagal muat kemajuan untuk", lid, e);
      }
    }
    return result;
  },

  // Muatkan data PENUH (bukan sekadar stars) untuk satu atau lebih level/kampung —
  // guna ini bila sesuatu game perlu baca medan lain yang disimpan bersama markah,
  // contohnya playCount untuk putaran set soalan supaya soalan tidak berulang.
  async loadLevelData(studentId, levelIds) {
    const result = {};
    if (!db) return result;
    const { doc, getDoc } = firestoreFns;
    for (const lid of levelIds) {
      try {
        const ref = doc(db, "games", GAME_ID, "kampung", lid, "scores", studentId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          result[lid] = snap.data();
        }
      } catch (e) {
        console.error("Gagal muat data untuk", lid, e);
      }
    }
    return result;
  },

  // Simpan markah satu level/kampung
  async saveScore(levelId, studentId, payload) {
    if (!db) return { ok: false, reason: initError || "offline" };
    try {
      const { doc, setDoc, serverTimestamp } = firestoreFns;
      const ref = doc(db, "games", GAME_ID, "kampung", levelId, "scores", studentId);
      await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      return { ok: true };
    } catch (e) {
      console.error("Gagal simpan markah:", e);
      return { ok: false, reason: e.message };
    }
  },

  // Akaun ibu bapa/guru (Firebase Authentication e-mel+kata laluan) -- guna oleh
  // dashboard-ibubapa.html sahaja, tidak digunakan oleh mana-mana game murid.
  auth: {
    async signUp(email, password) {
      if (!authInst) return { ok: false, reason: initError || "offline" };
      try {
        const cred = await authFns.createUserWithEmailAndPassword(authInst, email, password);
        return { ok: true, uid: cred.user.uid };
      } catch (e) {
        return { ok: false, reason: mapAuthError(e) };
      }
    },
    async signIn(email, password) {
      if (!authInst) return { ok: false, reason: initError || "offline" };
      try {
        const cred = await authFns.signInWithEmailAndPassword(authInst, email, password);
        return { ok: true, uid: cred.user.uid };
      } catch (e) {
        return { ok: false, reason: mapAuthError(e) };
      }
    },
    async signOutUser() {
      if (!authInst) return { ok: false };
      await authFns.signOut(authInst);
      return { ok: true };
    },
    onChange(callback) {
      if (!authInst) { callback(null); return; }
      authFns.onAuthStateChanged(authInst, callback);
    },
    getCurrentUser() {
      return authInst ? authInst.currentUser : null;
    }
  }
});

function mapAuthError(e) {
  const code = e.code || '';
  const map = {
    'auth/email-already-in-use': 'E-mel ini sudah didaftarkan. Sila log masuk sahaja.',
    'auth/invalid-email': 'Format e-mel tidak sah.',
    'auth/weak-password': 'Kata laluan terlalu lemah (minimum 6 aksara).',
    'auth/user-not-found': 'Akaun dengan e-mel ini tidak wujud. Sila daftar dahulu.',
    'auth/wrong-password': 'Kata laluan salah.',
    'auth/invalid-credential': 'E-mel atau kata laluan salah.',
    'auth/too-many-requests': 'Terlalu banyak percubaan. Sila cuba lagi sebentar.'
  };
  return map[code] || (e.message || String(e));
}

initFirebase();
