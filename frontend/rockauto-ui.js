/**
 * RockAuto UI Module v3.1.0 — Zempel Auto Parts CRM
 * Renders RockAuto data into DOM. Depends on RockAutoFetch.
 * SOLID: Single responsibility per renderer. DRY: shared helpers.
 */
const RockAutoUI = (() => {
  'use strict';

  // ── DRY Helpers ──────────────────────────────────────────────
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    }
    return node;
  }

  function showLoading(container) {
    container.innerHTML = '';
    const spinner = el('div', { className: 'rockauto-loading', id: 'rockauto-loading' }, [
      el('div', { className: 'rockauto-spinner' }),
      el('p', { textContent: 'Loading RockAuto data...' }),
    ]);
    container.appendChild(spinner);
  }

  function showError(container, message) {
    container.innerHTML = '';
    const err = el('div', { className: 'rockauto-error', id: 'rockauto-error', role: 'alert' }, [
      el('p', { textContent: `⚠ ${message}` }),
      el('button', { textContent: 'Retry', id: 'rockauto-retry-btn', className: 'rockauto-retry-btn' }),
    ]);
    container.appendChild(err);
  }

  function showEmpty(container, message) {
    container.innerHTML = '';
    container.appendChild(el('div', { className: 'rockauto-empty', id: 'rockauto-empty' }, [
      el('p', { textContent: message || 'No results found.' }),
    ]));
  }

  // ── Renderers (SOLID: each handles one data type) ──────────

  function renderMakes(container, makes) {
    container.innerHTML = '';
    if (!makes || !makes.length) { showEmpty(container, 'No makes available.'); return; }
    const list = el('ul', { className: 'rockauto-makes-list', id: 'rockauto-makes-list' });
    for (const make of makes) {
      list.appendChild(el('li', { className: 'rockauto-make-item', 'data-make': make }, [
        el('button', {
          textContent: make,
          className: 'rockauto-make-btn',
          id: `rockauto-make-${make.toLowerCase().replace(/\s+/g, '-')}`,
        }),
      ]));
    }
    container.appendChild(el('h3', { textContent: `Vehicle Makes (${makes.length})`, id: 'rockauto-makes-heading' }));
    container.appendChild(list);
  }

  function renderYears(container, data) {
    container.innerHTML = '';
    if (!data.years?.length) { showEmpty(container, `No years for ${data.make}.`); return; }
    const grid = el('div', { className: 'rockauto-years-grid', id: 'rockauto-years-grid' });
    for (const year of data.years) {
      grid.appendChild(el('button', {
        textContent: String(year),
        className: 'rockauto-year-btn',
        'data-year': String(year),
        id: `rockauto-year-${year}`,
      }));
    }
    container.appendChild(el('h3', { textContent: `${data.make} — Years (${data.count})`, id: 'rockauto-years-heading' }));
    container.appendChild(grid);
  }

  function renderModels(container, data) {
    container.innerHTML = '';
    if (!data.models?.length) { showEmpty(container, `No models for ${data.make} ${data.year}.`); return; }
    const list = el('ul', { className: 'rockauto-models-list', id: 'rockauto-models-list' });
    for (const model of data.models) {
      list.appendChild(el('li', { className: 'rockauto-model-item' }, [
        el('button', {
          textContent: model,
          className: 'rockauto-model-btn',
          'data-model': model,
          id: `rockauto-model-${model.toLowerCase().replace(/\s+/g, '-')}`,
        }),
      ]));
    }
    container.appendChild(el('h3', { textContent: `${data.make} ${data.year} — Models (${data.count})` }));
    container.appendChild(list);
  }

  function renderEngines(container, data) {
    container.innerHTML = '';
    if (!data.engines?.length) { showEmpty(container, `No engines found.`); return; }
    const list = el('ul', { className: 'rockauto-engines-list', id: 'rockauto-engines-list' });
    for (const eng of data.engines) {
      list.appendChild(el('li', { className: 'rockauto-engine-item', 'data-carcode': eng.carcode }, [
        el('button', {
          textContent: `${eng.description} (${eng.carcode})`,
          className: 'rockauto-engine-btn',
          id: `rockauto-engine-${eng.carcode}`,
        }),
      ]));
    }
    container.appendChild(el('h3', { textContent: `Engines (${data.count})` }));
    container.appendChild(list);
  }

  function renderParts(container, data) {
    container.innerHTML = '';
    if (!data.parts?.length) { showEmpty(container, 'No parts found.'); return; }
    const table = el('table', { className: 'rockauto-parts-table', id: 'rockauto-parts-table' });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Part' }),
        el('th', { textContent: 'Number' }),
        el('th', { textContent: 'Brand' }),
        el('th', { textContent: 'Price' }),
      ]),
    ]);
    const tbody = el('tbody');
    for (const part of data.parts) {
      tbody.appendChild(el('tr', { className: 'rockauto-part-row' }, [
        el('td', { textContent: part.name || 'Unknown' }),
        el('td', { textContent: part.part_number || '—' }),
        el('td', { textContent: part.brand || '—' }),
        el('td', { textContent: part.price || '—', className: 'rockauto-price' }),
      ]));
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(el('h3', { textContent: `Parts (${data.count})` }));
    container.appendChild(table);
  }

  function renderSearchResults(container, data) {
    container.innerHTML = '';
    const results = data.results || [];
    if (!results.length) { showEmpty(container, `No results for "${data.query}".`); return; }
    const list = el('ul', { className: 'rockauto-search-list', id: 'rockauto-search-results' });
    for (const r of results) {
      list.appendChild(el('li', { className: 'rockauto-search-item' }, [
        el('strong', { textContent: r.name || 'Unknown' }),
        r.description ? el('span', { textContent: ` — ${r.description}` }) : null,
      ]));
    }
    container.appendChild(el('h3', { textContent: `Search: "${data.query}" (${results.length})` }));
    container.appendChild(list);
  }

  // ── Public API ───────────────────────────────────────────────
  return Object.freeze({
    el, showLoading, showError, showEmpty,
    renderMakes, renderYears, renderModels, renderEngines, renderParts, renderSearchResults,
  });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RockAutoUI;
