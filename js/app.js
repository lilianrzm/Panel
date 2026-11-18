/* Gestor-S — app principal */
(() => {
  'use strict';

  // ================= Constantes =================
  const ESTATUS = [
    { id: 'capturado', label: 'Capturado' },
    { id: 'revision', label: 'En Revisión' },
    { id: 'terminado', label: 'Terminado' },
    { id: 'cancelado', label: 'Cancelado' }
  ];
  const ESTATUS_LABEL = Object.fromEntries(ESTATUS.map(e => [e.id, e.label]));
  const THEMES = [
    { id: 'azul', label: 'Azul institucional', color: '#1f3a5f' },
    { id: 'guinda', label: 'Guinda', color: '#691c32' },
    { id: 'verde', label: 'Verde', color: '#1e5b4f' },
    { id: 'gris', label: 'Gris neutro', color: '#3f4752' },
    { id: 'oscuro', label: 'Modo oscuro', color: '#11161d' }
  ];
  const DEFAULT_NAME = 'Gestor-S';
  const PREFS_KEY = 'panel.prefs';
  const LOCK_WHEN_HIDDEN_MS = 30 * 1000;
  const BACKUP_REMINDER_DAYS = 7;

  const DEFAULT_CATALOGOS = {
    dependencias: [
      'Dirección de Obras Públicas',
      'Dirección de Mantenimiento Urbano',
      'Dirección de Servicios Públicos',
      'Dirección de Seguridad Pública',
      'Dirección de Desarrollo Humano y Educación',
      'Dirección de Desarrollo Urbano y Ecología',
      'DIF Municipal',
      'Tesorería Municipal',
      'Coordinación de Medio Ambiente y Protección Animal',
      'Coordinación de Participación Ciudadana',
      'Gobierno del Estado',
      'Otra'
    ],
    tipos: ['Servicios Públicos', 'Obra Pública', 'Seguridad', 'Desarrollo Social', 'Apoyo', 'Comercio', 'Otro'],
    fuentes: ['Web', 'WhatsApp', 'Presencial', 'Teléfono', 'Recorrido'],
    municipios: ['Chihuahua', 'Aldama', 'Aquiles Serdán', 'Juárez', 'Cuauhtémoc', 'Delicias', 'Hidalgo del Parral', 'Otro']
  };

  function newData() {
    return {
      gestiones: [],
      eventos: [],
      config: {
        nextId: 1,
        nextEventoId: 1,
        autoLockMin: 5,
        lastBackup: null,
        catalogos: JSON.parse(JSON.stringify(DEFAULT_CATALOGOS))
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
    chartBars: []
  };
  const cartoCache = {};

  // ================= Utilidades =================
  const $ = id => document.getElementById(id);
  const esc = v => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date()); // fecha local (no UTC)
  const fmtDate = s => {
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  };
  const longDate = s => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
  const dash = v => (v === null || v === undefined || v === '') ? '—' : v;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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
    try {
      await Vault.save(data);
    } catch (e) {
      toast('No se pudo guardar. Revisa el espacio del iPad.', 4000);
      console.error(e);
    }
  }

  async function deliverFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
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
    const extra = field ? [...new Set(data.gestiones.map(g => g[field]).filter(Boolean))].filter(v => !base.includes(v)) : [];
    return [...base, ...extra.sort((a, b) => a.localeCompare(b, 'es'))];
  }
  function fillSelect(sel, options, { all, placeholder, value } = {}) {
    const cur = value !== undefined ? value : sel.value;
    let html = '';
    if (all) html += `<option value="">${esc(all)}</option>`;
    if (placeholder !== undefined) html += `<option value="">${esc(placeholder)}</option>`;
    const opts = [...options];
    if (cur && !opts.some(o => (o.id || o) === cur)) opts.push(cur);
    html += opts.map(o => {
      const v = o.id || o, l = o.label || o;
      return `<option value="${esc(v)}">${esc(l)}</option>`;
    }).join('');
    sel.innerHTML = html;
    sel.value = cur || '';
  }
  function uniqueColonias() {
    const map = new Map();
    data.gestiones.forEach(g => {
      if (!g.colonia) return;
      const k = MapaGeo.normColonia(g.colonia);
      if (!map.has(k)) map.set(k, g.colonia);
    });
    return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'));
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
    const first = $(mode).querySelector('input');
    if (first) setTimeout(() => first.focus(), 100);
  }

  function enterApp() {
    $('lockScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    ['setupPass', 'setupPass2', 'unlockPass', 'restorePass'].forEach(id => { $(id).value = ''; });
    lastActivity = Date.now();
    migrate();
    switchSection('dashboard');
    checkBackupReminder();
  }

  function lockNow() {
    Vault.lock();
    data = null;
    // Recargar borra de la memoria todo lo descifrado
    location.reload();
  }

  function migrate() {
    const def = newData();
    data.gestiones = data.gestiones || [];
    data.eventos = data.eventos || [];
    data.config = Object.assign(def.config, data.config || {});
    data.config.catalogos = Object.assign(def.config.catalogos, data.config.catalogos || {});
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
    toast('Listo. Tus datos quedan cifrados en este iPad.');
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

  async function handleRestore(e) {
    e.preventDefault();
    const file = $('restoreFile').files[0];
    const pass = $('restorePass').value;
    if (!file) return ($('lockError').textContent = 'Elige el archivo de respaldo.');
    $('lockError').textContent = 'Descifrando respaldo…';
    try {
      const text = await readFileText(file);
      const restored = await Vault.readBackup(text, pass);
      data = restored;
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
  function switchSection(section) {
    ui.section = section;
    if (section !== 'config') applyPrefs(); // descarta la vista previa de tema no guardada
    document.querySelectorAll('#sidebarMenu li').forEach(li => li.classList.toggle('active', li.dataset.section === section));
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === section));
    $('pageTitle').textContent = TITLES[section];
    closeSidebar();
    window.scrollTo(0, 0);
    refreshDatalists();
    ({ dashboard: renderDashboard, gestiones: renderGestiones, mapa: renderMapa, eventos: renderEventos, reportes: renderReportes, config: renderConfig })[section]();
  }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarBackdrop').classList.remove('open'); }

  function refreshDatalists() {
    $('coloniasList').innerHTML = uniqueColonias().map(c => `<option value="${esc(c)}">`).join('');
    const secs = [...new Set(data.gestiones.map(g => g.seccion).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    $('seccionesList').innerHTML = secs.map(s => `<option value="${esc(s)}">`).join('');
  }

  // ================= Inicio =================
  function renderDashboard() {
    const counts = Object.fromEntries(ESTATUS.map(e => [e.id, 0]));
    const montos = Object.fromEntries(ESTATUS.map(e => [e.id, 0]));
    data.gestiones.forEach(g => { counts[g.estatus] = (counts[g.estatus] || 0) + 1; montos[g.estatus] = (montos[g.estatus] || 0) + (Number(g.monto) || 0); });

    $('statusCards').innerHTML = ESTATUS.map(e => `
      <div class="card" style="--c: var(--st-${e.id})" data-estatus="${e.id}">
        <div class="card-number">${counts[e.id]}</div>
        <div class="card-title">${e.label}</div>
        <div class="card-sub">${money(montos[e.id])}</div>
      </div>`).join('');

    drawStatusChart(counts);

    // Zonas con más gestiones
    const zonas = new Map();
    data.gestiones.forEach(g => {
      if (!g.colonia) return;
      const k = MapaGeo.normColonia(g.colonia);
      const z = zonas.get(k) || { key: k, label: g.colonia, count: 0 };
      z.count++;
      zonas.set(k, z);
    });
    const top = [...zonas.values()].sort((a, b) => b.count - a.count).slice(0, 8);
    const max = top.length ? top[0].count : 1;
    $('hotList').innerHTML = top.length ? top.map(z => `
      <li data-colonia="${esc(z.key)}">
        <span class="dot"></span>
        <span class="hot-name">${esc(z.label)}<div class="hot-bar" style="width:${Math.max(6, (z.count / max) * 100)}%"></div></span>
        <span class="hot-count">${z.count}</span>
      </li>`).join('') : '<li class="agenda-empty" style="cursor:default">Aún no hay gestiones con colonia.</li>';

    // Próximos eventos
    const hoy = today();
    const proximos = data.eventos.filter(ev => ev.fecha && ev.fecha >= hoy)
      .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || ''))).slice(0, 5);
    $('dashAgenda').innerHTML = proximos.length ? proximos.map(agendaItem).join('') : '<li class="agenda-empty">No hay eventos próximos.</li>';

    // Sin ubicación
    const sinUb = data.gestiones.filter(g => !g.colonia && !g.seccion).length;
    const n = $('noLocationNotice');
    if (sinUb) {
      n.innerHTML = `<span>📍 ${sinUb} ${sinUb === 1 ? 'gestión no tiene' : 'gestiones no tienen'} colonia ni sección, así que no aparecen en el mapa.</span><button class="btn btn-outline btn-sm" data-action="ver-sin-ubicacion">Ver</button>`;
      n.classList.remove('hidden');
    } else n.classList.add('hidden');
  }

  function drawStatusChart(counts) {
    const canvas = $('statusChart');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 400, h = canvas.clientHeight || 240;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const textColor = css.getPropertyValue('--text').trim();
    const muted = css.getPropertyValue('--muted').trim();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    ui.chartBars = [];
    if (!total) {
      ctx.fillStyle = muted; ctx.font = '15px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Aún no hay gestiones capturadas', w / 2, h / 2);
      return;
    }
    const max = Math.max(...Object.values(counts), 1);
    const labelW = 110, rowH = h / ESTATUS.length, barH = Math.min(34, rowH * 0.6);
    ESTATUS.forEach((e, i) => {
      const y = i * rowH + (rowH - barH) / 2;
      const bw = Math.max(counts[e.id] ? 4 : 0, ((w - labelW - 70) * counts[e.id]) / max);
      ctx.fillStyle = textColor; ctx.font = '600 14px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(e.label, 0, y + barH / 2);
      ctx.fillStyle = css.getPropertyValue('--st-' + e.id).trim();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(labelW, y, bw, barH, 6); else ctx.rect(labelW, y, bw, barH);
      ctx.fill();
      ctx.fillStyle = textColor; ctx.font = '700 14px -apple-system, sans-serif';
      const pct = Math.round((counts[e.id] / total) * 100);
      ctx.fillText(`${counts[e.id]}  (${pct}%)`, labelW + bw + 8, y + barH / 2);
      ui.chartBars.push({ estatus: e.id, y0: i * rowH, y1: (i + 1) * rowH });
    });
  }

  function agendaItem(ev) {
    const n = (ev.gestiones || []).length;
    return `<li data-evento="${ev.id}">
      <div class="ag-date">${esc(longDate(ev.fecha))}${ev.hora ? ' · ' + esc(ev.hora) : ''}</div>
      <div class="ag-title">${esc(ev.titulo || 'Evento sin título')}</div>
      <div class="ag-meta">${[ev.colonia, ev.lugar].filter(Boolean).map(esc).join(' · ')}${n ? ` · ${n} ${n === 1 ? 'gestión vinculada' : 'gestiones vinculadas'}` : ''}</div>
    </li>`;
  }

  // ================= Gestiones =================
  function setupGestionFilters() {
    fillSelect($('gFilterEstatus'), ESTATUS, { all: 'Todos los estatus' });
    fillSelect($('gFilterDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas las dependencias' });
    fillSelect($('gFilterFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas las fuentes' });
  }

  function renderGestiones() {
    setupGestionFilters();
    const q = norm($('gSearch').value);
    const fe = $('gFilterEstatus').value, fd = $('gFilterDependencia').value, ff = $('gFilterFuente').value;
    const sinUb = $('gFilterSinUbicacion').checked;
    const list = data.gestiones.filter(g => {
      if (fe && g.estatus !== fe) return false;
      if (fd && g.dependencia !== fd) return false;
      if (ff && g.fuente !== ff) return false;
      if (sinUb && (g.colonia || g.seccion)) return false;
      if (q) {
        const hay = norm([g.id, '#' + g.id, g.solicitante, g.telefono, g.colonia, g.seccion, g.municipio, g.dependencia, g.tipo, g.fuente, g.descripcion].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.id - a.id);

    $('gTableBody').innerHTML = list.length ? list.map(g => `
      <tr data-id="${g.id}">
        <td class="folio">#${g.id}</td>
        <td>${esc(dash(g.solicitante))}</td>
        <td>${esc(dash(g.dependencia))}</td>
        <td>${esc(dash(g.fuente))}</td>
        <td>${esc(dash(g.colonia))}${g.seccion ? `<br><span class="muted">Secc. ${esc(g.seccion)}</span>` : ''}</td>
        <td><select class="status-select st-${esc(g.estatus)}" data-status-id="${g.id}" aria-label="Estatus de la gestión ${g.id}">
          ${ESTATUS.map(e => `<option value="${e.id}"${e.id === g.estatus ? ' selected' : ''}>${e.label}</option>`).join('')}
        </select></td>
        <td class="nowrap">${fechasCell(g)}</td>
        <td class="num">${g.monto ? money(g.monto) : '—'}</td>
        <td><div class="row-actions">
          <button class="btn btn-outline btn-sm" data-delete="${g.id}" aria-label="Eliminar">🗑</button>
        </div></td>
      </tr>`).join('') : `<tr><td colspan="9" class="empty">${data.gestiones.length ? 'Ninguna gestión coincide con los filtros.' : 'Aún no hay gestiones. Toca “Nueva gestión” para capturar la primera.'}</td></tr>`;
    $('gCount').textContent = `${list.length} de ${data.gestiones.length} gestiones`;
  }

  function fechasCell(g) {
    return `${fmtDate(g.fechaIngreso)}<br><span class="muted">Act. ${fmtDate(g.fechaActualizacion)}</span>`;
  }

  async function changeStatus(id, estatus, selectEl) {
    const g = data.gestiones.find(x => x.id === id);
    if (!g) return;
    g.estatus = estatus;
    g.fechaActualizacion = today();
    if (selectEl) selectEl.className = `status-select st-${estatus}`;
    await persist();
    const row = selectEl && selectEl.closest('tr');
    if (row) row.children[6].innerHTML = fechasCell(g);
    toast(`Folio #${id}: ${ESTATUS_LABEL[estatus]}`);
  }

  async function deleteGestion(id) {
    const ok = await confirmBox(`¿Eliminar la gestión #${id}? Esta acción no se puede deshacer.`, 'Eliminar', true);
    if (!ok) return;
    data.gestiones = data.gestiones.filter(g => g.id !== id);
    data.eventos.forEach(ev => { ev.gestiones = (ev.gestiones || []).filter(x => x !== id); });
    await persist();
    renderGestiones();
    toast(`Gestión #${id} eliminada`);
  }

  function openGestionModal(g = null, preset = {}) {
    ui.editingGestion = g;
    const src = g || Object.assign({ estatus: 'capturado', municipio: (data.config.catalogos.municipios || [])[0] || '', fechaIngreso: today() }, preset);
    fillSelect($('fMunicipio'), catalogOptions('municipios', 'municipio'), { placeholder: 'Sin especificar', value: src.municipio || '' });
    fillSelect($('fDependencia'), catalogOptions('dependencias', 'dependencia'), { placeholder: 'Sin especificar', value: src.dependencia || '' });
    fillSelect($('fTipo'), catalogOptions('tipos', 'tipo'), { placeholder: 'Sin especificar', value: src.tipo || '' });
    fillSelect($('fFuente'), catalogOptions('fuentes', 'fuente'), { placeholder: 'Sin especificar', value: src.fuente || '' });
    fillSelect($('fEstatus'), ESTATUS, { value: src.estatus || 'capturado' });
    $('fSolicitante').value = src.solicitante || '';
    $('fTelefono').value = src.telefono || '';
    $('fColonia').value = src.colonia || '';
    $('fSeccion').value = src.seccion || '';
    $('fMonto').value = src.monto || '';
    $('fFechaIngreso').value = src.fechaIngreso || today();
    $('fFechaAct').value = g ? fmtDate(g.fechaActualizacion) : 'Se asigna al guardar';
    $('fDescripcion').value = src.descripcion || '';
    $('gModalTitle').textContent = g ? `Gestión #${g.id}` : `Nueva gestión · Folio #${data.config.nextId}`;
    $('gScheduleBtn').classList.toggle('hidden', !g);

    const linked = g ? data.eventos.filter(ev => (ev.gestiones || []).includes(g.id)) : [];
    const box = $('gLinkedEvents');
    if (linked.length) {
      box.innerHTML = '<h4>Eventos vinculados</h4>' + linked.map(ev => `<span class="chip" data-evento="${ev.id}">📅 ${esc(fmtDate(ev.fecha))} · ${esc(ev.titulo || 'Evento')}</span>`).join('');
      box.classList.remove('hidden');
    } else box.classList.add('hidden');

    openModal('gestionModal');
  }

  async function saveGestion(e) {
    e.preventDefault();
    const montoRaw = $('fMonto').value;
    const form = {
      solicitante: $('fSolicitante').value.trim(),
      telefono: $('fTelefono').value.trim(),
      municipio: $('fMunicipio').value,
      colonia: $('fColonia').value.trim(),
      seccion: $('fSeccion').value.trim(),
      dependencia: $('fDependencia').value,
      tipo: $('fTipo').value,
      fuente: $('fFuente').value,
      monto: montoRaw === '' ? 0 : Math.max(0, parseFloat(montoRaw) || 0),
      estatus: $('fEstatus').value || 'capturado',
      fechaIngreso: $('fFechaIngreso').value || today(),
      descripcion: $('fDescripcion').value.trim()
    };
    const vacia = !form.solicitante && !form.telefono && !form.colonia && !form.seccion && !form.dependencia && !form.tipo && !form.fuente && !form.monto && !form.descripcion;
    if (vacia && !ui.editingGestion) {
      const ok = await confirmBox('No llenaste ningún dato. ¿Guardar la gestión vacía de todos modos?', 'Guardar vacía');
      if (!ok) return;
    }
    form.fechaActualizacion = today();
    let id;
    if (ui.editingGestion) {
      Object.assign(ui.editingGestion, form);
      id = ui.editingGestion.id;
    } else {
      id = data.config.nextId++;
      data.gestiones.push(Object.assign({ id }, form));
    }
    await persist();
    closeModal('gestionModal');
    ui.editingGestion = null;
    refreshCurrent();
    toast(`Gestión #${id} guardada`);
  }

  function refreshCurrent() {
    refreshDatalists();
    ({ dashboard: renderDashboard, gestiones: renderGestiones, mapa: renderMapa, eventos: renderEventos, reportes: renderReportes, config: renderConfig })[ui.section]();
  }

  // ================= Filtros compartidos =================
  function applyFilters(list, f) {
    return list.filter(g => {
      if (f.estatus && g.estatus !== f.estatus) return false;
      if (f.fuente && g.fuente !== f.fuente) return false;
      if (f.dependencia && g.dependencia !== f.dependencia) return false;
      if (f.tipo && g.tipo !== f.tipo) return false;
      if (f.municipio && g.municipio !== f.municipio) return false;
      if (f.colonia && MapaGeo.normColonia(g.colonia) !== f.colonia) return false;
      if (f.desde && (g.fechaIngreso || '') < f.desde) return false;
      if (f.hasta && (g.fechaIngreso || '') > f.hasta) return false;
      return true;
    });
  }

  // ================= Mapa =================
  function mapFilters() {
    return {
      estatus: $('mEstatus').value, fuente: $('mFuente').value, dependencia: $('mDependencia').value,
      tipo: $('mTipo').value, desde: $('mDesde').value, hasta: $('mHasta').value
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
    fillSelect($('mEstatus'), ESTATUS, { all: 'Todos los estatus' });
    fillSelect($('mFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas las fuentes' });
    fillSelect($('mDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas las dependencias' });
    fillSelect($('mTipo'), catalogOptions('tipos', 'tipo'), { all: 'Todos los tipos' });
    const view = $('mView').value;
    const list = applyFilters(data.gestiones, mapFilters());
    const groups = mapGroups(view, list);
    const area = $('mapArea');
    const geo = await getCarto(view);
    const onSelect = key => { ui.mapSelected = key; showMapDetail(groups[key], view, key); };
    const vista = view === 'seccion' ? 'sección' : 'colonia';

    if (geo) {
      const r = MapaGeo.renderChoropleth(area, geo, view, groups, { selected: ui.mapSelected, onSelect });
      $('mapLegend').innerHTML = `<span>Menos</span><span class="legend-bar"></span><span>Más gestiones</span>` +
        (r.unmatched ? `<span>· ${r.unmatched} ${r.unmatched === 1 ? 'zona con gestiones no aparece' : 'zonas con gestiones no aparecen'} en la cartografía (revisa cómo está escrita).</span>` : '');
    } else {
      const items = Object.values(groups).map(gp => ({ key: gp.key, label: gp.label, count: gp.total })).sort((a, b) => b.count - a.count);
      MapaGeo.renderGrid(area, items, {
        esc, selected: ui.mapSelected, onSelect,
        message: `Vista de calor por ${vista}. Para ver el mapa con contornos, carga la cartografía de ${view === 'seccion' ? 'secciones' : 'colonias'} en Configuración.`
      });
      $('mapLegend').innerHTML = '<span>Menos</span><span class="legend-bar"></span><span>Más gestiones</span>';
    }
    if (ui.mapSelected && groups[ui.mapSelected]) showMapDetail(groups[ui.mapSelected], view, ui.mapSelected);
    else if (ui.mapSelected) showMapDetail(null, view, ui.mapSelected);
    else $('mapDetail').innerHTML = '<p class="muted">Toca una zona del mapa para ver sus gestiones.</p>';
  }

  function countBy(items, field, labels) {
    const m = {};
    items.forEach(g => { const k = g[field] || 'Sin especificar'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<div class="stat"><span>${esc(labels ? (labels[k] || k) : k)}</span><strong>${v}</strong></div>`).join('');
  }

  function showMapDetail(grp, view, key) {
    const box = $('mapDetail');
    if (!grp) {
      box.innerHTML = `<h4>${view === 'seccion' ? 'Sección ' + esc(key) : 'Zona seleccionada'}</h4><p class="muted">Sin gestiones con estos filtros.</p>`;
      return;
    }
    const monto = grp.items.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    box.innerHTML = `
      <h4>${esc(grp.label)}</h4>
      <div class="stat"><span>Gestiones</span><strong>${grp.total}</strong></div>
      <div class="stat"><span>Monto estimado</span><strong>${money(monto)}</strong></div>
      <h5>Por estatus</h5>${countBy(grp.items, 'estatus', ESTATUS_LABEL)}
      <h5>Por fuente de ingreso</h5>${countBy(grp.items, 'fuente')}
      <h5>Por dependencia</h5>${countBy(grp.items, 'dependencia')}
      <h5>Gestiones</h5>
      <ul class="mini-list">${grp.items.sort((a, b) => b.id - a.id).map(g => `<li data-open-gestion="${g.id}"><strong>#${g.id}</strong> ${esc(dash(g.solicitante))}<br><span class="muted">${esc(ESTATUS_LABEL[g.estatus] || '')}${g.dependencia ? ' · ' + esc(g.dependencia) : ''}</span></li>`).join('')}</ul>
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
    const list = data.gestiones.filter(g => {
      if (!q) return true;
      return norm([g.id, '#' + g.id, g.solicitante, g.colonia, g.dependencia, g.tipo].join(' ')).includes(q);
    }).sort((a, b) => (ui.eventoLinks.has(b.id) - ui.eventoLinks.has(a.id)) || b.id - a.id);
    $('eLinkList').innerHTML = list.length ? list.map(g => `
      <label><input type="checkbox" data-link="${g.id}"${ui.eventoLinks.has(g.id) ? ' checked' : ''}>
      <span><strong>#${g.id}</strong> ${esc(dash(g.solicitante))} <span class="muted">· ${esc(dash(g.colonia))}${g.dependencia ? ' · ' + esc(g.dependencia) : ''}</span></span></label>`).join('')
      : '<p class="muted" style="padding:12px">No hay gestiones para vincular.</p>';
  }

  async function saveEvento(e) {
    e.preventDefault();
    const form = {
      titulo: $('eTitulo').value.trim(),
      fecha: $('eFecha').value || today(),
      hora: $('eHora').value,
      colonia: $('eColonia').value.trim(),
      lugar: $('eLugar').value.trim(),
      descripcion: $('eDescripcion').value.trim(),
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
    const ok = await confirmBox('¿Eliminar este evento?', 'Eliminar', true);
    if (!ok) return;
    data.eventos = data.eventos.filter(x => x.id !== ev.id);
    await persist();
    closeModal('eventoModal');
    ui.editingEvento = null;
    refreshCurrent();
    toast('Evento eliminado');
  }

  // ================= Reportes =================
  function reportFilters() {
    return {
      desde: $('rDesde').value, hasta: $('rHasta').value, fuente: $('rFuente').value, dependencia: $('rDependencia').value,
      tipo: $('rTipo').value, colonia: $('rColonia').value, municipio: $('rMunicipio').value, estatus: $('rEstatus').value
    };
  }

  function setupReportFilters() {
    fillSelect($('rFuente'), catalogOptions('fuentes', 'fuente'), { all: 'Todas' });
    fillSelect($('rDependencia'), catalogOptions('dependencias', 'dependencia'), { all: 'Todas' });
    fillSelect($('rTipo'), catalogOptions('tipos', 'tipo'), { all: 'Todos' });
    fillSelect($('rMunicipio'), catalogOptions('municipios', 'municipio'), { all: 'Todos' });
    fillSelect($('rEstatus'), ESTATUS, { all: 'Todos' });
    const cur = $('rColonia').value;
    const opts = uniqueColonias().map(c => ({ id: MapaGeo.normColonia(c), label: c }));
    $('rColonia').innerHTML = '<option value="">Todas</option>' + opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    $('rColonia').value = opts.some(o => o.id === cur) ? cur : '';
  }

  const GROUP_LABEL = { colonia: 'Colonia', seccion: 'Sección', fuente: 'Fuente de ingreso', dependencia: 'Dependencia', tipo: 'Tipo de gestión', estatus: 'Estatus', municipio: 'Municipio' };

  function reportData() {
    const list = applyFilters(data.gestiones, reportFilters()).sort((a, b) => a.id - b.id);
    const by = $('rGroup').value;
    const groups = new Map();
    list.forEach(g => {
      let k, label;
      if (by === 'colonia') { k = MapaGeo.normColonia(g.colonia); label = g.colonia; }
      else if (by === 'estatus') { k = g.estatus; label = ESTATUS_LABEL[g.estatus]; }
      else { k = g[by] || ''; label = g[by]; }
      if (!k) { k = '~'; label = 'Sin especificar'; }
      const grp = groups.get(k) || { label, total: 0, monto: 0, est: Object.fromEntries(ESTATUS.map(e => [e.id, 0])) };
      grp.total++;
      grp.monto += Number(g.monto) || 0;
      grp.est[g.estatus] = (grp.est[g.estatus] || 0) + 1;
      groups.set(k, grp);
    });
    const rows = [...groups.values()].sort((a, b) => b.total - a.total);
    return { list, by, rows };
  }

  function filtersDescription() {
    const f = reportFilters();
    const parts = [];
    if (f.desde || f.hasta) parts.push(`Periodo: ${f.desde ? fmtDate(f.desde) : 'inicio'} a ${f.hasta ? fmtDate(f.hasta) : 'hoy'}`);
    if (f.fuente) parts.push('Fuente: ' + f.fuente);
    if (f.dependencia) parts.push('Dependencia: ' + f.dependencia);
    if (f.tipo) parts.push('Tipo: ' + f.tipo);
    if (f.colonia) parts.push('Colonia: ' + $('rColonia').selectedOptions[0].textContent);
    if (f.municipio) parts.push('Municipio: ' + f.municipio);
    if (f.estatus) parts.push('Estatus: ' + ESTATUS_LABEL[f.estatus]);
    return parts.length ? parts.join(' · ') : 'Sin filtros (todas las gestiones)';
  }

  function summaryTableHtml(rows, by, total) {
    const tot = rows.reduce((a, r) => { a.total += r.total; a.monto += r.monto; ESTATUS.forEach(e => { a.est[e.id] += r.est[e.id]; }); return a; },
      { total: 0, monto: 0, est: Object.fromEntries(ESTATUS.map(e => [e.id, 0])) });
    return `<thead><tr><th>${GROUP_LABEL[by]}</th><th class="num">Gestiones</th><th class="num">%</th>${ESTATUS.map(e => `<th class="num">${e.label}</th>`).join('')}<th class="num">Monto</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.total}</td><td class="num">${total ? Math.round((r.total / total) * 100) : 0}%</td>${ESTATUS.map(e => `<td class="num">${r.est[e.id]}</td>`).join('')}<td class="num">${money(r.monto)}</td></tr>`).join('')
        : `<tr><td colspan="${4 + ESTATUS.length}" class="empty">Sin resultados.</td></tr>`}
      ${rows.length ? `<tr class="total-row"><td>Total</td><td class="num">${tot.total}</td><td class="num">100%</td>${ESTATUS.map(e => `<td class="num">${tot.est[e.id]}</td>`).join('')}<td class="num">${money(tot.monto)}</td></tr>` : ''}</tbody>`;
  }

  function detailRowsHtml(list) {
    return list.length ? list.map(g => `<tr data-open-gestion="${g.id}" style="cursor:pointer">
      <td class="folio">#${g.id}</td><td>${esc(dash(g.solicitante))}</td><td>${esc(dash(g.dependencia))}</td><td>${esc(dash(g.tipo))}</td>
      <td>${esc(dash(g.fuente))}</td><td>${esc(dash(g.colonia))}</td><td>${esc(dash(g.seccion))}</td>
      <td><span class="badge st-${esc(g.estatus)}">${esc(ESTATUS_LABEL[g.estatus] || g.estatus)}</span></td>
      <td class="nowrap">${fmtDate(g.fechaIngreso)}</td><td class="num">${g.monto ? money(g.monto) : '—'}</td></tr>`).join('')
      : '<tr><td colspan="10" class="empty">Sin resultados con estos filtros.</td></tr>';
  }

  function renderReportes() {
    setupReportFilters();
    const { list, by, rows } = reportData();
    const monto = list.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    $('rSummaryTitle').textContent = `Resumen por ${GROUP_LABEL[by].toLowerCase()}`;
    $('rSummary').innerHTML = summaryTableHtml(rows, by, list.length);
    $('rDetailTitle').textContent = `Detalle: ${list.length} ${list.length === 1 ? 'gestión' : 'gestiones'} · ${money(monto)}`;
    $('rTableBody').innerHTML = detailRowsHtml(list);
  }

  async function exportExcel() {
    const { list, by, rows } = reportData();
    if (!list.length) return toast('No hay gestiones con estos filtros.');
    const sheets = [
      {
        name: 'Gestiones',
        columns: [
          { header: 'Folio', width: 8, type: 'number' }, { header: 'Solicitante', width: 28 }, { header: 'Teléfono', width: 14 },
          { header: 'Municipio', width: 16 }, { header: 'Colonia', width: 22 }, { header: 'Sección', width: 10 },
          { header: 'Dependencia', width: 34 }, { header: 'Tipo de gestión', width: 18 }, { header: 'Fuente de ingreso', width: 16 },
          { header: 'Estatus', width: 13 }, { header: 'Monto estimado', width: 15, type: 'money' }, { header: 'Fecha de ingreso', width: 15 },
          { header: 'Última actualización', width: 18 }, { header: 'Descripción', width: 50 }
        ],
        rows: list.map(g => [g.id, g.solicitante, g.telefono, g.municipio, g.colonia, g.seccion, g.dependencia, g.tipo, g.fuente,
          ESTATUS_LABEL[g.estatus] || g.estatus, Number(g.monto) || 0, fmtDate(g.fechaIngreso), fmtDate(g.fechaActualizacion), g.descripcion])
      },
      {
        name: 'Resumen por ' + GROUP_LABEL[by].toLowerCase(),
        columns: [{ header: GROUP_LABEL[by], width: 34 }, { header: 'Gestiones', width: 11, type: 'number' },
          ...ESTATUS.map(e => ({ header: e.label, width: 12, type: 'number' })), { header: 'Monto estimado', width: 16, type: 'money' }],
        rows: rows.map(r => [r.label, r.total, ...ESTATUS.map(e => r.est[e.id]), r.monto])
      }
    ];
    const blob = XLSX.build(sheets);
    await deliverFile(blob, `reporte-gestiones-${today()}.xlsx`);
  }

  function exportPdf() {
    const { list, by, rows } = reportData();
    if (!list.length) return toast('No hay gestiones con estos filtros.');
    const name = (getPrefs().nombre || '').trim() || DEFAULT_NAME;
    const monto = list.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    $('printArea').innerHTML = `
      <h1>${esc(name)} · Reporte de gestiones</h1>
      <div class="p-meta">Generado el ${esc(longDate(today()))} · ${esc(filtersDescription())}<br>${list.length} gestiones · Monto estimado total ${money(monto)}</div>
      <h2>Resumen por ${esc(GROUP_LABEL[by].toLowerCase())}</h2>
      <table>${summaryTableHtml(rows, by, list.length)}</table>
      <h2>Detalle</h2>
      <table><thead><tr><th>Folio</th><th>Solicitante</th><th>Dependencia</th><th>Tipo</th><th>Fuente</th><th>Colonia</th><th>Sección</th><th>Estatus</th><th>Ingreso</th><th class="num">Monto</th></tr></thead>
      <tbody>${list.map(g => `<tr><td>#${g.id}</td><td>${esc(dash(g.solicitante))}</td><td>${esc(dash(g.dependencia))}</td><td>${esc(dash(g.tipo))}</td><td>${esc(dash(g.fuente))}</td><td>${esc(dash(g.colonia))}</td><td>${esc(dash(g.seccion))}</td><td>${esc(ESTATUS_LABEL[g.estatus] || '')}</td><td>${fmtDate(g.fechaIngreso)}</td><td class="num">${g.monto ? money(g.monto) : '—'}</td></tr>`).join('')}</tbody></table>`;
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
    $('catDependencias').value = (c.dependencias || []).join('\n');
    $('catTipos').value = (c.tipos || []).join('\n');
    $('catFuentes').value = (c.fuentes || []).join('\n');
    $('catMunicipios').value = (c.municipios || []).join('\n');
    const [sec, col] = await Promise.all([getCarto('seccion'), getCarto('colonia')]);
    const st = [];
    st.push(sec ? `Secciones: ${sec.features.length} zonas cargadas.` : 'Secciones: sin cargar.');
    st.push(col ? `Colonias: ${col.features.length} zonas cargadas.` : 'Colonias: sin cargar.');
    $('cfgCartoStatus').textContent = st.join(' ');
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
    await Vault.changePassword(n1, data);
    ['cfgOldPass', 'cfgNewPass', 'cfgNewPass2'].forEach(id => { $(id).value = ''; });
    toast('Contraseña cambiada. Haz un respaldo nuevo: los anteriores siguen con la contraseña vieja.', 5000);
  }

  async function saveCatalogs() {
    const parse = id => [...new Set($(id).value.split('\n').map(s => s.trim()).filter(Boolean))];
    data.config.catalogos = {
      dependencias: parse('catDependencias'), tipos: parse('catTipos'), fuentes: parse('catFuentes'), municipios: parse('catMunicipios')
    };
    await persist();
    toast('Catálogos guardados');
  }

  async function exportBackup() {
    const blob = new Blob([Vault.backupText()], { type: 'application/json' });
    const ok = await deliverFile(blob, `respaldo-${today()}.json`);
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
      const text = await readFileText(file);
      const restored = await Vault.readBackup(text, pass);
      const n = (restored.gestiones || []).length;
      const ok = await confirmBox(`El respaldo tiene ${n} gestiones. ¿Reemplazar TODOS los datos actuales con él?`, 'Reemplazar', true);
      if (!ok) return;
      data = restored;
      migrate();
      await persist(); // se vuelve a cifrar con tu contraseña actual
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
    $('showRestoreBtn').addEventListener('click', () => showLock('restoreForm'));
    $('hideRestoreBtn').addEventListener('click', () => showLock('setupForm'));
    $('lockBtn').addEventListener('click', lockNow);
    $('menuBtn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebarBackdrop').classList.add('open'); });
    $('sidebarBackdrop').addEventListener('click', closeSidebar);
    $('sidebarMenu').addEventListener('click', e => { const li = e.target.closest('li'); if (li) switchSection(li.dataset.section); });

    // Inicio
    $('statusCards').addEventListener('click', e => {
      const c = e.target.closest('.card');
      if (!c) return;
      setupGestionFilters();
      $('gFilterEstatus').value = c.dataset.estatus;
      switchSection('gestiones');
    });
    $('statusChart').addEventListener('click', e => {
      const r = $('statusChart').getBoundingClientRect();
      const y = e.clientY - r.top;
      const bar = ui.chartBars.find(b => y >= b.y0 && y < b.y1);
      if (bar) { setupGestionFilters(); $('gFilterEstatus').value = bar.estatus; switchSection('gestiones'); }
    });
    $('hotList').addEventListener('click', e => { const li = e.target.closest('li[data-colonia]'); if (li) goToMapColonia(li.dataset.colonia); });
    window.addEventListener('resize', () => { if (data && ui.section === 'dashboard') renderDashboard(); });

    // Acciones generales (delegadas)
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (a) {
        const act = a.dataset.action;
        if (act === 'new-gestion') openGestionModal();
        else if (act === 'new-evento') openEventoModal();
        else if (act === 'go-backup') { switchSection('config'); $('backupPanel').scrollIntoView({ behavior: 'smooth' }); }
        else if (act === 'ver-sin-ubicacion') { $('gFilterSinUbicacion').checked = true; switchSection('gestiones'); }
        else if (act === 'agenda-proximos') { ui.selectedDay = null; renderEventos(); }
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
      if (rc) { switchSection('reportes'); $('rColonia').value = rc.dataset.reportColonia; $('rGroup').value = 'fuente'; renderReportes(); return; }
      const ec = e.target.closest('[data-event-colonia]');
      if (ec) {
        const key = MapaGeo.normColonia(ec.dataset.eventColonia);
        const ids = applyFilters(data.gestiones, mapFilters()).filter(g => MapaGeo.normColonia(g.colonia) === key).map(g => g.id);
        openEventoModal(null, { colonia: ec.dataset.eventColonia, gestiones: ids });
        return;
      }
      const nd = e.target.closest('[data-new-evento-day]');
      if (nd) { openEventoModal(null, { fecha: nd.dataset.newEventoDay }); }
    });

    // Gestiones
    ['gSearch'].forEach(id => $(id).addEventListener('input', renderGestiones));
    ['gFilterEstatus', 'gFilterDependencia', 'gFilterFuente', 'gFilterSinUbicacion'].forEach(id => $(id).addEventListener('change', renderGestiones));
    $('gTableBody').addEventListener('change', e => {
      const s = e.target.closest('[data-status-id]');
      if (s) changeStatus(Number(s.dataset.statusId), s.value, s);
    });
    $('gTableBody').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]');
      if (ed) { openGestionModal(data.gestiones.find(g => g.id === Number(ed.dataset.edit))); return; }
      const del = e.target.closest('[data-delete]');
      if (del) { deleteGestion(Number(del.dataset.delete)); return; }
      if (e.target.closest('select, button')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) openGestionModal(data.gestiones.find(g => g.id === Number(tr.dataset.id)));
    });
    $('gestionForm').addEventListener('submit', saveGestion);
    $('gScheduleBtn').addEventListener('click', () => {
      const g = ui.editingGestion;
      closeModal('gestionModal');
      openEventoModal(null, { colonia: g.colonia, gestiones: [g.id], titulo: g.solicitante ? `Seguimiento: ${g.solicitante}` : `Seguimiento gestión #${g.id}` });
    });

    // Mapa
    ['mView', 'mEstatus', 'mFuente', 'mDependencia', 'mTipo', 'mDesde', 'mHasta'].forEach(id => $(id).addEventListener('change', () => {
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
    ['rDesde', 'rHasta', 'rFuente', 'rDependencia', 'rTipo', 'rColonia', 'rMunicipio', 'rEstatus', 'rGroup'].forEach(id => $(id).addEventListener('change', renderReportes));
    $('rClear').addEventListener('click', () => {
      ['rDesde', 'rHasta', 'rFuente', 'rDependencia', 'rTipo', 'rColonia', 'rMunicipio', 'rEstatus'].forEach(id => { $(id).value = ''; });
      renderReportes();
    });
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
