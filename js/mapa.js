/*
 * Mapa de calor sin internet.
 * - Con cartografía (GeoJSON de secciones o colonias guardado en el iPad): mapa por zonas coloreadas.
 * - Sin cartografía: cuadrícula de calor por colonia o sección.
 */
const MapaGeo = (() => {
  // ---------- Almacén de cartografía (IndexedDB, solo en este dispositivo) ----------
  const DB_NAME = 'panel-carto';
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('layers');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction('layers', mode);
      const store = t.objectStore('layers');
      const req = fn(store);
      t.oncomplete = () => { db.close(); resolve(req && req.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  }
  const store = {
    get: layer => tx('readonly', s => s.get(layer)).catch(() => null),
    set: (layer, geo) => tx('readwrite', s => s.put(geo, layer)),
    clear: () => tx('readwrite', s => s.clear())
  };

  // ---------- Utilidades ----------
  // Paletas del mapa de calor (de menos a más gestiones)
  const PALETTES = {
    verde: { label: 'Verde', stops: [[229, 245, 224], [161, 217, 155], [65, 171, 93], [0, 109, 44], [0, 68, 27]] },
    calor: { label: 'Amarillo a rojo', stops: [[255, 241, 193], [255, 193, 7], [253, 126, 20], [220, 53, 69], [127, 29, 29]] },
    azul: { label: 'Azul', stops: [[222, 235, 247], [158, 202, 225], [66, 146, 198], [8, 81, 156], [8, 48, 107]] },
    morado: { label: 'Morado', stops: [[239, 237, 245], [188, 189, 220], [128, 125, 186], [84, 39, 143], [63, 0, 125]] },
    guinda: { label: 'Guinda', stops: [[252, 235, 240], [238, 178, 194], [204, 102, 133], [140, 35, 70], [90, 12, 40]] },
    naranja: { label: 'Naranja', stops: [[254, 237, 222], [253, 190, 133], [253, 141, 60], [217, 71, 1], [140, 45, 4]] }
  };
  let STOPS = PALETTES.verde.stops;
  function setPalette(id) { STOPS = (PALETTES[id] || PALETTES.verde).stops; }
  function gradient(id) {
    const st = (PALETTES[id] || { stops: STOPS }).stops;
    return `linear-gradient(90deg, ${st.map(c => `rgb(${c.join(',')})`).join(', ')})`;
  }
  function heatColor(t) {
    if (!(t > 0)) return null;
    t = Math.max(0, Math.min(1, t));
    const pos = t * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(pos));
    const f = pos - i;
    const c = STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function textOn(t) { return t > 0.55 ? '#fff' : '#1f2933'; }

  function normColonia(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\b(col\.?|colonia|fracc\.?|fraccionamiento)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normSeccion(s) {
    const n = parseInt(String(s || '').replace(/\D/g, ''), 10);
    return isNaN(n) ? '' : String(n);
  }

  const SECCION_PROPS = ['SECCION', 'seccion', 'Seccion', 'CVE_SECC', 'SECC', 'secc', 'ID_SECCION'];
  const COLONIA_PROPS = ['COLONIA', 'colonia', 'Colonia', 'NOMBRE', 'nombre', 'Nombre', 'NOM_COL', 'NOM_ASEN', 'name', 'NAME'];

  const ZONA_PROPS = ['CP', 'd_codigo', 'cp', 'CODIGO', 'codigo_postal'];
  const normCp = v => { const d = String(v || '').replace(/\D/g, ''); return d ? d.padStart(5, '0') : ''; };
  function featureKey(feature, view) {
    const p = feature.properties || {};
    if (view === 'zona') {
      for (const k of ZONA_PROPS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') return { key: normCp(p[k]), label: 'CP ' + normCp(p[k]) };
      return { key: '', label: '' };
    }
    const props = view === 'seccion' ? SECCION_PROPS : COLONIA_PROPS;
    for (const k of props) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
        return { key: view === 'seccion' ? normSeccion(p[k]) : normColonia(p[k]), label: String(p[k]) };
      }
    }
    return { key: '', label: '' };
  }

  function validateGeo(geo) {
    if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features) || !geo.features.length) {
      throw new Error('El archivo no es un GeoJSON con zonas (FeatureCollection).');
    }
    const ok = geo.features.some(f => f.geometry && /Polygon/.test(f.geometry.type));
    if (!ok) throw new Error('El archivo no contiene polígonos.');
  }

  // ---------- Mapa con cartografía ----------
  function buildPaths(geo) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const sample = geo.features.find(f => f.geometry)?.geometry.coordinates.flat(3)[0];
    const planar = Math.abs(sample) > 180;
    let cosLat = 1;
    if (!planar) {
      // latitud media aproximada para no deformar el mapa
      let latSum = 0, n = 0;
      geo.features.forEach(f => {
        const c = f.geometry && f.geometry.coordinates.flat(3);
        if (c && c.length > 1) { latSum += c[1]; n++; }
      });
      cosLat = Math.cos(((n ? latSum / n : 28.6) * Math.PI) / 180);
    }
    const proj = ([x, y]) => planar ? [x, -y] : [x * cosLat, -y];
    const shapes = geo.features.filter(f => f.geometry && /Polygon/.test(f.geometry.type)).map(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const rings = polys.flatMap(poly => poly.map(ring => ring.map(pt => {
        const p = proj(pt);
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        return p;
      })));
      return { feature: f, rings };
    });
    const W = 1000;
    const scale = W / ((maxX - minX) || 1);
    const H = Math.max(200, (maxY - minY) * scale);
    shapes.forEach(s => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      s.d = s.rings.map(r => 'M' + r.map(p => {
        const x = (p[0] - minX) * scale, y = (p[1] - minY) * scale;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join('L') + 'Z').join('');
      s.bb = [x0, y0, x1, y1];
      s.area = (x1 - x0) * (y1 - y0);
    });
    // Zona "urbana": las 75 % de zonas más pequeñas (para no arrancar mostrando todo el campo)
    const areas = shapes.map(s => s.area).sort((a, b) => a - b);
    const cut = areas[Math.floor(areas.length * 0.75)] || Infinity;
    const urban = shapes.filter(s => s.area <= cut);
    return { shapes, W, H, urbanBox: boxOf(urban) };
  }

  function boxOf(list) {
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(s => { x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]); x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]); });
    return [x0, y0, x1, y1];
  }
  function boxToView(b, W, H, aspect) {
    if (!b) return { x: 0, y: 0, w: W, h: H };
    let w = (b[2] - b[0]) * 1.15 || W / 10, h = (b[3] - b[1]) * 1.15 || H / 10;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    w = Math.max(w, W / 40); h = Math.max(h, H / 40);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  const cache = new WeakMap();

  function renderChoropleth(container, geo, view, counts, opts) {
    let built = cache.get(geo);
    if (!built) { built = buildPaths(geo); cache.set(geo, built); }
    const max = Math.max(1, ...Object.values(counts).map(c => c.total));
    const NS = 'http://www.w3.org/2000/svg';
    container.innerHTML = '';
    container.style.height = '560px';
    const svg = document.createElementNS(NS, 'svg');
    // Vista inicial: donde hay gestiones; si no hay, la zona urbana
    const rect = container.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : 1.3;
    const withData = built.shapes.filter(s => { const k = featureKey(s.feature, view).key; return counts[k]; });
    const homeBox = withData.length ? boxOf(withData) : built.urbanBox;
    const home = () => boxToView(homeBox, built.W, built.H, aspect);
    let vb = opts.keepView && opts.keepView.view === view && opts.keepView.vb ? Object.assign({}, opts.keepView.vb) : home();
    const bubbles = [];
    const pxScale = () => { const r = container.getBoundingClientRect(); return Math.max(vb.w / (r.width || 800), vb.h / (r.height || 560)); };
    const sizeBubbles = () => {
      const k = pxScale();
      bubbles.forEach(b => {
        b.c.setAttribute('r', (b.rpx * k).toFixed(2));
        b.c.setAttribute('stroke-width', (2 * k).toFixed(2));
        if (b.t) { b.t.setAttribute('font-size', (11 * k).toFixed(2)); b.t.setAttribute('dy', (4 * k).toFixed(2)); }
      });
    };
    const setVB = () => {
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      sizeBubbles();
      if (opts.keepView) { opts.keepView.view = view; opts.keepView.vb = vb; }
    };
    setVB();
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const g = document.createElementNS(NS, 'g');
    svg.appendChild(g);

    let matched = 0;
    built.shapes.forEach(s => {
      const { key, label } = featureKey(s.feature, view);
      const c = counts[key];
      const t = c ? c.total / max : 0;
      if (c) matched++;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', s.d);
      path.setAttribute('fill', heatColor(t) || 'var(--border)');
      path.dataset.key = key;
      if (opts.selected && opts.selected === key) path.classList.add('selected');
      const title = document.createElementNS(NS, 'title');
      title.textContent = `${view === 'seccion' ? 'Sección ' : view === 'zona' ? 'Zona ' : ''}${label}: ${c ? c.total : 0} gestiones`;
      path.appendChild(title);
      g.appendChild(path);
      if (c) s._t = t;
    });

    // Puntos de calor: un círculo por zona con gestiones (se ven aunque la zona sea pequeña)
    const gb = document.createElementNS(NS, 'g');
    built.shapes.filter(s => s._t !== undefined && counts[featureKey(s.feature, view).key]).forEach(s => {
      const { key, label } = featureKey(s.feature, view);
      const c = counts[key];
      const t = c.total / max;
      const cx = (s.bb[0] + s.bb[2]) / 2, cy = (s.bb[1] + s.bb[3]) / 2;
      const circ = document.createElementNS(NS, 'circle');
      circ.setAttribute('cx', cx); circ.setAttribute('cy', cy);
      circ.setAttribute('fill', heatColor(Math.max(t, 0.25)));
      circ.setAttribute('stroke', '#fff');
      circ.setAttribute('class', 'heat-dot');
      circ.dataset.key = key;
      const title = document.createElementNS(NS, 'title');
      title.textContent = `${view === 'seccion' ? 'Sección ' : view === 'zona' ? 'Zona ' : ''}${label}: ${c.total} gestiones`;
      circ.appendChild(title);
      gb.appendChild(circ);
      const rpx = 7 + 13 * Math.sqrt(t);
      let txt = null;
      if (rpx >= 10) {
        txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', cx); txt.setAttribute('y', cy);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'heat-dot-label');
        txt.setAttribute('fill', t > 0.45 ? '#fff' : '#1f2933');
        txt.textContent = c.total;
        gb.appendChild(txt);
      }
      bubbles.push({ c: circ, t: txt, rpx });
    });
    svg.appendChild(gb);
    built.shapes.forEach(s => { delete s._t; });

    // Tocar una zona (sin arrastrar)
    let moved = false;
    svg.addEventListener('click', e => {
      if (moved) return;
      const hit = e.target.closest('path, circle');
      if (!hit) return;
      const key = hit.dataset.key;
      svg.querySelectorAll('path.selected').forEach(x => x.classList.remove('selected'));
      const p = svg.querySelector(`path[data-key="${CSS.escape(key)}"]`);
      if (p) p.classList.add('selected');
      opts.onSelect(key);
    });

    // Arrastrar y pellizcar para mover / acercar
    const pointers = new Map();
    let lastDist = 0;
    const toSvg = (dx, dy) => {
      const r = svg.getBoundingClientRect();
      const s = Math.max(vb.w / r.width, vb.h / r.height);
      return [dx * s, dy * s];
    };
    const zoom = (factor, cx, cy) => {
      const nw = Math.min(built.W * 1.5, Math.max(built.W / 400, vb.w / factor));
      const nh = nw * (vb.h / vb.w);
      const fx = cx === undefined ? 0.5 : cx, fy = cy === undefined ? 0.5 : cy;
      vb.x += (vb.w - nw) * fx; vb.y += (vb.h - nh) * fy; vb.w = nw; vb.h = nh;
      setVB();
    };
    svg.addEventListener('pointerdown', e => { pointers.set(e.pointerId, e); moved = false; });
    svg.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, e);
      if (pointers.size === 1) {
        const [dx, dy] = toSvg(e.clientX - prev.clientX, e.clientY - prev.clientY);
        if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
        vb.x -= dx; vb.y -= dy; setVB();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (lastDist) { zoom(d / lastDist); moved = true; }
        lastDist = d;
      }
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) lastDist = 0; };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });

    container.appendChild(svg);
    requestAnimationFrame(sizeBubbles);
    const zb = document.createElement('div');
    zb.className = 'map-zoom';
    zb.innerHTML = '<button type="button" data-z="in" aria-label="Acercar">＋</button><button type="button" data-z="out" aria-label="Alejar">－</button><button type="button" data-z="reset" aria-label="Centrar en las gestiones" title="Centrar en las gestiones">◎</button><button type="button" data-z="all" aria-label="Ver todo el municipio" title="Ver todo el municipio">⤢</button>';
    zb.addEventListener('click', e => {
      const z = e.target.dataset.z;
      if (z === 'in') zoom(1.4);
      else if (z === 'out') zoom(1 / 1.4);
      else if (z === 'reset') { vb = home(); setVB(); }
      else if (z === 'all') { vb = boxToView(boxOf(built.shapes), built.W, built.H, aspect); setVB(); }
    });
    container.appendChild(zb);

    const totalKeys = Object.keys(counts).filter(k => k).length;
    return { matched, unmatched: Math.max(0, totalKeys - matched) };
  }

  // ---------- Cuadrícula de calor (sin cartografía) ----------
  function renderGrid(container, items, opts) {
    const max = Math.max(1, ...items.map(i => i.count));
    container.style.height = '';
    const msg = opts.message ? `<div class="map-msg">${opts.message}</div>` : '';
    if (!items.length) {
      container.innerHTML = msg + '<p class="muted" style="padding:30px;text-align:center">No hay gestiones con ubicación para estos filtros.</p>';
      return;
    }
    container.innerHTML = msg + '<div class="heat-grid">' + items.map(i => {
      const t = i.count / max;
      return `<div class="heat-tile${opts.selected === i.key ? ' selected' : ''}" data-key="${opts.esc(i.key)}" style="background:${heatColor(t)};color:${textOn(t)}">
        <span class="t-name">${opts.esc(i.label)}</span><span class="t-count">${i.count}</span></div>`;
    }).join('') + '</div>';
    container.querySelectorAll('.heat-tile').forEach(el => el.addEventListener('click', () => {
      container.querySelectorAll('.heat-tile.selected').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      opts.onSelect(el.dataset.key);
    }));
  }

  return { store, heatColor, normColonia, normSeccion, normCp, validateGeo, renderChoropleth, renderGrid, PALETTES, setPalette, gradient };
})();
