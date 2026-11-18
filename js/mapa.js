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
  const STOPS = [[255, 241, 193], [255, 193, 7], [253, 126, 20], [220, 53, 69], [127, 29, 29]];
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

  function featureKey(feature, view) {
    const p = feature.properties || {};
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
      s.d = s.rings.map(r => 'M' + r.map(p => `${((p[0] - minX) * scale).toFixed(1)},${((p[1] - minY) * scale).toFixed(1)}`).join('L') + 'Z').join('');
    });
    return { shapes, W, H };
  }

  const cache = new WeakMap();

  function renderChoropleth(container, geo, view, counts, opts) {
    let built = cache.get(geo);
    if (!built) { built = buildPaths(geo); cache.set(geo, built); }
    const max = Math.max(1, ...Object.values(counts).map(c => c.total));
    const NS = 'http://www.w3.org/2000/svg';
    container.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    let vb = { x: 0, y: 0, w: built.W, h: built.H };
    const setVB = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
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
      title.textContent = `${view === 'seccion' ? 'Sección ' : ''}${label}: ${c ? c.total : 0} gestiones`;
      path.appendChild(title);
      g.appendChild(path);
    });

    // Tocar una zona (sin arrastrar)
    let moved = false;
    svg.addEventListener('click', e => {
      if (moved) return;
      const p = e.target.closest('path');
      if (!p) return;
      svg.querySelectorAll('path.selected').forEach(x => x.classList.remove('selected'));
      p.classList.add('selected');
      opts.onSelect(p.dataset.key);
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
      const nw = Math.min(built.W * 1.5, Math.max(built.W / 40, vb.w / factor));
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
    const zb = document.createElement('div');
    zb.className = 'map-zoom';
    zb.innerHTML = '<button type="button" data-z="in" aria-label="Acercar">＋</button><button type="button" data-z="out" aria-label="Alejar">－</button><button type="button" data-z="reset" aria-label="Ver todo">⤢</button>';
    zb.addEventListener('click', e => {
      const z = e.target.dataset.z;
      if (z === 'in') zoom(1.4);
      else if (z === 'out') zoom(1 / 1.4);
      else if (z === 'reset') { vb = { x: 0, y: 0, w: built.W, h: built.H }; setVB(); }
    });
    container.appendChild(zb);
    container.style.height = '560px';

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

  return { store, heatColor, normColonia, normSeccion, validateGeo, renderChoropleth, renderGrid };
})();
