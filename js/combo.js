/*
 * Lista con búsqueda: convierte un <select> en un campo donde escribes y
 * aparecen al instante las opciones que coinciden (sin importar acentos).
 * También encuentra por iniciales: "dif" → Desarrollo Integral de la Familia.
 * El <select> original sigue existiendo (oculto) y guarda el valor elegido.
 */
const Combo = (() => {
  const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'h.']);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const initials = s => norm(s).split(/[\s,]+/).filter(w => w && !STOP.has(w)).map(w => w[0]).join('');
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function highlight(text, q) {
    if (!q) return esc(text);
    const n = norm(text);
    const i = n.indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  function enhance(select) {
    if (select._combo) return;
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('combo-native');
    select.tabIndex = -1;

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'input combo-input';
    input.autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    if (select.id) {
      input.id = select.id + '__q';
      const lbl = document.querySelector(`label[for="${select.id}"]`);
      if (lbl) lbl.htmlFor = input.id;
    }
    if (select.getAttribute('aria-label')) input.setAttribute('aria-label', select.getAttribute('aria-label'));
    const list = document.createElement('ul');
    list.className = 'combo-list hidden';
    list.setAttribute('role', 'listbox');
    wrap.append(input, list);

    let items = [];
    let active = 0;
    let isOpen = false;

    const emptyOption = () => [...select.options].find(o => !o.value);
    function sync() {
      const sel = select.selectedOptions[0];
      input.value = select.value && sel ? sel.textContent : '';
      const e = emptyOption();
      input.placeholder = e ? e.textContent : 'Escribe para buscar…';
    }

    function render() {
      const q = norm(input.value);
      const opts = [...select.options];
      if (!q) items = opts;
      else {
        const scored = [];
        opts.forEach(o => {
          if (!o.value) return;
          const t = norm(o.textContent);
          const ini = initials(o.textContent);
          let s = -1;
          if (t.startsWith(q)) s = 0;
          else if (ini.startsWith(q.replace(/\s/g, ''))) s = 1;
          else if ((' ' + t).includes(' ' + q)) s = 2;
          else if (t.includes(q)) s = 3;
          if (s >= 0) scored.push({ o, s });
        });
        scored.sort((a, b) => a.s - b.s);
        items = scored.map(x => x.o);
      }
      active = Math.min(active, Math.max(0, items.length - 1));
      list.innerHTML = items.length
        ? items.map((o, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}${o.value === select.value ? ' chosen' : ''}${!o.value ? ' empty-opt' : ''}">${highlight(o.textContent, q)}</li>`).join('')
        : '<li class="none">Sin coincidencias</li>';
    }

    function open() {
      isOpen = true;
      wrap.classList.add('open');
      list.classList.remove('hidden');
      // Si no cabe abajo (por ejemplo, con el teclado abierto), se abre hacia arriba
      const r = input.getBoundingClientRect();
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      wrap.classList.toggle('up', vh - r.bottom < 240 && r.top > vh - r.bottom);
      render();
      const a = list.querySelector('.active');
      if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      isOpen = false;
      wrap.classList.remove('open');
      list.classList.add('hidden');
    }
    function choose(o) {
      if (!o) return;
      const changed = select.value !== o.value;
      select.value = o.value;
      sync();
      close();
      input.blur();
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', () => {
      // Al entrar se muestra toda la lista; al escribir se filtra
      input.value = '';
      active = Math.max(0, [...select.options].findIndex(o => o.value === select.value));
      open();
    });
    input.addEventListener('input', () => { active = 0; open(); });
    input.addEventListener('keydown', e => {
      if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) { open(); e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') { close(); sync(); input.blur(); }
    });
    // pointerdown para que la elección ocurra antes de que el campo pierda el foco
    list.addEventListener('pointerdown', e => {
      e.preventDefault();
      const li = e.target.closest('li[data-i]');
      if (li) choose(items[Number(li.dataset.i)]);
    });
    input.addEventListener('blur', () => { setTimeout(() => { close(); sync(); }, 120); });

    // Mantener el texto al día cuando el programa cambia opciones o valor
    new MutationObserver(sync).observe(select, { childList: true });
    select.addEventListener('change', sync);
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); sync(); }
    });
    select._combo = { sync, input };
    sync();
  }

  return { enhance };
})();
