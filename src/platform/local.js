// "Use without signing in": the same db shape as the Firestore adapter in firebase.js, kept in this browser's
// localStorage. One key per document ("qcard:local:<path>", JSON). Nothing is sent anywhere. Other tabs on the same
// device see changes through the storage event.
const PREFIX = "qcard:local:";
const segs = (p) => String(p).split("/").filter(Boolean);
const clean = (p) => segs(p).join("/");

function read(path) {
  try { const v = localStorage.getItem(PREFIX + path); return v == null ? undefined : JSON.parse(v); } catch { return undefined; }
}
function paths() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); }
  return out;
}

const listeners = new Set();
function changed() { for (const l of listeners) setTimeout(() => listeners.has(l) && l.fire(), 0); }
addEventListener("storage", (e) => { if (e.key == null || e.key.startsWith(PREFIX)) changed(); });

function write(path, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + path);
    else localStorage.setItem(PREFIX + path, JSON.stringify(value)); // JSON drops undefined fields, like ignoreUndefinedProperties
  } catch (e) {
    throw { code: "resource-exhausted", message: "This browser's storage for Q-Card is full. Export your sets, then delete some practice history." };
  }
  changed();
}

const docSnap = (path) => { const v = read(path); return { id: segs(path).at(-1), exists: v !== undefined, data: () => v }; };
function runQuery(path, parts) {
  const n = segs(path).length;
  let ps = paths().filter((p) => p.startsWith(path + "/") && segs(p).length === n + 1).sort();
  for (const part of parts) {
    if (part.order) {
      const [f, dir] = part.order, val = new Map(ps.map((p) => [p, read(p)?.[f]]));
      ps = ps.filter((p) => val.get(p) !== undefined).sort((a, b) => (val.get(a) < val.get(b) ? -1 : val.get(a) > val.get(b) ? 1 : 0) * (dir === "desc" ? -1 : 1));
    }
    if (part.limit != null) ps = ps.slice(0, part.limit);
  }
  const docs = ps.map(docSnap);
  return { docs, size: docs.length, empty: !docs.length };
}
function watch(snap, next) {
  const l = { fire: () => next(snap()) };
  listeners.add(l);
  setTimeout(() => listeners.has(l) && l.fire(), 0);
  return () => listeners.delete(l);
}

export function makeLocalDb() {
  const docRef = (p) => {
    const path = clean(p);
    return {
      id: segs(path).at(-1),
      get: async () => docSnap(path),
      set: async (data) => write(path, data),
      update: async (data) => {
        const cur = read(path);
        if (cur === undefined) throw { code: "not-found", message: path };
        write(path, { ...cur, ...data });
      },
      delete: async () => write(path, undefined),
      onSnapshot: (next) => watch(() => docSnap(path), next),
    };
  };
  const colRef = (p, parts = []) => {
    const path = clean(p);
    return {
      doc: (id) => docRef(`${path}/${id}`),
      orderBy: (field, dir = "asc") => colRef(path, [...parts, { order: [field, dir] }]),
      limit: (n) => colRef(path, [...parts, { limit: n }]),
      get: async () => runQuery(path, parts),
      onSnapshot: (next) => watch(() => runQuery(path, parts), next),
    };
  };
  return { doc: docRef, collection: colRef };
}
