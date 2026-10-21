// In-memory stand-in for the parts of the Firebase SDK that src/platform/firebase.js uses, for browser tests.
// Data and the signed-in user survive reloads (localStorage), and the security rules are enforced:
// a signed-in person may only touch users/<their uid>/….
const LS_DB = "fake:fs", LS_USER = "fake:user";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- app ----------
export const initializeApp = (config) => ({ config });

// ---------- auth ----------
const authCbs = new Set();
let current = load(LS_USER, null);
const emit = () => authCbs.forEach((cb) => cb(current));
export const getAuth = () => ({ get currentUser() { return current; } });
export class GoogleAuthProvider {}
export function onAuthStateChanged(_auth, cb) { authCbs.add(cb); setTimeout(() => cb(current), 0); return () => authCbs.delete(cb); }
export async function signInWithPopup() {
  if (window.__signInError) throw { code: window.__signInError };
  current = window.__nextUser || { uid: "u1", displayName: "Test Student", email: "student@example.com" };
  save(LS_USER, current); emit();
  return { user: current };
}
export async function signOut() { current = null; localStorage.removeItem(LS_USER); emit(); }
// window.__staleLogin makes deleteUser ask for a recent sign-in first, as Firebase does after a while.
let reauthed = false;
export async function reauthenticateWithPopup() { if (window.__signInError) throw { code: window.__signInError }; reauthed = true; }
export async function deleteUser() {
  if (window.__staleLogin && !reauthed) throw { code: "auth/requires-recent-login" };
  window.__deletedUsers = [...(window.__deletedUsers || []), current?.uid]; localStorage.setItem("fake:deleted", JSON.stringify(window.__deletedUsers));
  current = null; localStorage.removeItem(LS_USER); emit();
}

// ---------- firestore ----------
let data = load(LS_DB, {}); // path → fields
const listeners = new Set();
window.__fs = { all: () => data, log: [] };
const segs = (p) => p.split("/").filter(Boolean);
function allowed(path, write = false) {
  const s = segs(path);
  if (!current) throw { code: "permission-denied", message: "signed out" };
  if (s[0] === "dev" && s.length === 2 && s[1] === current.uid && !write) return;
  if (s[0] !== "users" || s[1] !== current.uid) throw { code: "permission-denied", message: "rules: " + path };
}
function clean(v, where) {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => { if (Array.isArray(x)) throw { code: "invalid-argument", message: "nested arrays in " + where }; return clean(x, where); });
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) { const c = clean(x, where); if (c !== undefined) o[k] = c; } return o; }
  return v;
}
export const initializeFirestore = (_app, settings) => ({ settings });
export function doc(_fs, path) { if (segs(path).length % 2) throw new Error("doc path needs an even number of segments: " + path); return { kind: "doc", path, id: segs(path).at(-1) }; }
export function collection(_fs, path) { if (!(segs(path).length % 2)) throw new Error("collection path needs an odd number of segments: " + path); return { kind: "col", path, id: segs(path).at(-1) }; }
export const orderBy = (field, dir = "asc") => ({ t: "order", field, dir });
export const limit = (n) => ({ t: "limit", n });
export const query = (ref, ...parts) => ({ ...ref, parts: [...(ref.parts || []), ...parts] });
// Like Firestore, a snapshot keeps the data as it was when it was taken, even if the document changes before it's read.
const docSnap = (path) => { const has = path in data, v = has ? structuredClone(data[path]) : undefined; return { id: segs(path).at(-1), exists: () => has, data: () => structuredClone(v) }; };
function runQuery(q) {
  const base = segs(q.path).length;
  let paths = Object.keys(data).filter((p) => p.startsWith(q.path + "/") && segs(p).length === base + 1);
  for (const part of q.parts || []) {
    if (part.t === "order") paths = paths.filter((p) => data[p][part.field] !== undefined).sort((a, b) => (data[a][part.field] < data[b][part.field] ? -1 : 1) * (part.dir === "desc" ? -1 : 1));
    if (part.t === "limit") paths = paths.slice(0, part.n);
  }
  if (!(q.parts || []).some((p) => p.t === "order")) paths.sort();
  const docs = paths.map(docSnap);
  return { docs, size: docs.length, empty: !docs.length };
}
const snapOf = (ref) => (ref.kind === "doc" ? docSnap(ref.path) : runQuery(ref));
export function onSnapshot(ref, next, error) {
  try { allowed(ref.path); } catch (e) { setTimeout(() => error?.(e), 0); return () => {}; }
  const l = { ref, next };
  listeners.add(l);
  setTimeout(() => listeners.has(l) && next(snapOf(ref)), 0);
  return () => listeners.delete(l);
}
function changed() { save(LS_DB, data); for (const l of listeners) { const snap = snapOf(l.ref); setTimeout(() => l.next(snap), 0); } }
export async function getDoc(ref) { allowed(ref.path); return docSnap(ref.path); }
export async function getDocs(ref) { allowed(ref.path); return runQuery(ref); }
export async function setDoc(ref, v) { allowed(ref.path, true); window.__fs.log.push(["set", ref.path]); data[ref.path] = clean(v, ref.path); changed(); }
export async function updateDoc(ref, v) {
  allowed(ref.path, true);
  if (!(ref.path in data)) throw { code: "not-found", message: ref.path };
  window.__fs.log.push(["update", ref.path]); data[ref.path] = { ...data[ref.path], ...clean(v, ref.path) }; changed();
}
export async function deleteDoc(ref) { allowed(ref.path, true); window.__fs.log.push(["delete", ref.path]); delete data[ref.path]; changed(); }
