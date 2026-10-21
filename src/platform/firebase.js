// The public site's platform: Google sign-in, a private Firestore folder per person (or this browser's storage for
// people who don't sign in, src/platform/local.js), file downloads, and Claude checking with the visitor's own API key
// (src/platform/claude.js). The page was written against claude.ai's artifact runtime
// (window.claude.use("db" | "user" | "downloads")), so this hands it objects with the same shape.
// Bundled into js/platform.js by tools/build.mjs.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser, reauthenticateWithPopup } from "firebase/auth";
import { initializeFirestore, doc, collection, query, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import config from "./config.js";
import { makeLocalDb } from "./local.js";

const app = initializeApp(config);
const auth = getAuth(app);
// The page sometimes leaves optional fields undefined; Firestore would otherwise reject the whole write.
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });

const who = (u) => u && { uid: u.uid, name: u.displayName || "", email: u.email || "" };

// claude.ai paths → Firestore paths, all inside users/<uid>/:
//   sets/<id>, kanji/<id>, meta/books, meta/courses → users/<uid>/sets/<id>, …
//   data/users/<uid>/<id> (history and its settings doc) → users/<uid>/data/<id>
function mapPath(uid, path) {
  const p = String(path).replace(/^\/+|\/+$/g, ""), own = `data/users/${uid}`;
  return p === own || p.startsWith(own + "/") ? `users/${uid}/data${p.slice(own.length)}` : `users/${uid}/${p}`;
}
const docSnap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data() });
const querySnap = (s) => ({ docs: s.docs.map(docSnap), size: s.size, empty: s.empty });

function makeDb(uid) {
  const docRef = (path) => {
    const ref = doc(fs, mapPath(uid, path));
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
    const ref = collection(fs, mapPath(uid, path)), q = () => (parts.length ? query(ref, ...parts) : ref);
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
  async save({ filename, data }) {
    const type = /\.json$/i.test(filename) ? "application/json" : "application/octet-stream";
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { status: "saved" };
  },
};

// The Anthropic SDK is only needed by visitors who check with their own key, so it loads on first use.
let claudeJs = null;
function askClaude(req) {
  claudeJs ||= new Promise((res, rej) => {
    const el = Object.assign(document.createElement("script"), { src: "js/claude.js" });
    el.onload = () => (window.qcardClaude ? res(window.qcardClaude) : rej({ code: "key_network" }));
    el.onerror = () => { claudeJs = null; rej({ code: "key_network" }); };
    document.head.append(el);
  });
  return claudeJs.then((c) => c.ask(req));
}

window.qcardPlatform = {
  onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(who(u))),
  signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
  signOut: () => signOut(auth),
  // Deleting the sign-in itself needs a recent sign-in; after a while Google asks the person to confirm it's them first.
  deleteAccount: async () => {
    const u = auth.currentUser;
    if (!u) return;
    try { await deleteUser(u); }
    catch (e) { if (e?.code !== "auth/requires-recent-login") throw e; await reauthenticateWithPopup(u, new GoogleAuthProvider()); await deleteUser(u); }
  },
  db: makeDb,
  localDb: makeLocalDb,
  user: makeUser,
  downloads,
  askClaude,
  _mapPath: mapPath,
};
