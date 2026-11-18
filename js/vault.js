/*
 * Bóveda cifrada local.
 * - Los datos se cifran con una llave aleatoria (AES-GCM 256).
 * - Esa llave se guarda "envuelta" (cifrada) de dos formas posibles:
 *     1) con tu contraseña (PBKDF2-SHA256), siempre;
 *     2) con tu huella / Face ID (passkey del iPad, extensión PRF), si la activas.
 * - La contraseña nunca se guarda. Sin contraseña ni huella, los datos son ilegibles.
 */
const Vault = (() => {
  const STORAGE_KEY = 'panel.vault.v1';
  const ITERATIONS = 310000;
  const FORMAT = 'panel-vault';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  function toB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function supported() { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); }

  async function passKek(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function rawKey(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function open(key, box) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct)));
  }

  function readStored() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function writeStored(rec) { localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); }

  async function wrapWithPassword(password, dekRaw) {
    const salt = rand(16);
    const kek = await passKek(password, salt, ITERATIONS);
    return Object.assign({ salt: toB64(salt), iterations: ITERATIONS }, await seal(kek, dekRaw));
  }

  // Abre un registro (v1 antiguo o v2) con contraseña → { dekRaw | null, data }
  async function openWithPassword(rec, password) {
    if (!rec || rec.format !== FORMAT) throw new Error('formato');
    try {
      if (rec.v === 1) {
        const kek = await passKek(password, fromB64(rec.salt), rec.iterations);
        const plain = await open(kek, { iv: rec.iv, ct: rec.data });
        return { dekRaw: null, data: JSON.parse(dec.decode(plain)) };
      }
      const kek = await passKek(password, fromB64(rec.pass.salt), rec.pass.iterations);
      const dekRaw = await open(kek, rec.pass);
      const plain = await open(await rawKey(dekRaw), rec.box);
      return { dekRaw, data: JSON.parse(dec.decode(plain)) };
    } catch (e) {
      if (e.message === 'formato') throw e;
      throw new Error('contrasena');
    }
  }

  let session = null; // { dekRaw, dekKey } solo en memoria mientras está desbloqueado
  let pendingBio = null;

  async function startSession(dekRaw) { session = { dekRaw, dekKey: await rawKey(dekRaw) }; }

  async function writeData(data, rec) {
    rec.box = await seal(session.dekKey, enc.encode(JSON.stringify(data)));
    writeStored(rec);
  }

  async function newVault(password, data) {
    const dekRaw = rand(32);
    await startSession(dekRaw);
    const rec = { format: FORMAT, v: 2, pass: await wrapWithPassword(password, dekRaw) };
    await writeData(data, rec);
  }

  // ---------- Huella / Face ID (WebAuthn + PRF) ----------
  async function prfFromGet(credId, prfSalt) {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credId, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    });
    const r = cred.getClientExtensionResults();
    const out = r && r.prf && r.prf.results && r.prf.results.first;
    if (!out) throw new Error('prf');
    return new Uint8Array(out);
  }

  async function storeBio(credId, prfSalt, prfOut) {
    const rec = readStored();
    rec.bio = Object.assign({ credId: toB64(credId), prfSalt: toB64(prfSalt) }, await seal(await rawKey(prfOut.slice(0, 32)), session.dekRaw));
    writeStored(rec);
  }

  return {
    supported,
    exists() { return !!localStorage.getItem(STORAGE_KEY); },
    isOpen() { return !!session; },

    async create(password, data) { await newVault(password, data); },

    async unlock(password) {
      const rec = readStored();
      const res = await openWithPassword(rec, password);
      if (!res.dekRaw) { await newVault(password, res.data); return res.data; } // migra formato antiguo
      await startSession(res.dekRaw);
      return res.data;
    },

    async save(data) {
      if (!session) throw new Error('bloqueado');
      await writeData(data, readStored());
    },

    async verify(password) {
      try { await openWithPassword(readStored(), password); return true; } catch (e) { return false; }
    },

    async changePassword(newPassword) {
      if (!session) throw new Error('bloqueado');
      const rec = readStored();
      rec.pass = await wrapWithPassword(newPassword, session.dekRaw);
      writeStored(rec);
    },

    // El respaldo se abre solo con contraseña (la huella es de este iPad)
    backupText() {
      const rec = readStored();
      delete rec.bio;
      rec.exportedAt = new Date().toISOString();
      return JSON.stringify(rec);
    },

    async readBackup(text, password) {
      let rec;
      try { rec = JSON.parse(text); } catch (e) { throw new Error('formato'); }
      return (await openWithPassword(rec, password)).data;
    },

    // --- huella ---
    async bioAvailable() {
      try {
        return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      } catch (e) { return false; }
    },
    bioEnabled() { const r = readStored(); return !!(r && r.bio); },

    // Paso 1: crear la passkey. Devuelve 'listo' o 'confirmar' (falta un segundo toque).
    async enableBio() {
      if (!session) throw new Error('bloqueado');
      const prfSalt = rand(32);
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: rand(32),
          rp: { name: 'Panel', id: location.hostname },
          user: { id: rand(16), name: 'Panel', displayName: 'Panel' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required', requireResidentKey: true },
          timeout: 60000,
          extensions: { prf: { eval: { first: prfSalt } } }
        }
      });
      const r = cred.getClientExtensionResults();
      if (!r || !r.prf || r.prf.enabled === false) throw new Error('prf');
      const credId = new Uint8Array(cred.rawId);
      if (r.prf.results && r.prf.results.first) {
        await storeBio(credId, prfSalt, new Uint8Array(r.prf.results.first));
        return 'listo';
      }
      pendingBio = { credId, prfSalt };
      return 'confirmar';
    },

    // Paso 2 (si hizo falta): confirmar con la huella
    async confirmBio() {
      if (!pendingBio || !session) throw new Error('sin-pendiente');
      const out = await prfFromGet(pendingBio.credId, pendingBio.prfSalt);
      await storeBio(pendingBio.credId, pendingBio.prfSalt, out);
      pendingBio = null;
    },

    async unlockBio() {
      const rec = readStored();
      if (!rec || !rec.bio) throw new Error('sin-huella');
      const out = await prfFromGet(fromB64(rec.bio.credId), fromB64(rec.bio.prfSalt));
      let dekRaw;
      try { dekRaw = await open(await rawKey(out.slice(0, 32)), rec.bio); } catch (e) { throw new Error('huella'); }
      await startSession(dekRaw);
      return JSON.parse(dec.decode(await open(session.dekKey, rec.box)));
    },

    disableBio() {
      const rec = readStored();
      delete rec.bio;
      writeStored(rec);
      pendingBio = null;
    },

    lock() { session = null; pendingBio = null; }
  };
})();
