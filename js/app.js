/* Gestor-S — app principal */
(() => {
  'use strict';

  // ================= Constantes =================
  const ESTATUS = [
    { id: 'capturado', label: 'Capturado' },
    { id: 'curso', label: 'En curso' },
    { id: 'detenido', label: 'Detenido' },
    { id: 'terminado', label: 'Terminado' },
    { id: 'cancelado', label: 'Cancelado' }
  ];
  const ESTATUS_LABEL = Object.fromEntries(ESTATUS.map(e => [e.id, e.label]));
  const CERRADOS = ['terminado', 'cancelado'];
  const PRIORIDADES = [{ id: 'alta', label: 'Alta' }, { id: 'media', label: 'Media' }, { id: 'baja', label: 'Baja' }];
  const PRIORIDAD_LABEL = Object.fromEntries(PRIORIDADES.map(p => [p.id, p.label]));
  const THEMES = [
    { id: 'azul', label: 'Azul institucional', color: '#1f3a5f' },
    { id: 'guinda', label: 'Guinda', color: '#691c32' },
    { id: 'verde', label: 'Verde', color: '#1e5b4f' },
    { id: 'gris', label: 'Gris neutro', color: '#3f4752' },
    { id: 'oscuro', label: 'Modo oscuro', color: '#11161d' }
  ];
  const PALETTE = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#be123c'];
  const GRAY = '#94a3b8';
  const DEFAULT_NAME = 'Gestor-S';
  const PREFS_KEY = 'panel.prefs';
  const LOCK_WHEN_HIDDEN_MS = 30 * 1000;
  const BACKUP_REMINDER_DAYS = 7;
  const SCHEMA = 2;

  const DEPENDENCIAS = [
    'Presidencia Municipal',
    'Coordinación de Comunicación Social',
    'Coordinación de Participación Ciudadana',
    'Coordinación de Medio Ambiente y Protección Animal',
    'Coordinación de Relaciones Públicas',
    'Coordinación de Transparencia, Gobierno Abierto y Archivos',
    'Dirección de Desarrollo Económico y Competitividad',
    'Dirección de Desarrollo Humano y Educación',
    'Dirección de Desarrollo Rural',
    'Dirección de Desarrollo Urbano y Ecología',
    'Dirección de Mantenimiento Urbano',
    'Dirección de Obras Públicas',
    'Dirección de Planeación e Innovación Gubernamental',
    'Dirección de Seguridad Pública Municipal',
    'Dirección de Servicios Públicos Municipales',
    'Dirección del Órgano Interno de Control',
    'Oficialía Mayor',
    'Secretaría del H. Ayuntamiento',
    'Sindicatura',
    'Tesorería Municipal',
    'Consejo de Urbanización Municipal',
    'Desarrollo Integral de la Familia',
    'Instituto de Cultura del Municipio',
    'Instituto de Planeación Integral del Municipio de Chihuahua',
    'Instituto Municipal de Cultura Física y Deporte',
    'Instituto Municipal de las Mujeres',
    'Instituto Municipal de Pensiones',
    'Instituto Municipal de Prevención y Atención a la Salud',
    'Gobierno del Estado'
  ];
  const MEDIOS = ['Recorrido en colonia', 'Redes sociales oficiales', 'Atención directa en oficina', 'Llamada telefónica', 'Evento público'];
  const FUENTES = ['Alcalde', 'Despacho', 'Coordinación de Gobernanzas', 'Regidores', 'Diputados', 'Redes sociales'];
  const TIPOS = ['Servicios públicos', 'Obra pública', 'Seguridad', 'Desarrollo social', 'Apoyo económico', 'Trámite', 'Otro'];
  const MUNICIPIOS = ['Chihuahua', 'Aldama', 'Aquiles Serdán', 'Juárez', 'Cuauhtémoc', 'Delicias', 'Hidalgo del Parral'];

  // Versión anterior (para migrar sin perder lo que hayas agregado)
  const OLD_DEPENDENCIAS = ['Dirección de Obras Públicas', 'Dirección de Mantenimiento Urbano', 'Dirección de Servicios Públicos', 'Dirección de Seguridad Pública', 'Dirección de Desarrollo Humano y Educación', 'Dirección de Desarrollo Urbano y Ecología', 'DIF Municipal', 'Tesorería Municipal', 'Coordinación de Medio Ambiente y Protección Animal', 'Coordinación de Participación Ciudadana', 'Gobierno del Estado', 'Otra'];
  const OLD_FUENTE_A_MEDIO = { 'Recorrido': 'Recorrido en colonia', 'Presencial': 'Atención directa en oficina', 'Teléfono': 'Llamada telefónica', 'WhatsApp': 'Redes sociales oficiales', 'Web': 'Redes sociales oficiales' };

  function newData() {
    return {
      gestiones: [],
      eventos: [],
      config: {
        schema: SCHEMA,
        nextId: 1,
        nextEventoId: 1,
        autoLockMin: 5,
        lastBackup: null,
        catalogos: { dependencias: [...DEPENDENCIAS], responsables: [], medios: [...MEDIOS], fuentes: [...FUENTES], tipos: [...TIPOS], municipios: [...MUNICIPIOS] }
      }
    };
  }

  // ================= Estado =================
  let data = null;
  let lastActivity = Date.now();
  let hiddenAt = null;
  let failedAttempts = 0;
  let blockedUntil = 0;
  const ui = {
    section: 'dashboard',
    editingGestion: null,
    editingEvento: null,
    eventoLinks: new Set(),
    mapSelected: null,
    cal: (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })(),
    selectedDay: null,
    donuts: {},
    carry: null
  };
  const cartoCache = {};

  // ================= Utilidades =================
  const $ = id => document.getElementById(id);
  const esc = v => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date()); // fecha local (no UTC)
  const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  const longDate = s => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
  const dash = v => (v === null || v === undefined || v === '') ? '—' : v;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const isVencida = g => !!g.fechaLimite && g.fechaLimite < today() && !CERRADOS.includes(g.estatus);
  const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }

  function confirmBox(text, okLabel = 'Aceptar', danger = false) {
    return new Promise(resolve => {
      $('confirmText').textContent = text;
      const yes = $('confirmYes');
      yes.textContent = okLabel;
      yes.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      openModal('confirmModal');
      const done = v => { closeModal('confirmModal'); yes.onclick = null; $('confirmNo').onclick = null; resolve(v); };
      yes.onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
    });
  }

  function passwordBox(text) {
    return new Promise(resolve => {
      $('confirmText').innerHTML = `${esc(text)}<input type="password" class="input" id="pwBoxInput" style="margin-top:12px" autocomplete="off">`;
      const yes = $('confirmYes');
      yes.textContent = 'Continuar';
      yes.className = 'btn btn-primary';
      openModal('confirmModal');
      setTimeout(() => $('pwBoxInput').focus(), 50);
      const done = v => { closeModal('confirmModal'); yes.onclick = null; $('confirmNo').onclick = null; resolve(v); };
      yes.onclick = () => done($('pwBoxInput').value);
      $('confirmNo').onclick = () => done(null);
    });
  }

  function openModal(id) { $(id).classList.add('open'); $(id).setAttribute('aria-hidden', 'false'); }
  function closeModal(id) { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden', 'true'); }

  async function persist() {
    try { await Vault.save(data); }
    catch (e) { toast('No se pudo guardar. Revisa el espacio del iPad.', 4000); console.error(e); }
  }

  async function deliverFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
    return true;
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  // Opciones de catálogo + valores ya usados que no estén en el catálogo
  function catalogOptions(name, field) {
    const base = data.config.catalogos[name] || [];
    const baseN = new Set(base.map(norm));
    const extra = [];
    if (field) data.gestiones.forEach(g => {
      const v = (g[field] || '').trim();
      if (v && !baseN.has(norm(v))) { baseN.add(norm(v)); extra.push(v); }
    });
    return [...base, ...extra.sort((a, b) => a.localeCompare(b, 'es'))];
  }
  function fillSelect(sel, options, { all, placeholder, value, extraFirst } = {}) {
    const cur = value !== undefined ? value : sel.value;
    let html = '';
    if (all) html += `<option value="">${esc(all)}</option>`;
    if (extraFirst) html += extraFirst.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    if (placeholder !== undefined) html += `<option value="">${esc(placeholder)}</option>`;
    const opts = [...options];
    const has = v => opts.some(o => (o.id || o) === v) || (extraFirst || []).some(o => o.id === v);
    if (cur && !has(cur)) opts.push(cur);
    html += opts.map(o => { const v = o.id || o, l = o.label || o; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join('');
    sel.innerHTML = html;
    sel.value = cur || '';
  }
  function uniqueBy(field, normFn = norm) {
    const map = new Map();
    data.gestiones.forEach(g => {
      const v = (g[field] || '').trim();
      if (!v) return;
      const k = normFn(v);
      if (!map.has(k)) map.set(k, v);
    });
    return map; // clave normalizada → etiqueta
  }
  const uniqueColonias = () => [...uniqueBy('colonia', MapaGeo.normColonia).values()].sort((a, b) => a.localeCompare(b, 'es'));

  // Responsables: catálogo + los escritos en gestiones (agrupados sin importar mayúsculas/acentos)
  function responsablesMap() {
    const map = new Map();
    (data.config.catalogos.responsables || []).forEach(r => { if (r.trim()) map.set(norm(r), r.trim()); });
    uniqueBy('responsable').forEach((v, k) => { if (!map.has(k)) map.set(k, v); });
    return map;
  }

  // ================= Preferencias visibles (sin datos sensibles) =================
  function getPrefs() {
    try { return Object.assign({ nombre: DEFAULT_NAME, tema: 'azul' }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); }
    catch (e) { return { nombre: DEFAULT_NAME, tema: 'azul' }; }
  }
  function setPrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); applyPrefs(); }
  function applyPrefs() {
    const p = getPrefs();
    const name = (p.nombre || '').trim() || DEFAULT_NAME;
    document.documentElement.dataset.theme = p.tema;
    document.querySelectorAll('[data-system-name]').forEach(el => { el.textContent = name; });
    document.title = name;
    const th = THEMES.find(t => t.id === p.tema) || THEMES[0];
    document.querySelector('meta[name="theme-color"]').setAttribute('content', th.color);
  }

  // ================= Bloqueo / acceso =================
  function showLock(mode) {
    $('lockScreen').classList.remove('hidden');
    $('app').classList.add('hidden');
    ['setupForm', 'restoreForm', 'unlockForm'].forEach(f => $(f).classList.add('hidden'));
    $(mode).classList.remove('hidden');
    $('lockError').textContent = '';
    const bio = mode === 'unlockForm' && Vault.bioEnabled();
    $('bioBtn').classList.toggle('hidden', !bio);
    $('bioOr').classList.toggle('hidden', !bio);
    if (!bio) { const first = $(mode).querySelector('input'); if (first) setTimeout(() => first.focus(), 100); }
  }

  function enterApp() {
    $('lockScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    ['setupPass', 'setupPass2', 'unlockPass', 'restorePass'].forEach(id => { $(id).value = ''; });
    lastActivity = Date.now();
    const migrated = migrate();
    if (migrated) persist();
    switchSection('dashboard');
    checkBackupReminder();
  }

  function lockNow() {
    Vault.lock();
    data = null;
    location.reload(); // borra de la memoria todo lo descifrado
  }

  function migrate() {
    const def = newData();
    data.gestiones = data.gestiones || [];
    data.eventos = data.eventos || [];
    data.config = Object.assign(def.config, data.config || {}, { schema: (data.config && data.config.schema) || 1 });
    const cat = data.config.catalogos = Object.assign({}, def.config.catalogos, data.config.catalogos || {});
    if (data.config.schema >= SCHEMA) return false;
    // Esquema 1 → 2
    const extraDeps = (cat.dependencias || []).filter(d => !OLD_DEPENDENCIAS.includes(d) && !DEPENDENCIAS.includes(d));
    cat.dependencias = [...DEPENDENCIAS, ...extraDeps];
    const oldFuentes = cat.fuentes || [];
    cat.medios = cat.medios && cat.medios.length ? cat.medios : [...MEDIOS];
    cat.fuentes = [...FUENTES, ...oldFuentes.filter(f => !(f in OLD_FUENTE_A_MEDIO) && !FUENTES.includes(f))];
    cat.responsables = cat.responsables || [];
    data.gestiones.forEach(g => {
      if (g.estatus === 'revision') g.estatus = 'curso';
      if (!ESTATUS_LABEL[g.estatus]) g.estatus = 'capturado';
      if (g.fuente && OLD_FUENTE_A_MEDIO[g.fuente]) { g.medio = OLD_FUENTE_A_MEDIO[g.fuente]; g.fuente = ''; }
    });
    data.config.schema = SCHEMA;
    return true;
  }

  async function handleSetup(e) {
    e.preventDefault();
    const p1 = $('setupPass').value, p2 = $('setupPass2').value;
    if (p1.length < 8) return ($('lockError').textContent = 'La contraseña debe tener al menos 8 caracteres.');
    if (p1 !== p2) return ($('lockError').textContent = 'Las contraseñas no coinciden.');
    $('lockError').textContent = 'Cifrando…';
    data = newData();
    await Vault.create(p1, data);
    enterApp();
    toast('Listo. Tus datos quedan cifrados en este iPad. Puedes activar la huella en Configuración.', 4500);
  }

  async function handleUnlock(e) {
    e.preventDefault();
    if (Date.now() < blockedUntil) {
      $('lockError').textContent = `Demasiados intentos. Espera ${Math.ceil((blockedUntil - Date.now()) / 1000)} segundos.`;
      return;
    }
    $('lockError').textContent = 'Verificando…';
    try {
      data = await Vault.unlock($('unlockPass').value);
      failedAttempts = 0;
      enterApp();
    } catch (err) {
      failedAttempts++;
      $('unlockPass').value = '';
      if (failedAttempts >= 5) {
        blockedUntil = Date.now() + 30000;
        failedAttempts = 0;
        $('lockError').textContent = 'Demasiados intentos. Espera 30 segundos.';
      } else {
        $('lockError').textContent = err.message === 'contrasena' ? 'Contraseña incorrecta.' : 'No se pudieron leer los datos.';
      }
    }
  }

  async function handleBioUnlock() {
    $('lockError').textContent = '';
    try {
      data = await Vault.unlockBio();
      enterApp();
    } catch (err) {
      $('lockError').textContent = err.name === 'NotAllowedError'
        ? 'No se confirmó la huella. Inténtalo otra vez o usa tu contraseña.'
        : 'No se pudo entrar con la huella. Usa tu contraseña.';
    }
  }

  async function handleRestore(e) {
    e.preventDefault();
    const file = $('restoreFile').files[0];
    const pass = $('restorePass').value;
    if (!file) return ($('lockError').textContent = 'Elige el archivo de respaldo.');
    $('lockError').textContent = 'Descifrando respaldo…';
    try {
      data = await Vault.readBackup(await readFileText(file), pass);
      migrate();
      await Vault.create(pass, data);
      enterApp();
      toast('Respaldo restaurado. Tu contraseña es la del respaldo.', 4000);
    } catch (err) {
      $('lockError').textContent = err.message === 'contrasena' ? 'La contraseña no corresponde a ese respaldo.' : 'Ese archivo no es un respaldo válido.';
    }
  }

  function setupAutoLock() {
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
    setInterval(() => {
      if (!Vault.isOpen() || !data) return;
      const mins = Number(data.config.autoLockMin) || 5;
      if (Date.now() - lastActivity > mins * 60000) lockNow();
    }, 10000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        document.body.classList.add('privacy'); // oculta el contenido en el selector de apps
      } else {
        document.body.classList.remove('privacy');
        if (Vault.isOpen() && hiddenAt && Date.now() - hiddenAt > LOCK_WHEN_HIDDEN_MS) lockNow();
        hiddenAt = null;
      }
    });
  }

  // ================= Navegación =================
  const TITLES = { dashboard: 'Inicio', gestiones: 'Gestiones Ciudadanas', mapa: 'Mapa de Calor', eventos: 'Eventos y Agenda', reportes: 'Reportes', config: 'Configuración' };
  const RENDER = () => ({ dashboard: renderDashboard, gestiones: renderGestiones, mapa: renderMapa, eventos: renderEventos, reportes: renderReportes, config: renderConfig });
  function switchSection(section) {
    ui.section = section;
    if (section !== 'config') applyPrefs(); // descarta la vista previa de tema no guardada
    document.querySelectorAll('#sidebarMenu li').forEach(li => li.classList.toggle('active', li.dataset.section === section));
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === section));
    $('pageTitle').textContent = TITLES[section];
    closeSidebar();
    window.scrollTo(0, 0);
    refreshDatalists();
    RENDER()[section]();
  }
  function refreshCurrent() { refreshDatalists(); RENDER()[ui.section](); }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarBackdrop').classList.remove('open'); }

  function refreshDatalists() {
    const opts = arr => arr.map(c => `<option value="${esc(c)}">`).join('');
    $('coloniasList').innerHTML = opts(uniqueColonias());
    $('seccionesList').innerHTML = opts([...new Set(data.gestiones.map(g => g.seccion).filter(Boolean))].sort((a, b) => Number(a) - Number(b)));
    $('responsablesList').innerHTML = opts([...responsablesMap().values()]);
    $('tiposList').innerHTML = opts(catalogOptions('tipos', 'tipo'));
    $('municipiosList').innerHTML = opts(catalogOptions('municipios', 'municipio'));
  }

  // ================= Inicio =================
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const estColor = id => cssVar('--st-' + id);

  function respGroups(list) {
    const names = responsablesMap();
    const groups = new Map();
    list.forEach(g => {
      const k = norm(g.responsable) || '~';
      const grp = groups.get(k) || { key: k, label: k === '~' ? 'Sin asignar' : (names.get(k) || g.responsable), total: 0, vencidas: 0, est: {} };
      grp.total++;
      if (isVencida(g)) grp.vencidas++;
      grp.est[g.estatus] = (grp.est[g.estatus] || 0) + 1;
      groups.set(k, grp);
    });
    const arr = [...groups.values()].sort((a, b) => (a.key === '~') - (b.key === '~') || b.total - a.total);
    let ci = 0;
    arr.forEach(gp => { gp.color = gp.key === '~' ? GRAY : PALETTE[ci++ % PALETTE.length]; });
    return arr;
  }

  const D_IDS = ['dDesde', 'dHasta', 'dEstatus', 'dResponsable', 'dDependencia', 'dPrioridad', 'dMedio', 'dFuente', 'dColonia'];
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ease = t => 1 - Math.pow(1 - t, 3);
  const ANIM_MS = 650;

  function dashFilters() {
    return {
      desde: $('dDesde').value, hasta: $('dHasta').value, estatus: $('dEstatus').value, responsable: $('dResponsable').value,
      dependencia: $('dDependencia').value, prioridad: $('dPrioridad').value, medio: $('dMedio').value, fuente: $('dFuente').value,
      colonia: $('dColonia').value
    };
  }
  function setupDashFilters() {
    fillSelect($('dEstatus'), ESTATUS, { all: 'Todos los estados', extraFirst: ESTADO_FILTER_EXTRA });
    fillSelect($('dResponsable'), respOptions(), { all: 'Todos los responsables' });
    fillSelect($('dDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas las dependencias' });
    fillSelect($('dPrioridad'), PRIORIDADES, { all: 'Todas las prioridades' });
    fillSelect($('dMedio'), catalogOptions('medios', 'medio'), { all: 'Todos los medios' });
    fillSelect($('dFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas las fuentes' });
    const col = [...uniqueBy('colonia', MapaGeo.normColonia)].map(([k, v]) => ({ id: k, label: v })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    fillSelect($('dColonia'), col, { all: 'Todas las colonias' });
  }

  // Cambia un filtro del Inicio desde las gráficas (tocar otra vez lo quita)
  function toggleDash(id, value) {
    $(id).value = $(id).value === value ? '' : value;
    renderDashboard();
  }

  function animateNumber(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (REDUCED || from === to) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = now => {
      if (Number(el.dataset.v) !== to) return;
      const t = Math.min(1, (now - t0) / ANIM_MS);
      el.textContent = Math.round(from + (to - from) * ease(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderDashboard() {
    setupDashFilters();
    const df = dashFilters();
    const L = applyFilters(data.gestiones, df);
    // Cada gráfica ignora su propio filtro para poder resaltar la parte elegida
    const Lc = applyFilters(data.gestiones, Object.assign({}, df, { estatus: df.estatus === 'vencidas' ? 'vencidas' : '' }));
    const Lr = applyFilters(data.gestiones, Object.assign({}, df, { responsable: '' }));
    const activos = Object.values(df).filter(Boolean).length;
    $('dClear').classList.toggle('hidden', !activos);
    $('dSummary').textContent = activos
      ? `Mostrando ${L.length} de ${data.gestiones.length} gestiones con ${activos === 1 ? '1 filtro' : activos + ' filtros'}. Toca otra vez una parte de la gráfica para quitar su filtro.`
      : `Mostrando todas las gestiones (${data.gestiones.length}). Filtra aquí arriba o toca cualquier parte de las gráficas.`;

    // Tarjetas
    const Lk = applyFilters(data.gestiones, Object.assign({}, df, { estatus: '' }));
    const cards = [
      { key: '', label: 'Total de gestiones', n: Lk.length, sub: plural(Lk.filter(g => !CERRADOS.includes(g.estatus)).length, 'abierta'), c: 'var(--primary)' },
      { key: 'vencidas', label: 'Tareas vencidas', n: Lk.filter(isVencida).length, sub: 'Pasaron su fecha límite', c: 'var(--st-vencida)' },
      { key: 'curso', label: 'En curso', n: Lk.filter(g => g.estatus === 'curso').length, sub: plural(Lk.filter(g => g.estatus === 'curso' && isVencida(g)).length, 'vencida'), c: 'var(--st-curso)' },
      { key: 'detenido', label: 'Detenido', n: Lk.filter(g => g.estatus === 'detenido').length, sub: plural(Lk.filter(g => g.estatus === 'detenido' && isVencida(g)).length, 'vencida'), c: 'var(--st-detenido)' }
    ];
    const box = $('taskCards');
    if (!box.children.length) {
      box.innerHTML = cards.map(c => `<div class="card" style="--c:${c.c}" data-card="${c.key}"><div class="card-number" data-v="0">0</div><div class="card-title">${c.label}</div><div class="card-sub"></div></div>`).join('');
    }
    cards.forEach(c => {
      const el = box.querySelector(`[data-card="${c.key}"]`);
      animateNumber(el.querySelector('.card-number'), c.n);
      el.querySelector('.card-sub').textContent = c.sub;
      el.classList.toggle('selected', !!df.estatus && df.estatus === c.key);
    });

    // Dona por estado
    const estSlices = ESTATUS.map(e => ({ key: e.id, label: e.label, value: Lc.filter(g => g.estatus === e.id).length, color: estColor(e.id) }));
    drawDonut('donutEstado', 'legendEstado', estSlices, 'estado', df.estatus !== 'vencidas' ? df.estatus : '');

    // Dona y barras por responsable
    const rg = respGroups(Lr);
    const top = rg.filter(r => r.key !== '~').slice(0, 9);
    const rest = rg.filter(r => r.key !== '~').slice(9);
    const sin = rg.find(r => r.key === '~');
    const respSlices = top.map(r => ({ key: r.key, label: r.label, value: r.total, color: r.color }));
    if (rest.length) respSlices.push({ key: '__otros', label: `Otros (${rest.length})`, value: rest.reduce((s, r) => s + r.total, 0), color: '#cbd5e1' });
    if (sin) respSlices.push({ key: '~', label: 'Sin asignar', value: sin.total, color: GRAY });
    drawDonut('donutResp', 'legendResp', respSlices, 'responsable', df.responsable);

    $('barLegend').innerHTML = ESTATUS.map(e => `<span><i style="background:${estColor(e.id)}"></i>${e.label}</span>`).join('');
    renderRespBars(respGroups(applyFilters(data.gestiones, Object.assign({}, df, { responsable: '' }))), df.responsable);

    // Zonas con más gestiones
    const zonas = new Map();
    L.forEach(g => {
      if (!g.colonia) return;
      const k = MapaGeo.normColonia(g.colonia);
      const z = zonas.get(k) || { key: k, label: g.colonia, count: 0 };
      z.count++;
      zonas.set(k, z);
    });
    renderHotList([...zonas.values()].sort((a, b) => b.count - a.count).slice(0, 8));

    const hoy = today();
    const proximos = data.eventos.filter(ev => ev.fecha && ev.fecha >= hoy)
      .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || ''))).slice(0, 5);
    $('dashAgenda').innerHTML = proximos.length ? proximos.map(agendaItem).join('') : '<li class="agenda-empty">No hay eventos próximos.</li>';

    const sinUb = L.filter(g => !g.colonia && !g.seccion).length;
    const n = $('noLocationNotice');
    if (sinUb) {
      n.innerHTML = `<span>📍 ${sinUb} ${sinUb === 1 ? 'gestión no tiene' : 'gestiones no tienen'} colonia ni sección, así que no aparecen en el mapa.</span><button class="btn btn-outline btn-sm" data-action="ver-sin-ubicacion">Ver</button>`;
      n.classList.remove('hidden');
    } else n.classList.add('hidden');
  }

  // Barras que crecen o se encogen con animación (se reutilizan las filas)
  function renderRespBars(rg, selected) {
    const box = $('respBars');
    const empty = box.querySelector('.agenda-empty');
    if (!rg.length) { box.innerHTML = '<p class="agenda-empty">Sin gestiones con estos filtros.</p>'; return; }
    if (empty) empty.remove();
    const maxT = Math.max(1, ...rg.map(r => r.total));
    const existing = new Map([...box.querySelectorAll('.bar-row')].map(el => [el.dataset.resp, el]));
    rg.forEach(r => {
      let el = existing.get(r.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'bar-row';
        el.dataset.resp = r.key;
        el.innerHTML = `<span class="bar-name"></span><div class="bar-track" style="width:0%">${ESTATUS.map(e => `<div data-e="${e.id}" style="width:0%"></div>`).join('')}</div><span class="bar-total"></span>`;
      }
      existing.delete(r.key);
      box.appendChild(el);
      const nm = el.querySelector('.bar-name');
      nm.textContent = r.label; nm.title = r.label;
      el.classList.toggle('selected', selected === r.key);
      el.classList.toggle('faded', !!selected && selected !== r.key);
      el.querySelector('.bar-total').innerHTML = `${r.total}${r.vencidas ? `<small>${plural(r.vencidas, 'vencida')}</small>` : ''}`;
      void el.offsetWidth; // para que la transición arranque desde el valor anterior
      el.querySelector('.bar-track').style.width = `${Math.max(8, (r.total / maxT) * 100)}%`;
      ESTATUS.forEach(e => {
        const seg = el.querySelector(`[data-e="${e.id}"]`);
        seg.style.background = estColor(e.id);
        seg.style.width = `${((r.est[e.id] || 0) / r.total) * 100}%`;
        seg.title = `${e.label}: ${r.est[e.id] || 0}`;
      });
    });
    existing.forEach(el => el.remove());
  }

  function renderHotList(zt) {
    const box = $('hotList');
    if (!zt.length) { box.innerHTML = '<li class="agenda-empty" style="cursor:default">Sin gestiones con colonia para estos filtros.</li>'; return; }
    const empty = box.querySelector('.agenda-empty');
    if (empty) empty.remove();
    const zmax = zt[0].count;
    const existing = new Map([...box.querySelectorAll('li[data-colonia]')].map(el => [el.dataset.colonia, el]));
    zt.forEach(z => {
      let el = existing.get(z.key);
      if (!el) {
        el = document.createElement('li');
        el.dataset.colonia = z.key;
        el.innerHTML = '<span class="dot"></span><span class="hot-name"><span class="hot-label"></span><div class="hot-bar" style="width:0%"></div></span><span class="hot-count" data-v="0">0</span>';
      }
      existing.delete(z.key);
      box.appendChild(el);
      el.querySelector('.hot-label').textContent = z.label;
      void el.offsetWidth;
      el.querySelector('.hot-bar').style.width = `${Math.max(6, (z.count / zmax) * 100)}%`;
      animateNumber(el.querySelector('.hot-count'), z.count);
    });
    existing.forEach(el => el.remove());
  }

  // Dona animada: las partes giran y cambian de tamaño hacia los nuevos valores
  function drawDonut(canvasId, legendId, slices, kind, selected) {
    const st = ui.donuts[canvasId] || (ui.donuts[canvasId] = { prev: {}, colors: {}, token: 0 });
    const from = st.prev;
    const target = {};
    slices.forEach(s => { target[s.key] = s.value; st.colors[s.key] = s.color; });
    const all = [...slices];
    Object.keys(from).forEach(k => { if (!(k in target) && from[k]) all.push({ key: k, value: 0, color: st.colors[k] || GRAY }); });
    st.prev = target;
    const token = ++st.token;

    const canvas = $(canvasId);
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || 210;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2, cy = size / 2, R = size / 2 - 10, r = R * 0.6;
    const surface = cssVar('--surface'), surface2 = cssVar('--surface-2'), text = cssVar('--text'), muted = cssVar('--muted');

    const paint = p => {
      const vals = all.map(s => ({ s, v: (from[s.key] || 0) + ((target[s.key] || 0) - (from[s.key] || 0)) * p }));
      const total = vals.reduce((a, x) => a + x.v, 0);
      ctx.clearRect(0, 0, size, size);
      if (total < 0.001) {
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
        ctx.fillStyle = surface2; ctx.fill();
        ctx.fillStyle = muted; ctx.font = '14px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Sin datos', cx, cy);
        return [];
      }
      const hits = [];
      let a = -Math.PI / 2;
      vals.forEach(({ s, v }) => {
        if (v <= 0) return;
        const da = (v / total) * Math.PI * 2;
        const isSel = selected && s.key === selected;
        const off = isSel ? 7 * p : 0; // la parte elegida sale un poco
        const mid = a + da / 2;
        const ox = Math.cos(mid) * off, oy = Math.sin(mid) * off;
        ctx.globalAlpha = selected && !isSel ? 0.28 : 1;
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, R, a, a + da); ctx.arc(cx + ox, cy + oy, r, a + da, a, true); ctx.closePath();
        ctx.fillStyle = s.color; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = surface; ctx.lineWidth = 2; ctx.stroke();
        hits.push({ key: s.key, a0: a, a1: a + da });
        a += da;
      });
      const center = selected ? (target[selected] || 0) : Math.round(total);
      ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 30px -apple-system, sans-serif'; ctx.fillText(String(Math.round(selected ? (from[selected] || 0) + (center - (from[selected] || 0)) * p : total)), cx, cy - 8);
      ctx.fillStyle = muted; ctx.font = '13px -apple-system, sans-serif'; ctx.fillText(selected ? 'seleccionadas' : 'gestiones', cx, cy + 16);
      return hits;
    };

    const finalize = () => { st.hits = paint(1); };
    if (REDUCED) finalize();
    else {
      const t0 = performance.now();
      const step = now => {
        if (st.token !== token) return;
        const t = Math.min(1, (now - t0) / ANIM_MS);
        st.hits = paint(ease(t));
        if (t < 1) requestAnimationFrame(step);
      };
      st.hits = paint(0);
      requestAnimationFrame(step);
    }
    Object.assign(st, { cx, cy, R: R + 8, r, kind });

    const total = slices.reduce((s, x) => s + x.value, 0);
    $(legendId).innerHTML = slices.map(s => `
      <li data-${kind === 'estado' ? 'est' : 'resp'}="${esc(s.key)}" class="${selected === s.key ? 'selected' : ''}${selected && selected !== s.key ? ' faded' : ''}">
        <span class="sw" style="background:${s.color}"></span><span class="lb">${esc(s.label)}</span>
        <span class="ct">${s.value}</span><span class="pc">${total ? Math.round((s.value / total) * 100) : 0}%</span></li>`).join('');
  }

  function donutClick(canvasId, e) {
    const d = ui.donuts[canvasId];
    if (!d || !d.hits) return;
    const rect = $(canvasId).getBoundingClientRect();
    const x = e.clientX - rect.left - d.cx, y = e.clientY - rect.top - d.cy;
    const dist = Math.hypot(x, y);
    if (dist < d.r || dist > d.R) return;
    let ang = Math.atan2(y, x);
    if (ang < -Math.PI / 2) ang += Math.PI * 2;
    const h = d.hits.find(s => ang >= s.a0 && ang < s.a1);
    if (!h) return;
    if (d.kind === 'estado') toggleDash('dEstatus', h.key);
    else if (h.key !== '__otros') toggleDash('dResponsable', h.key);
  }

  function goGestiones(f) {
    // Lleva también los filtros que estén puestos en el Inicio
    const df = ui.section === 'dashboard' ? dashFilters() : {};
    setupGestionFilters();
    $('gFilterEstatus').value = f.estatus !== undefined ? f.estatus : (df.estatus || '');
    const resp = f.responsable && f.responsable !== '__otros' ? f.responsable : (df.responsable || '');
    $('gFilterResponsable').value = resp;
    $('gFilterDependencia').value = df.dependencia || '';
    $('gFilterPrioridad').value = df.prioridad || '';
    const carry = {};
    ['desde', 'hasta', 'medio', 'fuente', 'colonia'].forEach(k => { if (df[k]) carry[k] = df[k]; });
    ui.carry = Object.keys(carry).length ? carry : null;
    $('gFilterSinUbicacion').checked = !!f.sinUbicacion;
    $('gSearch').value = '';
    switchSection('gestiones');
  }

  function agendaItem(ev) {
    const n = (ev.gestiones || []).length;
    return `<li data-evento="${ev.id}">
      <div class="ag-date">${esc(longDate(ev.fecha))}${ev.hora ? ' · ' + esc(ev.hora) : ''}</div>
      <div class="ag-title">${esc(ev.titulo || 'Evento sin título')}</div>
      <div class="ag-meta">${[ev.colonia, ev.lugar].filter(Boolean).map(esc).join(' · ')}${n ? ` · ${n} ${n === 1 ? 'gestión vinculada' : 'gestiones vinculadas'}` : ''}</div>
    </li>`;
  }

  // ================= Filtros compartidos =================
  const ESTADO_FILTER_EXTRA = [{ id: 'vencidas', label: '⚠ Vencidas' }];
  function applyFilters(list, f) {
    return list.filter(g => {
      if (f.estatus === 'vencidas') { if (!isVencida(g)) return false; }
      else if (f.estatus && g.estatus !== f.estatus) return false;
      if (f.responsable && (norm(g.responsable) || '~') !== f.responsable) return false;
      if (f.prioridad && g.prioridad !== f.prioridad) return false;
      if (f.medio && g.medio !== f.medio) return false;
      if (f.fuente && g.fuente !== f.fuente) return false;
      if (f.dependencia && g.dependencia !== f.dependencia) return false;
      if (f.municipio && norm(g.municipio) !== f.municipio) return false;
      if (f.colonia && MapaGeo.normColonia(g.colonia) !== f.colonia) return false;
      if (f.desde && (g.fechaIngreso || '') < f.desde) return false;
      if (f.hasta && (g.fechaIngreso || '') > f.hasta) return false;
      return true;
    });
  }
  function respOptions() {
    const opts = [...responsablesMap()].map(([k, v]) => ({ id: k, label: v })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    opts.push({ id: '~', label: 'Sin asignar' });
    return opts;
  }

  // ================= Gestiones =================
  function setupGestionFilters() {
    fillSelect($('gFilterEstatus'), ESTATUS, { all: 'Todos los estados', extraFirst: ESTADO_FILTER_EXTRA });
    fillSelect($('gFilterResponsable'), respOptions(), { all: 'Todos los responsables' });
    fillSelect($('gFilterDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas las dependencias' });
    fillSelect($('gFilterPrioridad'), PRIORIDADES, { all: 'Todas las prioridades' });
  }

  function prioridadBadge(p) { return p ? `<span class="badge pr-${esc(p)}">${esc(PRIORIDAD_LABEL[p] || p)}</span>` : '—'; }
  function fechasCell(g) {
    const lim = g.fechaLimite ? `<br><span class="muted">Límite ${fmtDate(g.fechaLimite)}</span>` : '';
    return `${fmtDate(g.fechaIngreso)}${lim}`;
  }
  function estadoCell(g) {
    return `<select class="status-select st-${esc(g.estatus)}" data-status-id="${g.id}" aria-label="Estado de la gestión ${g.id}">
      ${ESTATUS.map(e => `<option value="${e.id}"${e.id === g.estatus ? ' selected' : ''}>${e.label}</option>`).join('')}
    </select>${isVencida(g) ? '<span class="badge badge-vencida">Vencida</span>' : ''}`;
  }

  function renderGestiones() {
    setupGestionFilters();
    const q = norm($('gSearch').value);
    const f = { estatus: $('gFilterEstatus').value, responsable: $('gFilterResponsable').value, dependencia: $('gFilterDependencia').value, prioridad: $('gFilterPrioridad').value };
    const sinUb = $('gFilterSinUbicacion').checked;
    if (ui.carry) Object.assign(f, ui.carry);
    const cb = $('gCarry');
    if (ui.carry) {
      const c = ui.carry, parts = [];
      if (c.desde || c.hasta) parts.push(`Ingreso ${c.desde ? fmtDate(c.desde) : '…'} a ${c.hasta ? fmtDate(c.hasta) : '…'}`);
      if (c.medio) parts.push('Medio: ' + c.medio);
      if (c.fuente) parts.push('Fuente: ' + c.fuente);
      if (c.colonia) parts.push('Colonia: ' + (uniqueBy('colonia', MapaGeo.normColonia).get(c.colonia) || c.colonia));
      cb.innerHTML = `<span>Filtros del Inicio: ${esc(parts.join(' · '))}</span><button class="btn btn-outline btn-sm" data-action="clear-carry">✕ Quitar</button>`;
      cb.classList.remove('hidden');
    } else cb.classList.add('hidden');
    const list = applyFilters(data.gestiones, f).filter(g => {
      if (sinUb && (g.colonia || g.seccion)) return false;
      if (q) {
        const hay = norm([g.id, '#' + g.id, g.solicitante, g.curp, g.telefono, g.responsable, g.colonia, g.seccion, g.municipio, g.dependencia, g.tipo, g.medio, g.fuente, g.descripcion, g.observaciones].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.id - a.id);

    $('gTableBody').innerHTML = list.length ? list.map(g => `
      <tr data-id="${g.id}">
        <td class="folio">#${g.id}</td>
        <td>${esc(dash(g.solicitante))}${g.tipo ? `<br><span class="muted">${esc(g.tipo)}</span>` : ''}</td>
        <td>${esc(dash(g.responsable))}</td>
        <td>${esc(dash(g.dependencia))}</td>
        <td>${prioridadBadge(g.prioridad)}</td>
        <td>${esc(dash(g.colonia))}${g.seccion ? `<br><span class="muted">Secc. ${esc(g.seccion)}</span>` : ''}</td>
        <td data-estado-cell>${estadoCell(g)}</td>
        <td class="nowrap">${fechasCell(g)}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="empty">${data.gestiones.length ? 'Ninguna gestión coincide con los filtros.' : 'Aún no hay gestiones. Toca “Nueva gestión” para capturar la primera.'}</td></tr>`;
    $('gCount').textContent = `${list.length} de ${data.gestiones.length} gestiones`;
  }

  async function changeStatus(id, estatus, selectEl) {
    const g = data.gestiones.find(x => x.id === id);
    if (!g) return;
    g.estatus = estatus;
    g.fechaActualizacion = today();
    await persist();
    const cell = selectEl && selectEl.closest('[data-estado-cell]');
    if (cell) cell.innerHTML = estadoCell(g);
    toast(`Folio #${id}: ${ESTATUS_LABEL[estatus]}`);
  }

  async function deleteGestion(id) {
    const ok = await confirmBox(`¿Eliminar la gestión #${id}? Esta acción no se puede deshacer.`, 'Eliminar', true);
    if (!ok) return;
    closeModal('gestionModal');
    ui.editingGestion = null;
    data.gestiones = data.gestiones.filter(g => g.id !== id);
    data.eventos.forEach(ev => { ev.gestiones = (ev.gestiones || []).filter(x => x !== id); });
    await persist();
    refreshCurrent();
    toast(`Gestión #${id} eliminada`);
  }

  function checkCurp() {
    const v = $('fCurp').value.toUpperCase().replace(/\s/g, '');
    $('fCurp').value = v;
    $('curpHint').textContent = v && !CURP_RE.test(v) ? (v.length < 18 ? `Faltan ${18 - v.length} caracteres.` : 'Revisa la CURP, el formato no parece correcto.') : '';
  }

  function openGestionModal(g = null, preset = {}) {
    ui.editingGestion = g;
    const src = g || Object.assign({ estatus: 'capturado', municipio: (data.config.catalogos.municipios || [])[0] || '', fechaIngreso: today() }, preset);
    fillSelect($('fMedio'), catalogOptions('medios', 'medio'), { placeholder: 'Sin especificar', value: src.medio || '' });
    fillSelect($('fPrioridad'), PRIORIDADES, { placeholder: 'Sin especificar', value: src.prioridad || '' });
    fillSelect($('fDependencia'), catalogOptions('dependencias', 'dependencia'), { placeholder: 'Sin especificar', value: src.dependencia || '' });
    fillSelect($('fFuente'), catalogOptions('fuentes', 'fuente'), { placeholder: 'Sin especificar', value: src.fuente || '' });
    fillSelect($('fEstatus'), ESTATUS, { value: src.estatus || 'capturado' });
    const set = (id, v) => { $(id).value = v || ''; };
    set('fResponsable', src.responsable); set('fSolicitante', src.solicitante); set('fCurp', src.curp);
    set('fColonia', src.colonia); set('fSeccion', src.seccion); set('fMunicipio', src.municipio); set('fTelefono', src.telefono);
    set('fTipo', src.tipo); set('fMonto', src.monto || ''); set('fDescripcion', src.descripcion);
    set('fPrimerContacto', src.primerContacto); set('fFechaLimite', src.fechaLimite); set('fObservaciones', src.observaciones);
    $('fFechaIngreso').value = src.fechaIngreso || today();
    $('fFechaAct').value = g ? fmtDate(g.fechaActualizacion) : 'Se asigna al guardar';
    checkCurp();
    $('gModalTitle').textContent = g ? `Gestión #${g.id}` : `Nueva gestión · Folio #${data.config.nextId}`;
    $('gScheduleBtn').classList.toggle('hidden', !g);
    $('gDeleteBtn').classList.toggle('hidden', !g);

    const linked = g ? data.eventos.filter(ev => (ev.gestiones || []).includes(g.id)) : [];
    const box = $('gLinkedEvents');
    if (linked.length) {
      box.innerHTML = '<h4>Eventos vinculados</h4>' + linked.map(ev => `<span class="chip" data-evento="${ev.id}">📅 ${esc(fmtDate(ev.fecha))} · ${esc(ev.titulo || 'Evento')}</span>`).join('');
      box.classList.remove('hidden');
    } else box.classList.add('hidden');
    openModal('gestionModal');
    $('gestionModal').scrollTop = 0;
  }

  async function saveGestion(e) {
    e.preventDefault();
    const v = id => $(id).value.trim();
    const montoRaw = $('fMonto').value;
    const form = {
      responsable: v('fResponsable'), solicitante: v('fSolicitante'), curp: v('fCurp').toUpperCase(),
      colonia: v('fColonia'), seccion: v('fSeccion'), municipio: v('fMunicipio'), telefono: v('fTelefono'),
      medio: $('fMedio').value, fechaIngreso: $('fFechaIngreso').value || today(),
      tipo: v('fTipo'), monto: montoRaw === '' ? 0 : Math.max(0, parseFloat(montoRaw) || 0), descripcion: v('fDescripcion'),
      prioridad: $('fPrioridad').value, dependencia: $('fDependencia').value, fuente: $('fFuente').value,
      primerContacto: $('fPrimerContacto').value, estatus: $('fEstatus').value || 'capturado',
      fechaLimite: $('fFechaLimite').value, observaciones: v('fObservaciones')
    };
    // Unifica cómo se escribe el responsable (mismo nombre que en el catálogo)
    const rn = responsablesMap().get(norm(form.responsable));
    if (rn) form.responsable = rn;
    const llenos = ['responsable', 'solicitante', 'curp', 'colonia', 'seccion', 'telefono', 'medio', 'tipo', 'monto', 'descripcion', 'prioridad', 'dependencia', 'fuente', 'primerContacto', 'fechaLimite', 'observaciones'].some(k => form[k]);
    if (!llenos && !ui.editingGestion) {
      const ok = await confirmBox('No llenaste ningún dato. ¿Guardar la gestión vacía de todos modos?', 'Guardar vacía');
      if (!ok) return;
    }
    form.fechaActualizacion = today();
    let id;
    if (ui.editingGestion) { Object.assign(ui.editingGestion, form); id = ui.editingGestion.id; }
    else { id = data.config.nextId++; data.gestiones.push(Object.assign({ id }, form)); }
    await persist();
    closeModal('gestionModal');
    ui.editingGestion = null;
    refreshCurrent();
    toast(`Gestión #${id} guardada`);
  }

  // ================= Mapa =================
  function mapFilters() {
    return {
      estatus: $('mEstatus').value, responsable: $('mResponsable').value, dependencia: $('mDependencia').value,
      medio: $('mMedio').value, fuente: $('mFuente').value, desde: $('mDesde').value, hasta: $('mHasta').value
    };
  }
  function mapGroups(view, list) {
    const groups = {};
    list.forEach(g => {
      const key = view === 'seccion' ? MapaGeo.normSeccion(g.seccion) : MapaGeo.normColonia(g.colonia);
      if (!key) return;
      const grp = groups[key] || (groups[key] = { key, label: view === 'seccion' ? 'Sección ' + key : g.colonia, total: 0, items: [] });
      grp.total++;
      grp.items.push(g);
    });
    return groups;
  }
  async function getCarto(view) {
    if (!(view in cartoCache)) cartoCache[view] = await MapaGeo.store.get(view);
    return cartoCache[view];
  }

  async function renderMapa() {
    fillSelect($('mEstatus'), ESTATUS, { all: 'Todos los estados', extraFirst: ESTADO_FILTER_EXTRA });
    fillSelect($('mResponsable'), respOptions(), { all: 'Todos los responsables' });
    fillSelect($('mDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas las dependencias' });
    fillSelect($('mMedio'), catalogOptions('medios', 'medio'), { all: 'Todos los medios' });
    fillSelect($('mFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas las fuentes' });
    const view = $('mView').value;
    const groups = mapGroups(view, applyFilters(data.gestiones, mapFilters()));
    const area = $('mapArea');
    const geo = await getCarto(view);
    const onSelect = key => { ui.mapSelected = key; showMapDetail(groups[key], view, key); };
    if (geo) {
      const r = MapaGeo.renderChoropleth(area, geo, view, groups, { selected: ui.mapSelected, onSelect });
      $('mapLegend').innerHTML = `<span>Menos</span><span class="legend-bar"></span><span>Más gestiones</span>` +
        (r.unmatched ? `<span>· ${r.unmatched} ${r.unmatched === 1 ? 'zona con gestiones no aparece' : 'zonas con gestiones no aparecen'} en la cartografía (revisa cómo está escrita).</span>` : '');
    } else {
      const items = Object.values(groups).map(gp => ({ key: gp.key, label: gp.label, count: gp.total })).sort((a, b) => b.count - a.count);
      MapaGeo.renderGrid(area, items, {
        esc, selected: ui.mapSelected, onSelect,
        message: `Vista de calor por ${view === 'seccion' ? 'sección' : 'colonia'}. Para ver el mapa con contornos, carga la cartografía de ${view === 'seccion' ? 'secciones' : 'colonias'} en Configuración.`
      });
      $('mapLegend').innerHTML = '<span>Menos</span><span class="legend-bar"></span><span>Más gestiones</span>';
    }
    if (ui.mapSelected) showMapDetail(groups[ui.mapSelected] || null, view, ui.mapSelected);
    else $('mapDetail').innerHTML = '<p class="muted">Toca una zona del mapa para ver sus gestiones.</p>';
  }

  function countBy(items, getter) {
    const m = {};
    items.forEach(g => { const k = getter(g) || 'Sin especificar'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('');
  }

  function showMapDetail(grp, view, key) {
    const box = $('mapDetail');
    if (!grp) {
      box.innerHTML = `<h4>${view === 'seccion' ? 'Sección ' + esc(key) : 'Zona seleccionada'}</h4><p class="muted">Sin gestiones con estos filtros.</p>`;
      return;
    }
    const venc = grp.items.filter(isVencida).length;
    box.innerHTML = `
      <h4>${esc(grp.label)}</h4>
      <div class="stat"><span>Gestiones</span><strong>${grp.total}</strong></div>
      <div class="stat"><span>Vencidas</span><strong>${venc}</strong></div>
      <div class="stat"><span>Monto estimado</span><strong>${money(grp.items.reduce((s, g) => s + (Number(g.monto) || 0), 0))}</strong></div>
      <h5>Por estado</h5>${countBy(grp.items, g => ESTATUS_LABEL[g.estatus])}
      <h5>Por responsable</h5>${countBy(grp.items, g => g.responsable || 'Sin asignar')}
      <h5>Por dependencia</h5>${countBy(grp.items, g => g.dependencia)}
      <h5>Por medio de recepción</h5>${countBy(grp.items, g => g.medio)}
      <h5>Gestiones</h5>
      <ul class="mini-list">${grp.items.sort((a, b) => b.id - a.id).map(g => `<li data-open-gestion="${g.id}"><strong>#${g.id}</strong> ${esc(dash(g.solicitante))}<br><span class="muted">${esc(ESTATUS_LABEL[g.estatus] || '')}${isVencida(g) ? ' · Vencida' : ''}${g.responsable ? ' · ' + esc(g.responsable) : ''}</span></li>`).join('')}</ul>
      <div class="actions" style="margin-top:12px">
        ${view === 'colonia' ? `<button class="btn btn-outline btn-sm" data-report-colonia="${esc(key)}">Ver reporte</button>
        <button class="btn btn-outline btn-sm" data-event-colonia="${esc(grp.label)}">Agendar evento aquí</button>` : ''}
      </div>`;
  }

  function goToMapColonia(key) {
    $('mView').value = 'colonia';
    ui.mapSelected = key;
    switchSection('mapa');
  }

  // ================= Eventos =================
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function renderEventos() {
    const { y, m } = ui.cal;
    $('calTitle').textContent = `${MESES[m]} ${y}`;
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const hoy = today();
    const byDate = {};
    data.eventos.forEach(ev => { if (ev.fecha) (byDate[ev.fecha] = byDate[ev.fecha] || []).push(ev); });
    Object.values(byDate).forEach(arr => arr.sort((a, b) => (a.hora || '').localeCompare(b.hora || '')));
    let html = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = ymd(d);
      const evs = byDate[key] || [];
      const cls = ['cal-day', d.getMonth() !== m ? 'other' : '', key === hoy ? 'today' : '', key === ui.selectedDay ? 'selected' : ''].join(' ');
      html += `<div class="${cls}" data-day="${key}"><div class="cal-num">${d.getDate()}</div>
        ${evs.slice(0, 2).map(ev => `<div class="cal-ev">${ev.hora ? esc(ev.hora) + ' ' : ''}${esc(ev.titulo || 'Evento')}</div>`).join('')}
        ${evs.length > 2 ? `<div class="cal-more">+${evs.length - 2} más</div>` : ''}</div>`;
    }
    $('calGrid').innerHTML = html;
    renderDayPanel();
  }

  function renderDayPanel() {
    if (ui.selectedDay) {
      const evs = data.eventos.filter(ev => ev.fecha === ui.selectedDay).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
      $('dayTitle').textContent = longDate(ui.selectedDay);
      $('dayList').innerHTML = (evs.length ? evs.map(agendaItem).join('') : '<li class="agenda-empty">Sin eventos este día.</li>') +
        `<li style="border:none;cursor:default"><button class="btn btn-primary btn-sm" data-new-evento-day="${ui.selectedDay}">＋ Evento este día</button>
         <button class="btn btn-outline btn-sm" data-action="agenda-proximos">Ver próximos</button></li>`;
    } else {
      const hoy = today();
      const evs = data.eventos.filter(ev => ev.fecha && ev.fecha >= hoy)
        .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || ''))).slice(0, 15);
      $('dayTitle').textContent = 'Próximos eventos';
      $('dayList').innerHTML = evs.length ? evs.map(agendaItem).join('') : '<li class="agenda-empty">No hay eventos próximos. Toca un día del calendario para agendar.</li>';
    }
  }

  function openEventoModal(ev = null, preset = {}) {
    ui.editingEvento = ev;
    const src = ev || preset;
    $('eModalTitle').textContent = ev ? 'Editar evento' : 'Nuevo evento';
    $('eTitulo').value = src.titulo || '';
    $('eFecha').value = src.fecha || ui.selectedDay || today();
    $('eHora').value = src.hora || '';
    $('eColonia').value = src.colonia || '';
    $('eLugar').value = src.lugar || '';
    $('eDescripcion').value = src.descripcion || '';
    $('eLinkSearch').value = '';
    ui.eventoLinks = new Set(src.gestiones || []);
    $('eDeleteBtn').classList.toggle('hidden', !ev);
    renderLinkList();
    openModal('eventoModal');
  }

  function renderLinkList() {
    const q = norm($('eLinkSearch').value);
    const list = data.gestiones.filter(g => !q || norm([g.id, '#' + g.id, g.solicitante, g.responsable, g.colonia, g.dependencia, g.tipo].join(' ')).includes(q))
      .sort((a, b) => (ui.eventoLinks.has(b.id) - ui.eventoLinks.has(a.id)) || b.id - a.id);
    $('eLinkList').innerHTML = list.length ? list.map(g => `
      <label><input type="checkbox" data-link="${g.id}"${ui.eventoLinks.has(g.id) ? ' checked' : ''}>
      <span><strong>#${g.id}</strong> ${esc(dash(g.solicitante))} <span class="muted">· ${esc(dash(g.colonia))}${g.dependencia ? ' · ' + esc(g.dependencia) : ''}</span></span></label>`).join('')
      : '<p class="muted" style="padding:12px">No hay gestiones para vincular.</p>';
  }

  async function saveEvento(e) {
    e.preventDefault();
    const form = {
      titulo: $('eTitulo').value.trim(), fecha: $('eFecha').value || today(), hora: $('eHora').value,
      colonia: $('eColonia').value.trim(), lugar: $('eLugar').value.trim(), descripcion: $('eDescripcion').value.trim(),
      gestiones: [...ui.eventoLinks]
    };
    if (ui.editingEvento) Object.assign(ui.editingEvento, form);
    else data.eventos.push(Object.assign({ id: data.config.nextEventoId++ }, form));
    await persist();
    closeModal('eventoModal');
    ui.editingEvento = null;
    const [y, m] = form.fecha.split('-').map(Number);
    if (ui.section === 'eventos') { ui.cal = { y, m: m - 1 }; ui.selectedDay = form.fecha; }
    refreshCurrent();
    toast('Evento guardado');
  }

  async function deleteEvento() {
    const ev = ui.editingEvento;
    if (!ev) return;
    if (!(await confirmBox('¿Eliminar este evento?', 'Eliminar', true))) return;
    data.eventos = data.eventos.filter(x => x.id !== ev.id);
    await persist();
    closeModal('eventoModal');
    ui.editingEvento = null;
    refreshCurrent();
    toast('Evento eliminado');
  }

  // ================= Reportes =================
  const R_IDS = ['rDesde', 'rHasta', 'rEstatus', 'rResponsable', 'rDependencia', 'rPrioridad', 'rMedio', 'rFuente', 'rColonia', 'rMunicipio'];
  function reportFilters() {
    return {
      desde: $('rDesde').value, hasta: $('rHasta').value, estatus: $('rEstatus').value, responsable: $('rResponsable').value,
      dependencia: $('rDependencia').value, prioridad: $('rPrioridad').value, medio: $('rMedio').value, fuente: $('rFuente').value,
      colonia: $('rColonia').value, municipio: $('rMunicipio').value
    };
  }
  function setupReportFilters() {
    fillSelect($('rEstatus'), ESTATUS, { all: 'Todos', extraFirst: ESTADO_FILTER_EXTRA });
    fillSelect($('rResponsable'), respOptions(), { all: 'Todos' });
    fillSelect($('rDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas' });
    fillSelect($('rPrioridad'), PRIORIDADES, { all: 'Todas' });
    fillSelect($('rMedio'), catalogOptions('medios', 'medio'), { all: 'Todos' });
    fillSelect($('rFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas' });
    const col = [...uniqueBy('colonia', MapaGeo.normColonia)].map(([k, v]) => ({ id: k, label: v })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    fillSelect($('rColonia'), col, { all: 'Todas' });
    const mun = [...uniqueBy('municipio')].map(([k, v]) => ({ id: k, label: v })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    fillSelect($('rMunicipio'), mun, { all: 'Todos' });
  }

  const GROUP_LABEL = { estatus: 'Estado', responsable: 'Responsable', dependencia: 'Dependencia', prioridad: 'Prioridad', colonia: 'Colonia', seccion: 'Sección', medio: 'Medio de recepción', fuente: 'Fuente de ingreso', tipo: 'Tipo de apoyo', municipio: 'Municipio' };

  function reportData() {
    const list = applyFilters(data.gestiones, reportFilters()).sort((a, b) => a.id - b.id);
    const by = $('rGroup').value;
    const groups = new Map();
    list.forEach(g => {
      let k, label;
      if (by === 'colonia') { k = MapaGeo.normColonia(g.colonia); label = g.colonia; }
      else if (by === 'estatus') { k = g.estatus; label = ESTATUS_LABEL[g.estatus]; }
      else if (by === 'prioridad') { k = g.prioridad; label = PRIORIDAD_LABEL[g.prioridad]; }
      else { k = norm(g[by]); label = (g[by] || '').trim(); }
      if (!k) { k = '~'; label = by === 'responsable' ? 'Sin asignar' : 'Sin especificar'; }
      const grp = groups.get(k) || { label, total: 0, vencidas: 0, monto: 0, est: Object.fromEntries(ESTATUS.map(e => [e.id, 0])) };
      grp.total++;
      if (isVencida(g)) grp.vencidas++;
      grp.monto += Number(g.monto) || 0;
      grp.est[g.estatus] = (grp.est[g.estatus] || 0) + 1;
      groups.set(k, grp);
    });
    return { list, by, rows: [...groups.values()].sort((a, b) => b.total - a.total) };
  }

  function filtersDescription() {
    const f = reportFilters();
    const lbl = id => $(id).selectedOptions[0] ? $(id).selectedOptions[0].textContent.replace('⚠ ', '') : '';
    const parts = [];
    if (f.desde || f.hasta) parts.push(`Periodo: ${f.desde ? fmtDate(f.desde) : 'inicio'} a ${f.hasta ? fmtDate(f.hasta) : 'hoy'}`);
    [['estatus', 'Estado', 'rEstatus'], ['responsable', 'Responsable', 'rResponsable'], ['dependencia', 'Dependencia', 'rDependencia'], ['prioridad', 'Prioridad', 'rPrioridad'],
      ['medio', 'Medio', 'rMedio'], ['fuente', 'Fuente', 'rFuente'], ['colonia', 'Colonia', 'rColonia'], ['municipio', 'Municipio', 'rMunicipio']]
      .forEach(([k, t, id]) => { if (f[k]) parts.push(`${t}: ${lbl(id)}`); });
    return parts.length ? parts.join(' · ') : 'Sin filtros (todas las gestiones)';
  }

  function summaryTableHtml(rows, by, total) {
    const tot = rows.reduce((a, r) => { a.total += r.total; a.vencidas += r.vencidas; a.monto += r.monto; ESTATUS.forEach(e => { a.est[e.id] += r.est[e.id]; }); return a; },
      { total: 0, vencidas: 0, monto: 0, est: Object.fromEntries(ESTATUS.map(e => [e.id, 0])) });
    const cells = r => `<td class="num">${r.total}</td><td class="num">${total ? Math.round((r.total / total) * 100) : 0}%</td>${ESTATUS.map(e => `<td class="num">${r.est[e.id]}</td>`).join('')}<td class="num">${r.vencidas}</td><td class="num">${money(r.monto)}</td>`;
    return `<thead><tr><th>${GROUP_LABEL[by]}</th><th class="num">Total</th><th class="num">%</th>${ESTATUS.map(e => `<th class="num">${e.label}</th>`).join('')}<th class="num">Vencidas</th><th class="num">Monto</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td>${esc(r.label)}</td>${cells(r)}</tr>`).join('') : `<tr><td colspan="${5 + ESTATUS.length}" class="empty">Sin resultados.</td></tr>`}
      ${rows.length ? `<tr class="total-row"><td>Total</td>${cells(tot)}</tr>` : ''}</tbody>`;
  }

  function renderReportes() {
    setupReportFilters();
    const { list, by, rows } = reportData();
    const monto = list.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    $('rSummaryTitle').textContent = `Resumen por ${GROUP_LABEL[by].toLowerCase()}`;
    $('rSummary').innerHTML = summaryTableHtml(rows, by, list.length);
    $('rDetailTitle').textContent = `Detalle: ${list.length} ${list.length === 1 ? 'gestión' : 'gestiones'} · ${money(monto)}`;
    $('rTableBody').innerHTML = list.length ? list.map(g => `<tr data-open-gestion="${g.id}" style="cursor:pointer">
      <td class="folio">#${g.id}</td><td>${esc(dash(g.solicitante))}</td><td>${esc(dash(g.responsable))}</td><td>${esc(dash(g.dependencia))}</td>
      <td>${prioridadBadge(g.prioridad)}</td><td>${esc(dash(g.colonia))}</td>
      <td><span class="badge st-${esc(g.estatus)}">${esc(ESTATUS_LABEL[g.estatus] || g.estatus)}</span>${isVencida(g) ? '<span class="badge badge-vencida">Vencida</span>' : ''}</td>
      <td class="nowrap">${fmtDate(g.fechaIngreso)}</td><td class="nowrap">${fmtDate(g.fechaLimite)}</td><td class="num">${g.monto ? money(g.monto) : '—'}</td></tr>`).join('')
      : '<tr><td colspan="10" class="empty">Sin resultados con estos filtros.</td></tr>';
  }

  async function exportExcel() {
    const { list, by, rows } = reportData();
    if (!list.length) return toast('No hay gestiones con estos filtros.');
    const sheets = [
      {
        name: 'Gestiones',
        columns: [
          { header: 'Folio', width: 8, type: 'number' }, { header: 'Responsable', width: 22 }, { header: 'Nombre completo', width: 28 },
          { header: 'CURP', width: 21 }, { header: 'Teléfono', width: 14 }, { header: 'Colonia domicilio', width: 22 }, { header: 'Sección', width: 9 },
          { header: 'Municipio', width: 15 }, { header: 'Medio de recepción', width: 24 }, { header: 'Fecha de ingreso', width: 15 },
          { header: 'Tipo de apoyo o petición', width: 24 }, { header: 'Detalle del problema', width: 50 }, { header: 'Monto estimado', width: 15, type: 'money' },
          { header: 'Prioridad', width: 10 }, { header: 'Dependencia responsable', width: 40 }, { header: 'Fuente de ingreso', width: 24 },
          { header: 'Primer contacto', width: 15 }, { header: 'Estado actual', width: 13 }, { header: 'Vencida', width: 9 }, { header: 'Fecha límite', width: 13 },
          { header: 'Última actualización', width: 18 }, { header: 'Observaciones', width: 50 }
        ],
        rows: list.map(g => [g.id, g.responsable, g.solicitante, g.curp, g.telefono, g.colonia, g.seccion, g.municipio, g.medio, fmtDate(g.fechaIngreso),
          g.tipo, g.descripcion, Number(g.monto) || 0, PRIORIDAD_LABEL[g.prioridad] || '', g.dependencia, g.fuente,
          g.primerContacto ? fmtDate(g.primerContacto) : '', ESTATUS_LABEL[g.estatus] || g.estatus, isVencida(g) ? 'Sí' : 'No',
          g.fechaLimite ? fmtDate(g.fechaLimite) : '', fmtDate(g.fechaActualizacion), g.observaciones])
      },
      {
        name: 'Resumen por ' + GROUP_LABEL[by].toLowerCase(),
        columns: [{ header: GROUP_LABEL[by], width: 36 }, { header: 'Total', width: 9, type: 'number' },
          ...ESTATUS.map(e => ({ header: e.label, width: 12, type: 'number' })), { header: 'Vencidas', width: 10, type: 'number' }, { header: 'Monto estimado', width: 16, type: 'money' }],
        rows: rows.map(r => [r.label, r.total, ...ESTATUS.map(e => r.est[e.id]), r.vencidas, r.monto])
      }
    ];
    await deliverFile(XLSX.build(sheets), `reporte-gestiones-${today()}.xlsx`);
  }

  function exportPdf() {
    const { list, by, rows } = reportData();
    if (!list.length) return toast('No hay gestiones con estos filtros.');
    const name = (getPrefs().nombre || '').trim() || DEFAULT_NAME;
    const monto = list.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    $('printArea').innerHTML = `
      <h1>${esc(name)} · Reporte de gestiones</h1>
      <div class="p-meta">Generado el ${esc(longDate(today()))} · ${esc(filtersDescription())}<br>${list.length} gestiones · ${list.filter(isVencida).length} vencidas · Monto estimado total ${money(monto)}</div>
      <h2>Resumen por ${esc(GROUP_LABEL[by].toLowerCase())}</h2>
      <table>${summaryTableHtml(rows, by, list.length)}</table>
      <h2>Detalle</h2>
      <table><thead><tr><th>Folio</th><th>Solicitante</th><th>Responsable</th><th>Dependencia</th><th>Prioridad</th><th>Colonia</th><th>Estado</th><th>Ingreso</th><th>Límite</th><th class="num">Monto</th></tr></thead>
      <tbody>${list.map(g => `<tr><td>#${g.id}</td><td>${esc(dash(g.solicitante))}</td><td>${esc(dash(g.responsable))}</td><td>${esc(dash(g.dependencia))}</td><td>${esc(PRIORIDAD_LABEL[g.prioridad] || '—')}</td><td>${esc(dash(g.colonia))}</td><td>${esc(ESTATUS_LABEL[g.estatus] || '')}${isVencida(g) ? ' (vencida)' : ''}</td><td>${fmtDate(g.fechaIngreso)}</td><td>${fmtDate(g.fechaLimite)}</td><td class="num">${g.monto ? money(g.monto) : '—'}</td></tr>`).join('')}</tbody></table>`;
    toast('En la vista de impresión, toca el botón Compartir para guardar como PDF.', 5000);
    setTimeout(() => window.print(), 300);
  }

  // ================= Configuración =================
  async function renderConfig() {
    const p = getPrefs();
    $('cfgName').value = p.nombre || DEFAULT_NAME;
    $('themeOptions').innerHTML = THEMES.map(t => `<button type="button" class="theme-opt${t.id === p.tema ? ' active' : ''}" data-theme-id="${t.id}"><span class="swatch" style="background:${t.color}"></span>${t.label}</button>`).join('');
    $('cfgLock').value = String(data.config.autoLockMin || 5);
    $('cfgLastBackup').textContent = data.config.lastBackup ? `Último respaldo: ${longDate(data.config.lastBackup.slice(0, 10))}` : 'Aún no has hecho ningún respaldo.';
    const c = data.config.catalogos;
    [['catDependencias', 'dependencias'], ['catResponsables', 'responsables'], ['catMedios', 'medios'], ['catFuentes', 'fuentes'], ['catTipos', 'tipos'], ['catMunicipios', 'municipios']]
      .forEach(([id, k]) => { $(id).value = (c[k] || []).join('\n'); });
    renderBioStatus();
    const [sec, col] = await Promise.all([getCarto('seccion'), getCarto('colonia')]);
    $('cfgCartoStatus').textContent = `${sec ? `Secciones: ${sec.features.length} zonas cargadas.` : 'Secciones: sin cargar.'} ${col ? `Colonias: ${col.features.length} zonas cargadas.` : 'Colonias: sin cargar.'}`;
  }

  async function renderBioStatus() {
    const enabled = Vault.bioEnabled();
    const avail = await Vault.bioAvailable();
    $('cfgBioConfirm').classList.add('hidden');
    $('cfgBioEnable').classList.toggle('hidden', enabled || !avail);
    $('cfgBioDisable').classList.toggle('hidden', !enabled);
    $('cfgBioStatus').textContent = enabled
      ? 'Activada. En la pantalla de bloqueo toca “Entrar con huella / Face ID”. Tu contraseña sigue funcionando.'
      : avail ? 'Entra con tu huella o Face ID en lugar de escribir la contraseña. Tus datos siguen cifrados igual.'
        : 'Este dispositivo o navegador no ofrece huella / Face ID para esta app.';
  }

  async function enableBio() {
    try {
      const r = await Vault.enableBio();
      if (r === 'confirmar') {
        $('cfgBioEnable').classList.add('hidden');
        $('cfgBioConfirm').classList.remove('hidden');
        $('cfgBioStatus').textContent = 'Falta un paso: toca “Confirmar con tu huella”.';
        return;
      }
      toast('Huella activada');
      renderBioStatus();
    } catch (err) {
      bioError(err);
    }
  }
  async function confirmBio() {
    try { await Vault.confirmBio(); toast('Huella activada'); }
    catch (err) { bioError(err); }
    renderBioStatus();
  }
  function bioError(err) {
    if (err && err.name === 'NotAllowedError') return toast('Se canceló. Puedes intentarlo de nuevo.');
    if (err && err.message === 'prf') return toast('Tu iPad no permite usar la huella para descifrar en esta app. Actualiza iPadOS a la versión más reciente.', 6000);
    toast('No se pudo activar la huella.', 4000);
    console.error(err);
  }

  async function saveGeneral() {
    const p = getPrefs();
    p.nombre = $('cfgName').value.trim() || DEFAULT_NAME;
    const active = document.querySelector('.theme-opt.active');
    if (active) p.tema = active.dataset.themeId;
    setPrefs(p);
    data.config.autoLockMin = Number($('cfgLock').value) || 5;
    await persist();
    toast('Configuración guardada');
  }

  async function changePassword() {
    const old = $('cfgOldPass').value, n1 = $('cfgNewPass').value, n2 = $('cfgNewPass2').value;
    if (n1.length < 8) return toast('La nueva contraseña debe tener al menos 8 caracteres.');
    if (n1 !== n2) return toast('Las contraseñas nuevas no coinciden.');
    if (!(await Vault.verify(old))) return toast('La contraseña actual no es correcta.');
    await Vault.changePassword(n1);
    ['cfgOldPass', 'cfgNewPass', 'cfgNewPass2'].forEach(id => { $(id).value = ''; });
    toast('Contraseña cambiada. Haz un respaldo nuevo: los anteriores siguen con la contraseña vieja.', 5000);
  }

  async function saveCatalogs() {
    const parse = id => [...new Set($(id).value.split('\n').map(s => s.trim()).filter(Boolean))];
    data.config.catalogos = {
      dependencias: parse('catDependencias'), responsables: parse('catResponsables'), medios: parse('catMedios'),
      fuentes: parse('catFuentes'), tipos: parse('catTipos'), municipios: parse('catMunicipios')
    };
    await persist();
    toast('Catálogos guardados');
  }

  async function exportBackup() {
    const ok = await deliverFile(new Blob([Vault.backupText()], { type: 'application/json' }), `respaldo-${today()}.json`);
    if (ok) {
      data.config.lastBackup = new Date().toISOString();
      await persist();
      checkBackupReminder();
      if (ui.section === 'config') renderConfig();
      toast('Respaldo listo. Guárdalo en Archivos o iCloud.');
    }
  }

  async function importBackup(file) {
    if (!file) return;
    const pass = await passwordBox('Escribe la contraseña con la que se hizo ese respaldo:');
    if (pass === null) return;
    try {
      const restored = await Vault.readBackup(await readFileText(file), pass);
      const n = (restored.gestiones || []).length;
      if (!(await confirmBox(`El respaldo tiene ${n} gestiones. ¿Reemplazar TODOS los datos actuales con él?`, 'Reemplazar', true))) return;
      data = restored;
      migrate();
      await persist(); // se vuelve a cifrar con tu llave actual
      toast('Respaldo restaurado.');
      switchSection('dashboard');
    } catch (err) {
      toast(err.message === 'contrasena' ? 'La contraseña no corresponde a ese respaldo.' : 'Ese archivo no es un respaldo válido.', 4000);
    }
  }

  async function importCarto(view, file) {
    if (!file) return;
    try {
      toast('Leyendo cartografía…');
      const geo = JSON.parse(await readFileText(file));
      MapaGeo.validateGeo(geo);
      await MapaGeo.store.set(view, geo);
      cartoCache[view] = geo;
      renderConfig();
      toast(`Cartografía de ${view === 'seccion' ? 'secciones' : 'colonias'} cargada: ${geo.features.length} zonas.`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'El archivo no es un GeoJSON válido.' : (err.message || 'No se pudo cargar.'), 4500);
    }
  }

  function checkBackupReminder() {
    const b = $('backupBanner');
    if (!data || !data.gestiones.length) return b.classList.add('hidden');
    const last = data.config.lastBackup ? new Date(data.config.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
    if (days === null || days >= BACKUP_REMINDER_DAYS) {
      $('backupBannerText').textContent = days === null
        ? 'Aún no tienes un respaldo. Si borras la app o cambias de iPad, sin respaldo se pierden los datos.'
        : `Tu último respaldo fue hace ${days} días. Te recomendamos hacer uno nuevo.`;
      b.classList.remove('hidden');
    } else b.classList.add('hidden');
  }

  // ================= Eventos de la interfaz =================
  function bind() {
    $('setupForm').addEventListener('submit', handleSetup);
    $('unlockForm').addEventListener('submit', handleUnlock);
    $('restoreForm').addEventListener('submit', handleRestore);
    $('bioBtn').addEventListener('click', handleBioUnlock);
    $('showRestoreBtn').addEventListener('click', () => showLock('restoreForm'));
    $('hideRestoreBtn').addEventListener('click', () => showLock('setupForm'));
    $('lockBtn').addEventListener('click', lockNow);
    $('menuBtn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebarBackdrop').classList.add('open'); });
    $('sidebarBackdrop').addEventListener('click', closeSidebar);
    $('sidebarMenu').addEventListener('click', e => { const li = e.target.closest('li'); if (li) { if (li.dataset.section === 'gestiones') ui.carry = null; switchSection(li.dataset.section); } });

    // Inicio
    $('taskCards').addEventListener('click', e => {
      const c = e.target.closest('[data-card]');
      if (c) toggleDash('dEstatus', c.dataset.card);
    });
    $('donutEstado').addEventListener('click', e => donutClick('donutEstado', e));
    $('donutResp').addEventListener('click', e => donutClick('donutResp', e));
    $('legendEstado').addEventListener('click', e => { const li = e.target.closest('[data-est]'); if (li) toggleDash('dEstatus', li.dataset.est); });
    $('legendResp').addEventListener('click', e => { const li = e.target.closest('[data-resp]'); if (li && li.dataset.resp !== '__otros') toggleDash('dResponsable', li.dataset.resp); });
    $('respBars').addEventListener('click', e => { const r = e.target.closest('[data-resp]'); if (r) toggleDash('dResponsable', r.dataset.resp); });
    $('dViewList').addEventListener('click', () => goGestiones({}));
    D_IDS.forEach(id => $(id).addEventListener('change', renderDashboard));
    $('dClear').addEventListener('click', () => { D_IDS.forEach(id => { $(id).value = ''; }); renderDashboard(); });
    $('hotList').addEventListener('click', e => { const li = e.target.closest('li[data-colonia]'); if (li) goToMapColonia(li.dataset.colonia); });
    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (data && ui.section === 'dashboard') renderDashboard(); }, 200); });

    // Acciones generales (delegadas)
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (a) {
        const act = a.dataset.action;
        if (act === 'new-gestion') openGestionModal();
        else if (act === 'new-evento') openEventoModal();
        else if (act === 'go-backup') { switchSection('config'); $('backupPanel').scrollIntoView({ behavior: 'smooth' }); }
        else if (act === 'ver-sin-ubicacion') goGestiones({ sinUbicacion: true });
        else if (act === 'agenda-proximos') { ui.selectedDay = null; renderEventos(); }
        else if (act === 'clear-carry') { ui.carry = null; renderGestiones(); }
        return;
      }
      const og = e.target.closest('[data-open-gestion]');
      if (og) { const g = data.gestiones.find(x => x.id === Number(og.dataset.openGestion)); if (g) openGestionModal(g); return; }
      const oe = e.target.closest('[data-evento]');
      if (oe) {
        const ev = data.eventos.find(x => x.id === Number(oe.dataset.evento));
        if (ev) { if ($('gestionModal').classList.contains('open')) closeModal('gestionModal'); openEventoModal(ev); }
        return;
      }
      const rc = e.target.closest('[data-report-colonia]');
      if (rc) { switchSection('reportes'); R_IDS.forEach(id => { $(id).value = ''; }); $('rColonia').value = rc.dataset.reportColonia; $('rGroup').value = 'estatus'; renderReportes(); return; }
      const ec = e.target.closest('[data-event-colonia]');
      if (ec) {
        const key = MapaGeo.normColonia(ec.dataset.eventColonia);
        const ids = applyFilters(data.gestiones, mapFilters()).filter(g => MapaGeo.normColonia(g.colonia) === key).map(g => g.id);
        openEventoModal(null, { colonia: ec.dataset.eventColonia, gestiones: ids });
        return;
      }
      const nd = e.target.closest('[data-new-evento-day]');
      if (nd) openEventoModal(null, { fecha: nd.dataset.newEventoDay });
    });

    // Gestiones
    $('gSearch').addEventListener('input', renderGestiones);
    ['gFilterEstatus', 'gFilterResponsable', 'gFilterDependencia', 'gFilterPrioridad', 'gFilterSinUbicacion'].forEach(id => $(id).addEventListener('change', renderGestiones));
    $('gTableBody').addEventListener('change', e => {
      const s = e.target.closest('[data-status-id]');
      if (s) changeStatus(Number(s.dataset.statusId), s.value, s);
    });
    $('gTableBody').addEventListener('click', e => {
      if (e.target.closest('select, button')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) openGestionModal(data.gestiones.find(g => g.id === Number(tr.dataset.id)));
    });
    $('gestionForm').addEventListener('submit', saveGestion);
    $('fCurp').addEventListener('input', checkCurp);
    $('gDeleteBtn').addEventListener('click', () => { if (ui.editingGestion) deleteGestion(ui.editingGestion.id); });
    $('gScheduleBtn').addEventListener('click', () => {
      const g = ui.editingGestion;
      closeModal('gestionModal');
      openEventoModal(null, { colonia: g.colonia, gestiones: [g.id], titulo: g.solicitante ? `Seguimiento: ${g.solicitante}` : `Seguimiento gestión #${g.id}` });
    });

    // Mapa
    ['mView', 'mEstatus', 'mResponsable', 'mDependencia', 'mMedio', 'mFuente', 'mDesde', 'mHasta'].forEach(id => $(id).addEventListener('change', () => {
      if (id === 'mView') ui.mapSelected = null;
      renderMapa();
    }));

    // Eventos
    $('calPrev').addEventListener('click', () => { ui.cal.m--; if (ui.cal.m < 0) { ui.cal.m = 11; ui.cal.y--; } renderEventos(); });
    $('calNext').addEventListener('click', () => { ui.cal.m++; if (ui.cal.m > 11) { ui.cal.m = 0; ui.cal.y++; } renderEventos(); });
    $('calToday').addEventListener('click', () => { const d = new Date(); ui.cal = { y: d.getFullYear(), m: d.getMonth() }; ui.selectedDay = today(); renderEventos(); });
    $('calGrid').addEventListener('click', e => {
      const d = e.target.closest('[data-day]');
      if (!d) return;
      ui.selectedDay = d.dataset.day;
      const [y, m] = ui.selectedDay.split('-').map(Number);
      if (m - 1 !== ui.cal.m) ui.cal = { y, m: m - 1 };
      renderEventos();
    });
    $('eventoForm').addEventListener('submit', saveEvento);
    $('eDeleteBtn').addEventListener('click', deleteEvento);
    $('eLinkSearch').addEventListener('input', renderLinkList);
    $('eLinkList').addEventListener('change', e => {
      const c = e.target.closest('[data-link]');
      if (!c) return;
      const id = Number(c.dataset.link);
      if (c.checked) ui.eventoLinks.add(id); else ui.eventoLinks.delete(id);
    });
    $('eLinkByColonia').addEventListener('click', () => {
      const key = MapaGeo.normColonia($('eColonia').value);
      if (!key) return toast('Escribe primero la colonia del evento.');
      const ids = data.gestiones.filter(g => MapaGeo.normColonia(g.colonia) === key).map(g => g.id);
      ids.forEach(id => ui.eventoLinks.add(id));
      renderLinkList();
      toast(ids.length ? `${ids.length} gestiones de esa colonia vinculadas` : 'No hay gestiones en esa colonia.');
    });

    // Reportes
    [...R_IDS, 'rGroup'].forEach(id => $(id).addEventListener('change', renderReportes));
    $('rClear').addEventListener('click', () => { R_IDS.forEach(id => { $(id).value = ''; }); renderReportes(); });
    $('rExcel').addEventListener('click', exportExcel);
    $('rPdf').addEventListener('click', exportPdf);

    // Configuración
    $('themeOptions').addEventListener('click', e => {
      const b = e.target.closest('.theme-opt');
      if (!b) return;
      document.querySelectorAll('.theme-opt').forEach(x => x.classList.toggle('active', x === b));
      document.documentElement.dataset.theme = b.dataset.themeId; // vista previa
    });
    $('cfgSaveGeneral').addEventListener('click', saveGeneral);
    $('cfgChangePass').addEventListener('click', changePassword);
    $('cfgSaveCatalogs').addEventListener('click', saveCatalogs);
    $('cfgBioEnable').addEventListener('click', enableBio);
    $('cfgBioConfirm').addEventListener('click', confirmBio);
    $('cfgBioDisable').addEventListener('click', async () => {
      if (!(await confirmBox('¿Desactivar la entrada con huella? Seguirás entrando con tu contraseña.', 'Desactivar'))) return;
      Vault.disableBio();
      renderBioStatus();
      toast('Huella desactivada');
    });
    $('cfgExport').addEventListener('click', exportBackup);
    $('cfgImport').addEventListener('change', e => { importBackup(e.target.files[0]); e.target.value = ''; });
    $('cfgCartoSeccion').addEventListener('change', e => { importCarto('seccion', e.target.files[0]); e.target.value = ''; });
    $('cfgCartoColonia').addEventListener('change', e => { importCarto('colonia', e.target.files[0]); e.target.value = ''; });
    $('cfgCartoClear').addEventListener('click', async () => {
      if (!(await confirmBox('¿Quitar la cartografía cargada? Tus gestiones no se borran.', 'Quitar', true))) return;
      await MapaGeo.store.clear();
      delete cartoCache.seccion; delete cartoCache.colonia;
      renderConfig();
      toast('Cartografía quitada');
    });

    // Modales
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', e => {
        if (m.id === 'confirmModal') return;
        if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id);
      });
    });
  }

  // ================= Inicio de la app =================
  function start() {
    applyPrefs();
    ['fDependencia', 'gFilterDependencia', 'mDependencia', 'rDependencia', 'dDependencia'].forEach(id => Combo.enhance($(id)));
    bind();
    if (!Vault.supported()) {
      showLock('unlockForm');
      $('unlockForm').classList.add('hidden');
      $('lockError').textContent = 'Este navegador no permite cifrar los datos. Abre la app desde Safari en tu iPad.';
      return;
    }
    setupAutoLock();
    showLock(Vault.exists() ? 'unlockForm' : 'setupForm');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  start();
})();
