// Sincronización con Firebase: inicio de sesión con Google y un documento por persona
// en Firestore (users/{uid}). La app sigue funcionando sin cuenta y sin conexión:
// localStorage es la copia de trabajo y Firestore la copia en la nube.

import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';
import { mergeStates, syncSignature, toCloud, normalize } from './store.js';

const listeners = new Set();
const info = {
  // 'off' | 'loading' | 'signed-out' | 'connecting' | 'synced' | 'pending' | 'offline' | 'error' | 'unavailable'
  status: 'off',
  user: null,
  error: null,
  lastSync: null,
};

let fb = null;
let auth = null;
let db = null;
let unsubscribe = null;
let pushTimer = null;
let hooks = null;
// No se sube nada hasta haber leído la nube al menos una vez (evita pisar datos con un dispositivo vacío)
let serverSeen = false;

const set = (patch) => {
  Object.assign(info, patch);
  listeners.forEach((fn) => fn({ ...info }));
};

export const syncInfo = () => ({ ...info });
export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {{ getState: () => object, applyRemote: (merged: object, firstSync: boolean) => void, today: () => string }} h
 */
export async function initSync(h) {
  hooks = h;
  if (window.__AYUNO_PREVIEW__) return set({ status: 'unavailable', error: 'preview' });
  set({ status: 'loading' });
  try {
    const [app, authM, fsM] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`),
      import(`${FIREBASE_SDK}/firebase-firestore.js`),
    ]);
    fb = { ...authM, ...fsM };
    const firebaseApp = app.initializeApp(firebaseConfig);
    auth = authM.getAuth(firebaseApp);
    auth.languageCode = 'es';
    try {
      db = fsM.initializeFirestore(firebaseApp, {
        localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
      });
    } catch {
      db = fsM.getFirestore(firebaseApp);
    }
  } catch {
    // Sin conexión en la primera carga o CDN bloqueada: la app sigue en modo local
    return set({ status: 'unavailable', error: 'sdk' });
  }

  fb.getRedirectResult(auth).catch((e) => set({ error: e.code || 'auth/unknown' }));
  fb.onAuthStateChanged(auth, (user) => {
    if (user) {
      set({ user: { name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' }, error: null });
      listen(user.uid);
    } else {
      stopListening();
      set({ status: 'signed-out', user: null });
    }
  });
  window.addEventListener('online', () => info.user && info.status === 'offline' && set({ status: 'connecting' }));
  window.addEventListener('offline', () => info.user && set({ status: 'offline' }));
}

function listen(uid) {
  stopListening();
  set({ status: navigator.onLine ? 'connecting' : 'offline' });
  const ref = fb.doc(db, 'users', uid);
  let first = true;
  serverSeen = false;
  unsubscribe = fb.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    if (!snap.metadata.fromCache) serverSeen = true;
    const remote = snap.exists() ? snap.data() : null;
    const local = hooks.getState();
    const merged = mergeStates(local, remote, hooks.today());
    const mergedSig = syncSignature(merged);
    if (mergedSig !== syncSignature(local)) hooks.applyRemote(merged, first);
    // Si este dispositivo tiene datos más nuevos que la nube, súbelos
    const remoteSig = remote ? syncSignature(normalize(remote, hooks.today())) : '';
    if (serverSeen && remoteSig !== mergedSig) schedulePush(first ? 0 : 400);
    if (serverSeen) first = false;
    const m = snap.metadata;
    let status = 'synced';
    if (m.hasPendingWrites) status = 'pending';
    else if (m.fromCache) status = navigator.onLine ? 'connecting' : 'offline';
    set({ status, error: null, lastSync: status === 'synced' ? Date.now() : info.lastSync });
  }, (err) => {
    set({ status: 'error', error: err.code || 'unknown' });
  });
}

function stopListening() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  serverSeen = false;
  clearTimeout(pushTimer);
}

function schedulePush(delay = 600) {
  if (!auth?.currentUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, delay);
}

async function push() {
  const user = auth?.currentUser;
  if (!user || !serverSeen) return;
  const ref = fb.doc(db, 'users', user.uid);
  try {
    // La escritura queda en cola si no hay conexión y se envía al volver
    await fb.setDoc(ref, { ...toCloud(hooks.getState()), updatedAt: Date.now() });
  } catch (e) {
    set({ status: 'error', error: e.code || 'unknown' });
  }
}

/** Llamar después de cada cambio local guardado. */
export function notifyLocalChange() {
  if (info.user) schedulePush();
}

export async function signIn() {
  if (!auth) throw Object.assign(new Error('sdk'), { code: info.error === 'preview' ? 'preview' : 'sdk' });
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  set({ error: null });
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await fb.signInWithRedirect(auth, provider);
      return;
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    set({ error: e.code || 'auth/unknown' });
    throw e;
  }
}

export async function signOutSync() {
  if (!auth) return;
  clearTimeout(pushTimer);
  await fb.signOut(auth);
}

/** Mensaje en español para un código de error de Firebase. */
export function errorMessage(code) {
  const map = {
    preview: 'La sincronización funciona en la versión publicada de la app, no en esta vista previa.',
    sdk: 'No se pudo cargar Firebase. Revisa tu conexión y recarga la app.',
    'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase. Agrega emprende-ia.github.io en Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'El inicio de sesión con Google no está activado. Actívalo en Authentication → Sign-in method → Google.',
    'auth/configuration-not-found': 'Authentication no está configurado. En Firebase abre Authentication, toca Comenzar y activa Google.',
    'auth/network-request-failed': 'Sin conexión. Intenta de nuevo cuando tengas internet.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio.',
    'auth/internal-error': 'Google no pudo completar el inicio de sesión. Intenta de nuevo.',
    'permission-denied': 'Firebase rechazó el acceso a tus datos. Revisa que las reglas de Firestore estén publicadas.',
    'not-found': 'La base de datos de Firestore todavía no existe. Créala en Firebase → Firestore.',
    'failed-precondition': 'La base de datos de Firestore todavía no está lista. Créala en Firebase → Firestore.',
    unavailable: 'Firestore no responde. Tus cambios se guardan aquí y se suben después.',
  };
  return map[code] || `No se pudo sincronizar (${code}).`;
}
