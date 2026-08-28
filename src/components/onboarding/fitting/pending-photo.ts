/** Guest-held face photo. Survives reload + OnboardingGate remount. Never uploaded. */

const DB_NAME = "shoop.fitting.photo.v1";
const STORE = "files";
const KEY = "face";

type StoredFace = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

let pending: File | null = null;

function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb"));
    tx.onabort = () => reject(tx.error ?? new Error("idb abort"));
  });
}

async function writeStoredFace(file: File | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openPhotoDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (!file) store.delete(KEY);
    else {
      const row: StoredFace = {
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        blob: file,
      };
      store.put(row, KEY);
    }
    await waitTx(tx);
  } finally {
    db.close();
  }
}

function fileFromStored(row: StoredFace): File {
  return new File([row.blob], row.name || "face.jpg", {
    type: row.type || "image/jpeg",
    lastModified: row.lastModified || Date.now(),
  });
}

async function readStoredFace(): Promise<File | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openPhotoDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await idbRequest(tx.objectStore(STORE).get(KEY));
    if (!row || typeof row !== "object" || !("blob" in row)) return null;
    return fileFromStored(row as StoredFace);
  } finally {
    db.close();
  }
}

function persistFace(file: File | null) {
  void writeStoredFace(file).catch(() => undefined);
}

export function setPendingFittingPhoto(file: File | null) {
  pending = file;
  persistFace(file);
}

export function getPendingFittingPhoto(): File | null {
  return pending;
}

export async function loadPersistedFittingPhoto(): Promise<File | null> {
  if (pending) return pending;
  try {
    const file = await readStoredFace();
    if (file) pending = file;
    return file;
  } catch {
    return null;
  }
}

export function clearPendingFittingPhoto() {
  pending = null;
  persistFace(null);
}
