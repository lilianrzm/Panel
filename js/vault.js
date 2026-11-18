/*
 * Bóveda cifrada local.
 * - La contraseña nunca se guarda: de ella se deriva una llave (PBKDF2-SHA256).
 * - Los datos se cifran con AES-GCM de 256 bits (Web Crypto del propio navegador).
 * - Sin la contraseña, lo guardado en el dispositivo es ilegible.
 */
const Vault = (() => {
  const STORAGE_KEY = 'panel.vault.v1';
  const ITERATIONS = 310000;
  const FORMAT = 'panel-vault';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function supported() {
    return !!(window.crypto && crypto.subtle && crypto.getRandomValues);
  }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptRecord(key, salt, iterations, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    return { format: FORMAT, v: 1, iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
  }

  async function decryptRecord(record, password) {
    if (!record || record.format !== FORMAT) throw new Error('formato');
    const salt = fromB64(record.salt);
    const key = await deriveKey(password, salt, record.iterations);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(record.iv) }, key, fromB64(record.data));
    } catch (e) {
      throw new Error('contrasena');
    }
    return { key, salt, iterations: record.iterations, data: JSON.parse(dec.decode(plain)) };
  }

  function readStored() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // Sesión abierta (solo en memoria mientras la app está desbloqueada)
  let session = null;

  return {
    supported,
    exists() { return !!localStorage.getItem(STORAGE_KEY); },
    isOpen() { return !!session; },

    async create(password, data) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(password, salt, ITERATIONS);
      const record = await encryptRecord(key, salt, ITERATIONS, data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      session = { key, salt, iterations: ITERATIONS };
    },

    async unlock(password) {
      const res = await decryptRecord(readStored(), password);
      session = { key: res.key, salt: res.salt, iterations: res.iterations };
      return res.data;
    },

    async save(data) {
      if (!session) throw new Error('bloqueado');
      const record = await encryptRecord(session.key, session.salt, session.iterations, data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    },

    async verify(password) {
      try { await decryptRecord(readStored(), password); return true; } catch (e) { return false; }
    },

    async changePassword(newPassword, data) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(newPassword, salt, ITERATIONS);
      const record = await encryptRecord(key, salt, ITERATIONS, data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      session = { key, salt, iterations: ITERATIONS };
    },

    // El respaldo es la misma bóveda cifrada (con su sal) en un archivo
    backupText() {
      const record = readStored();
      record.exportedAt = new Date().toISOString();
      return JSON.stringify(record);
    },

    // Descifra un respaldo con la contraseña con la que se creó
    async readBackup(text, password) {
      let record;
      try { record = JSON.parse(text); } catch (e) { throw new Error('formato'); }
      const res = await decryptRecord(record, password);
      return res.data;
    },

    lock() { session = null; }
  };
})();
