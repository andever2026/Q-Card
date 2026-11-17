// The public site's platform: Google sign-in, a private Firestore folder per person (or this browser's storage for
// people who don't sign in, src/account/local.js) and file downloads. The page was written against claude.ai's artifact runtime
// (window.claude.use("db" | "user" | "downloads")), so this hands it objects with the same shape.
// Bundled into js/platform.js by tools/build.mjs.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser, reauthenticateWithPopup } from "firebase/auth";
import { initializeFirestore, doc, collection, query, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import config from "./config.js";
import { makeLocalDb } from "./local.js";
import { saveFile } from "../import-export/save-file.js";

const app = initializeApp(config);
const auth = getAuth(app);
// The page sometimes leaves optional fields undefined; Firestore would otherwise reject the whole write.
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });

const who = (u) => u && { uid: u.uid, name: u.displayName || "", email: u.email || "" };

// claude.ai paths → Firestore paths, all inside users/<uid>/:
//   sets/<id>, kanji/<id>, meta/books, meta/views … → users/<uid>/sets/<id>, …
//   data/users/<uid>/<id> (history and its settings doc) → users/<uid>/data/<id>
function mapPath(uid, path) {
  const p = String(path).replace(/^\/+|\/+$/g, ""), own = `data/users/${uid}`;
  return p === own || p.startsWith(own + "/") ? `users/${uid}/data${p.slice(own.length)}` : `users/${uid}/${p}`;
}
const docSnap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data() });
const querySnap = (s) => ({ docs: s.docs.map(docSnap), size: s.size, empty: s.empty });

// A store over one part of the database: at(path) is where a path the page uses is kept.
function makeDb(at) {
  const docRef = (path) => {
    const ref = doc(fs, at(path));
    return {
      id: ref.id,
      get: async () => docSnap(await getDoc(ref)),
      set: (data) => setDoc(ref, data),
      update: (data) => updateDoc(ref, data),
      delete: () => deleteDoc(ref),
      onSnapshot: (next, error) => onSnapshot(ref, (s) => next(docSnap(s)), error),
    };
  };
  const colRef = (path, parts = []) => {
    const ref = collection(fs, at(path)), q = () => (parts.length ? query(ref, ...parts) : ref);
    return {
      doc: (id) => docRef(`${path}/${id}`),
      orderBy: (field, dir) => colRef(path, [...parts, orderBy(field, dir)]),
      limit: (n) => colRef(path, [...parts, limit(n)]),
      get: async () => querySnap(await getDocs(q())),
      onSnapshot: (next, error) => onSnapshot(q(), (s) => next(querySnap(s)), error),
    };
  };
  return { doc: docRef, collection: colRef };
}

// Everyone owns their own folder, so they can edit their sets and keep history there.
const makeUser = (uid) => ({ id: async () => uid, isOwner: async () => true, can: async () => true, canEdit: async () => true });

const downloads = {
  async save({ filename, data }) { saveFile(filename, data); return { status: "saved" }; },
};

window.qcardPlatform = {
  onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(who(u))),
  signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
  signOut: () => signOut(auth),
  // Deleting an account needs a sign-in from the last 5 minutes. Older, Google's "confirm it's you" opens here, before
  // anything is deleted, straight from the click (a browser may block the window once the deleting has taken a while).
  confirmSignIn: async () => {
    const u = auth.currentUser;
    if (u && Date.now() - Date.parse(u.metadata?.lastSignInTime) > 4 * 60e3) await reauthenticateWithPopup(u, new GoogleAuthProvider());
  },
  // Deleting the sign-in itself needs a recent sign-in; after a while Google asks the person to confirm it's them first.
  deleteAccount: async () => {
    const u = auth.currentUser;
    if (!u) return;
    try { await deleteUser(u); }
    catch (e) { if (e?.code !== "auth/requires-recent-login") throw e; await reauthenticateWithPopup(u, new GoogleAuthProvider()); await deleteUser(u); }
  },
  // Where someone's vocab is kept: their own folder in the database when signed in (u as onAuth gives it), else this
  // browser. The site and the AI page's import both ask here, so they always agree.
  storeFor: (u) => (u ? { id: u.uid, db: makeDb((p) => mapPath(u.uid, p)) } : { id: "local", db: makeLocalDb() }),
  // A notebook someone shared (see firestore.rules): shares/<id> says what it is and holds a copy of the notebook's
  // documents under it (shares/<id>/sets/<set> …), which anyone who has the id may read, signed in or not;
  // shareOwners/<id>, which only its owner can read, says whose it is. Only the owner can change any of it.
  shared: (id) => { const all = makeDb((p) => p); return { info: all.doc(`shares/${id}`), owner: all.doc(`shareOwners/${id}`), db: makeDb((p) => `shares/${id}/${p}`) }; },
  user: makeUser,
  // Whether this account is a developer: dev/<uid> exists (see firestore.rules; only the Firebase console makes it).
  isDev: async (uid) => { try { return (await getDoc(doc(fs, "dev/" + uid))).exists(); } catch { return false; } },
  downloads,
  _mapPath: mapPath,
};
