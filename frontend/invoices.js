/**
 * Invoices Module v1.2.0
 * ============================================================
 * Adds full invoicing to PartsCommand CRM: create/edit, PDF
 * download, print, email, SMS. Invoices live in db.invoices
 * (same getDB()/saveDB() cycle as everything else), so they
 * sync through the existing /sync endpoint and IndexedDB
 * fallback automatically — no separate storage layer.
 *
 * Depends on globals defined in index.html's inline <script>:
 *   getDB, saveDB, showToast, closeModal, getAppSettings,
 *   buildPDFHeader, navigate, renderView
 * Load this AFTER that inline script and AFTER jsPDF/autoTable.
 * ============================================================
 */

// ==================== HELPERS ====================
function _invGenId() {
  return 'INV' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

// Based on the highest existing invoice number, not the array length, so
// deleting invoices can never cause a duplicate number to be reissued.
function _invNextNumber(db) {
  const nums = (db.invoices || [])
    .map(i => parseInt(String(i.number || '').replace('INV-', ''), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 1000) + 1;
  return 'INV-' + String(next);
}

// Prevents stored XSS: customer name/email/notes/etc. are user-entered and
// get injected into innerHTML all over this file — every one of those
// values must be escaped first.
function _invEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
  // Escapes an ID interpolated into an inline handler: onclick="fn('ID')".
  // Escapes for the JS string context first, then the HTML attribute context.
function escId(v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

// Labor is stored as laborItems[] ({description, hours, rate}). Invoices saved
// before v1.1.0 only have laborHours/laborRate — treat those as a single row.
function _invLaborItems(inv) {
  if (Array.isArray(inv.laborItems)) return inv.laborItems;
  const h = Number(inv.laborHours) || 0;
  return h > 0 ? [{ description: 'Labor', hours: h, rate: Number(inv.laborRate) || 0 }] : [];
}

// NOTE: `subtotal` is the PARTS subtotal (kept for older callers). `preTax` is
// parts + labor, which is what the printed "Subtotal" line shows.
function _invTotals(inv) {
  const subtotal = (inv.lineItems || []).reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const laborTotal = _invLaborItems(inv).reduce((s, l) => s + (Number(l.hours) || 0) * (Number(l.rate) || 0), 0);
  const preTax = subtotal + laborTotal;
  const taxable = Math.max(0, preTax - (Number(inv.discount) || 0));
  const tax = taxable * ((Number(inv.taxRate) || 0) / 100);
  return { subtotal, laborTotal, preTax, tax, total: taxable + tax };
}

function _invMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _invNum(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// "123 Main St, Miami, FL 33101" -> ["123 Main St", "Miami, FL 33101"]
function _invSplitAddress(addr) {
  const a = String(addr || '').trim();
  if (!a) return ['', ''];
  const i = a.indexOf(',');
  return i < 0 ? [a, ''] : [a.slice(0, i).trim(), a.slice(i + 1).trim()];
}

function _invStatusBadge(status) {
  const map = {
    draft: 'bg-slate-500/20 text-slate-300',
    sent: 'bg-blue-400/20 text-blue-400',
    paid: 'bg-green-400/20 text-green-400',
    overdue: 'bg-red-400/20 text-red-400',
    void: 'bg-slate-600/20 text-slate-500'
  };
  return `<span class="badge ${map[status] || map.draft}">${(status || 'draft').charAt(0).toUpperCase() + (status || 'draft').slice(1)}</span>`;
}

function _invFmtDate(d) {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US'); } catch (e) { return d; }
}

// ==================== SANITIZE (called from index.html sanitizeDB) ====================
function sanitizeInvoices(db) {
  if (!db.invoices) { db.invoices = []; return; }
  db.invoices.forEach(inv => {
    inv.laborHours = Number(inv.laborHours) || 0;
    inv.laborRate = Number(inv.laborRate) || 0;
    inv.discount = Number(inv.discount) || 0;
    inv.taxRate = Number(inv.taxRate) || 0;
    if (!Array.isArray(inv.laborItems)) {
      inv.laborItems = inv.laborHours > 0 ? [{ description: 'Labor', hours: inv.laborHours, rate: inv.laborRate }] : [];
    } else {
      inv.laborItems.forEach(l => {
        l.description = l.description || '';
        l.hours = Number(l.hours) || 0;
        l.rate = Number(l.rate) || 0;
      });
    }
    if (inv.lineItems) {
      inv.lineItems.forEach(li => {
        li.qty = Number(li.qty) || 0;
        li.unitPrice = Number(li.unitPrice) || 0;
      });
    }
  });
}

// ==================== LIST VIEW ====================
function renderInvoices(el) {
  const db = getDB();
  const invoices = db.invoices || [];
  const q = (typeof searchQuery !== 'undefined' ? searchQuery : '').toLowerCase();
  const filtered = q
    ? invoices.filter(i => (i.customerName || '').toLowerCase().includes(q) || (i.number || '').toLowerCase().includes(q))
    : invoices;

  const statusFilter = (typeof _invActiveFilter !== 'undefined' && _invActiveFilter) || 'all';
  const shown = statusFilter === 'all' ? filtered : filtered.filter(i => i.status === statusFilter);

  const totalValue = invoices.reduce((s, i) => s + _invTotals(i).total, 0);
  const paidCount = invoices.filter(i => i.status === 'paid').length;
  const overdueCount = invoices.filter(i => {
    if (i.status === 'paid' || i.status === 'void') return false;
    return i.dueDate && new Date(i.dueDate) < new Date();
  }).length;

  el.innerHTML = `
    <div class="animate-slide-in">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 class="text-2xl font-bold text-white">Invoices</h2>
          <p class="text-sm text-slate-400">${invoices.length} total &middot; create, print, email, or text invoices to clients</p>
        </div>
        <button onclick="openInvoiceEditor(null)" class="btn-primary px-4 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2 whitespace-nowrap">
          <i class="ph-bold ph-plus"></i> New Invoice
        </button>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div class="glass-card rounded-xl p-4">
          <p class="text-xs text-slate-400">Total Invoices</p>
          <p class="text-xl font-bold text-blue-400">${invoices.length}</p>
        </div>
        <div class="glass-card rounded-xl p-4">
          <p class="text-xs text-slate-400">Total Value</p>
          <p class="text-xl font-bold text-green-400">$${totalValue.toFixed(2)}</p>
        </div>
        <div class="glass-card rounded-xl p-4">
          <p class="text-xs text-slate-400">Paid</p>
          <p class="text-xl font-bold text-green-400">${paidCount}</p>
        </div>
        <div class="glass-card rounded-xl p-4">
          <p class="text-xs text-slate-400">Overdue</p>
          <p class="text-xl font-bold text-red-400">${overdueCount}</p>
        </div>
      </div>

      <div class="seg mb-4" role="tablist" aria-label="Filter invoices by status">
        ${['all', 'draft', 'sent', 'paid', 'overdue', 'void'].map(f => `
          <button onclick="_invSetFilter('${f}')" class="seg-btn${statusFilter === f ? ' active' : ''}" role="tab" aria-selected="${statusFilter === f}">${f}</button>
        `).join('')}
      </div>

      <div class="space-y-3">
        ${shown.length === 0 ? '<p class="text-center text-slate-500 py-12">No invoices' + (statusFilter !== 'all' ? ' with status: ' + statusFilter : ' yet — create your first one above') + '</p>' :
      shown.slice().reverse().map(inv => {
        const { total } = _invTotals(inv);
        return `
            <div class="glass-card rounded-xl p-4 cursor-pointer hover:border-blue-500/30 transition-all" onclick="openInvoiceDetail('${escId(inv.id)}')">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-3">
                  <span class="text-xs font-mono text-blue-400">${inv.number}</span>
                  ${_invStatusBadge(inv.status)}
                </div>
                <span class="text-xs text-slate-500">${_invFmtDate(inv.invoiceDate)} &middot; due ${_invFmtDate(inv.dueDate)}</span>
              </div>
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-white">${_invEsc(inv.customerName) || 'Unknown'}</p>
                  <p class="text-xs text-slate-400">${_invEsc(inv.vehicleInfo)}</p>
                </div>
                <p class="text-lg font-bold text-green-400">$${total.toFixed(2)}</p>
              </div>
            </div>
          `;
      }).join('')}
      </div>
    </div>
  `;
}

let _invActiveFilter = 'all';
function _invSetFilter(f) {
  _invActiveFilter = f;
  renderInvoices(document.getElementById('mainContent'));
}

// ==================== DETAIL VIEW (read-only + actions) ====================
function openInvoiceDetail(invId) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  const { subtotal, laborTotal, preTax, tax, total } = _invTotals(inv);
  const laborRows = _invLaborItems(inv);

  const modal = document.getElementById('modalContainer');
  const content = document.getElementById('modalContent');
  modal.classList.remove('hidden');

  content.innerHTML = `
    <div class="p-6 overflow-y-auto max-h-[85vh]">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-lg font-bold text-white">${inv.number}</h3>
          <p class="text-sm text-slate-400">${_invFmtDate(inv.invoiceDate)} ${_invStatusBadge(inv.status)}</p>
        </div>
        <button onclick="closeModal()" class="p-2 text-slate-400 hover:text-white"><i class="ph ph-x text-xl"></i></button>
      </div>

      <div class="glass-card rounded-lg p-3 mb-4">
        <p class="text-xs text-slate-400 mb-1">Bill To</p>
        <p class="text-sm text-white font-medium">${_invEsc(inv.customerName) || 'Unknown'}</p>
        <p class="text-xs text-slate-400">${_invEsc(inv.customerEmail)} ${inv.customerPhone ? '&middot; ' + _invEsc(inv.customerPhone) : ''}</p>
        <p class="text-xs text-slate-400">${_invEsc(inv.customerAddress)}${inv.customerCityStateZip ? ', ' + _invEsc(inv.customerCityStateZip) : ''}</p>
        ${inv.vehicleInfo ? `<p class="text-xs text-blue-400 mt-1">${_invEsc(inv.vehicleInfo)}</p>` : ''}
      </div>

      <p class="text-[11px] font-bold tracking-wider text-slate-400 mb-2">PARTS</p>
      <div class="space-y-2 mb-2">
        ${(inv.lineItems || []).map(li => `
          <div class="glass-card rounded-lg p-3 flex items-center justify-between">
            <div>
              <p class="text-sm text-white">${_invEsc(li.description) || 'Item'}</p>
              ${li.partNumber ? `<p class="text-xs text-slate-500 font-mono">${_invEsc(li.partNumber)}</p>` : ''}
            </div>
            <div class="text-right">
              <p class="text-xs text-slate-400">${li.qty} &times; $${Number(li.unitPrice).toFixed(2)}</p>
              <p class="text-sm font-bold text-white">$${(li.qty * li.unitPrice).toFixed(2)}</p>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="flex justify-between px-3 mb-4"><span class="text-xs text-slate-400">Total Products</span><span class="text-sm text-white">$${subtotal.toFixed(2)}</span></div>

      ${laborRows.length ? `
      <p class="text-[11px] font-bold tracking-wider text-slate-400 mb-2">LABOR</p>
      <div class="space-y-2 mb-2">
        ${laborRows.map(l => `
          <div class="glass-card rounded-lg p-3 flex items-center justify-between">
            <p class="text-sm text-white">${_invEsc(l.description) || 'Labor'}</p>
            <div class="text-right">
              <p class="text-xs text-slate-400">${_invNum(l.hours)}h &times; $${Number(l.rate).toFixed(2)}/hr</p>
              <p class="text-sm font-bold text-white">$${((Number(l.hours) || 0) * (Number(l.rate) || 0)).toFixed(2)}</p>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="flex justify-between px-3 mb-4"><span class="text-xs text-slate-400">Total Labor</span><span class="text-sm text-white">$${laborTotal.toFixed(2)}</span></div>` : ''}

      <div class="glass-card rounded-lg p-4 space-y-2 mb-5">
        <div class="flex justify-between"><span class="text-sm text-slate-400">Subtotal</span><span class="text-sm text-white">$${preTax.toFixed(2)}</span></div>
        ${inv.discount > 0 ? `<div class="flex justify-between"><span class="text-sm text-slate-400">Discount</span><span class="text-sm text-red-400">-$${Number(inv.discount).toFixed(2)}</span></div>` : ''}
        ${tax > 0 ? `<div class="flex justify-between"><span class="text-sm text-slate-400">Sales Tax (${inv.taxRate}%)</span><span class="text-sm text-white">$${tax.toFixed(2)}</span></div>` : ''}
        <div class="border-t border-slate-700 pt-2 flex justify-between"><span class="text-lg font-bold text-white">Total</span><span class="text-xl font-bold text-green-400">$${total.toFixed(2)}</span></div>
      </div>

      <button id="invShareBtn-${escId(inv.id)}" onclick="shareInvoiceRecord('${escId(inv.id)}')" class="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 mb-2">
        <i class="ph-bold ph-share-network"></i> Share Invoice
      </button>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <button onclick="generateInvoicePDF('${escId(inv.id)}', false)" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-download"></i> Download PDF</button>
        <button onclick="generateInvoicePDF('${escId(inv.id)}', true)" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-printer"></i> Print</button>
        <button onclick="emailInvoiceRecord('${escId(inv.id)}')" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-envelope"></i> Email</button>
        <button onclick="smsInvoiceRecord('${escId(inv.id)}')" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-chat-circle-text"></i> Text</button>
      </div>
      <div class="flex gap-2">
        <button onclick="openInvoiceEditor('${escId(inv.id)}')" class="btn-primary flex-1 py-2.5 rounded-lg text-sm font-semibold text-white">
          <i class="ph-bold ph-pencil-simple"></i> Edit
        </button>
        <select onchange="updateInvoiceStatus('${escId(inv.id)}', this.value)" class="glass-input px-3 py-2.5 rounded-lg text-sm text-white">
          ${['draft', 'sent', 'paid', 'overdue', 'void'].map(s => `<option value="${s}" ${inv.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <button onclick="deleteInvoiceRecord('${escId(inv.id)}')" class="btn-danger px-4 py-2.5 rounded-lg text-sm font-semibold text-white">
          <i class="ph-bold ph-trash"></i>
        </button>
      </div>
    </div>
  `;
}

function updateInvoiceStatus(invId, status) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  inv.status = status;
  inv.updatedAt = new Date().toISOString();
  db.auditLogs.unshift({ id: 'LOG' + Date.now(), timestamp: new Date().toISOString(), action: 'INVOICE_STATUS_CHANGED', detail: `${inv.number} marked ${status}`, user: 'Admin' });
  saveDB(db);
  showToast(`${inv.number} marked ${status}`, 'success');
  openInvoiceDetail(invId);
}

function deleteInvoiceRecord(invId) {
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  db.invoices = db.invoices.filter(i => i.id !== invId);
  if (inv) db.auditLogs.unshift({ id: 'LOG' + Date.now(), timestamp: new Date().toISOString(), action: 'INVOICE_DELETED', detail: `${inv.number} deleted`, user: 'Admin' });
  saveDB(db);
  closeModal();
  showToast('Invoice deleted', 'info');
  if (typeof currentView !== 'undefined' && currentView === 'invoices') renderView();
}

// ==================== EDITOR (create / edit) ====================
function openInvoiceEditor(invId) {
  const db = getDB();
  const s = getAppSettings();
  const existing = invId ? db.invoices.find(i => i.id === invId) : null;
  const inv = existing || {
    id: null,
    customerId: null,
    customerName: '', customerEmail: '', customerPhone: '', customerAddress: '', customerCityStateZip: '',
    vehicleInfo: '', poNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + (Number(s.invoiceDueDays) || 30) * 86400000).toISOString().split('T')[0],
    status: 'draft',
    lineItems: [{ description: '', partNumber: '', qty: 1, unitPrice: '' }],
    laborItems: [{ description: '', hours: '', rate: s.defaultLaborRate || 95 }],
    taxRate: s.defaultTax != null ? s.defaultTax : 8,
    discount: 0,
    notes: s.invoiceNotes || 'Thank you for your business!',
    terms: s.invoiceTerms || 'Payment due within 30 days of invoice date.'
  };
  const laborRows = existing ? _invLaborItems(existing) : inv.laborItems;

  const modal = document.getElementById('modalContainer');
  const content = document.getElementById('modalContent');
  modal.classList.remove('hidden');

  const custOptions = db.customers.map(c => `<option value="${c.id}" ${inv.customerId === c.id ? 'selected' : ''}>${_invEsc(c.name)}</option>`).join('');

  content.innerHTML = `
    <div class="p-6 overflow-y-auto max-h-[85vh]">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-lg font-bold text-white">${existing ? 'Edit ' + _invEsc(existing.number) : 'New Invoice'}</h3>
        <button onclick="closeModal()" class="p-2 text-slate-400 hover:text-white"><i class="ph ph-x text-xl"></i></button>
      </div>
      <form id="invoiceForm" onsubmit="saveInvoiceForm(event, '${inv.id || ''}')" class="space-y-4">
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Link to Customer (optional — auto-fills contact info)</label>
          <select id="inv_customerId" onchange="_invFillFromCustomer(this.value)" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">
            <option value="">Custom / one-off</option>
            ${custOptions}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Customer Name *</label><input id="inv_customerName" required value="${_invEsc(inv.customerName)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Email</label><input id="inv_customerEmail" type="email" value="${_invEsc(inv.customerEmail)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Phone</label><input id="inv_customerPhone" type="tel" value="${_invEsc(inv.customerPhone)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Vehicle</label><input id="inv_vehicleInfo" value="${_invEsc(inv.vehicleInfo)}" placeholder="2010 Honda Pilot 3.5L V6" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Street</label><input id="inv_customerAddress" value="${_invEsc(inv.customerAddress)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">City, State, ZIP</label><input id="inv_customerCSZ" value="${_invEsc(inv.customerCityStateZip)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Status</label>
            <select id="inv_status" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">
              ${['draft', 'sent', 'paid', 'overdue', 'void'].map(st => `<option value="${st}" ${inv.status === st ? 'selected' : ''}>${st.charAt(0).toUpperCase() + st.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div><label class="text-xs text-slate-400 mb-1 block">Invoice Date</label><input id="inv_invoiceDate" type="date" value="${inv.invoiceDate}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Due Date</label><input id="inv_dueDate" type="date" value="${inv.dueDate}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-slate-400">Parts</label>
            <button type="button" onclick="_invAddLine()" class="text-xs text-blue-400 flex items-center gap-1"><i class="ph-bold ph-plus"></i> Add part</button>
          </div>
          <div id="invLineItems" class="space-y-2">
            ${(inv.lineItems || []).map(li => _invLineRowHtml(li)).join('')}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-slate-400">Labor <span class="text-slate-500">(description &middot; hours &middot; $/hr)</span></label>
            <button type="button" onclick="_invAddLabor()" class="text-xs text-blue-400 flex items-center gap-1"><i class="ph-bold ph-plus"></i> Add labor</button>
          </div>
          <div id="invLaborItems" class="space-y-2">
            ${laborRows.map(l => _invLaborRowHtml(l)).join('')}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Sales Tax %</label><input id="inv_taxRate" type="number" step="0.01" min="0" value="${inv.taxRate}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Discount $</label><input id="inv_discount" type="number" step="0.01" min="0" value="${inv.discount}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
        </div>

        <div><label class="text-xs text-slate-400 mb-1 block">Notes to customer</label><textarea id="inv_notes" rows="2" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">${_invEsc(inv.notes)}</textarea></div>
        <div><label class="text-xs text-slate-400 mb-1 block">Terms</label><textarea id="inv_terms" rows="2" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">${_invEsc(inv.terms)}</textarea></div>

        <div class="flex gap-2 pt-2">
          <button type="submit" class="btn-primary flex-1 py-3 rounded-lg text-sm font-semibold text-white">
            <i class="ph-bold ph-check-circle"></i> Save Invoice
          </button>
          <button type="button" onclick="closeModal()" class="glass-input px-4 py-3 rounded-lg text-sm text-slate-300">Cancel</button>
        </div>
      </form>
    </div>
  `;
}

function _invLineRowHtml(li) {
  li = li || { description: '', partNumber: '', qty: 1, unitPrice: '' };
  return `
    <div class="inv-line-row grid grid-cols-12 gap-2 items-center">
      <input class="inv-li-desc col-span-5 glass-input px-2 py-2 rounded-lg text-xs text-white" placeholder="Description (type to search inventory)" autocomplete="off" value="${_invEsc(li.description)}">
      <input class="inv-li-part col-span-3 glass-input px-2 py-2 rounded-lg text-xs text-white" placeholder="Part #" autocomplete="off" value="${_invEsc(li.partNumber)}">
      <input class="inv-li-qty col-span-1 glass-input px-2 py-2 rounded-lg text-xs text-white" type="number" min="0" value="${li.qty || 1}">
      <input class="inv-li-price col-span-2 glass-input px-2 py-2 rounded-lg text-xs text-white" type="number" step="0.01" min="0" placeholder="0.00" value="${li.unitPrice || ''}">
      <button type="button" onclick="this.closest('.inv-line-row').remove()" class="col-span-1 text-slate-500 hover:text-red-400"><i class="ph ph-x"></i></button>
    </div>
  `;
}

function _invAddLine() {
  const wrap = document.getElementById('invLineItems');
  const div = document.createElement('div');
  div.innerHTML = _invLineRowHtml(null);
  wrap.appendChild(div.firstElementChild);
}

function _invLaborRowHtml(l) {
  const dflt = (typeof getAppSettings === 'function' && getAppSettings().defaultLaborRate) || 95;
  l = l || { description: '', hours: '', rate: dflt };
  return `
    <div class="inv-labor-row grid grid-cols-12 gap-2 items-center">
      <input class="inv-lb-desc col-span-6 glass-input px-2 py-2 rounded-lg text-xs text-white" placeholder="Description (e.g. Brake pad install)" value="${_invEsc(l.description)}">
      <input class="inv-lb-hours col-span-2 glass-input px-2 py-2 rounded-lg text-xs text-white" type="number" step="0.25" min="0" placeholder="Hrs" value="${l.hours || ''}">
      <input class="inv-lb-rate col-span-3 glass-input px-2 py-2 rounded-lg text-xs text-white" type="number" step="0.01" min="0" placeholder="$/hr" value="${l.rate === 0 || l.rate ? l.rate : dflt}">
      <button type="button" onclick="this.closest('.inv-labor-row').remove()" class="col-span-1 text-slate-500 hover:text-red-400"><i class="ph ph-x"></i></button>
    </div>
  `;
}

function _invAddLabor() {
  const wrap = document.getElementById('invLaborItems');
  const div = document.createElement('div');
  div.innerHTML = _invLaborRowHtml(null);
  wrap.appendChild(div.firstElementChild);
}

function _invFillFromCustomer(custId) {
  if (!custId) return;
  const db = getDB();
  const cust = db.customers.find(c => c.id === custId);
  if (!cust) return;
  document.getElementById('inv_customerName').value = cust.name || '';
  document.getElementById('inv_customerEmail').value = cust.email || '';
  document.getElementById('inv_customerPhone').value = cust.phone || '';
  const [street, csz] = _invSplitAddress(cust.address);
  document.getElementById('inv_customerAddress').value = street;
  document.getElementById('inv_customerCSZ').value = csz;
  const v = db.vehicles.find(vh => vh.customerId === custId);
  if (v) document.getElementById('inv_vehicleInfo').value = `${v.year} ${v.make} ${v.model}`;
}

function saveInvoiceForm(event, existingId) {
  event.preventDefault();
  const db = getDB();

  // Note: a freshly-added blank row still shows qty=1 as a UI default, so
  // "qty is set" alone isn't a reliable signal of a real line item — require
  // an actual description or a nonzero price instead.
  const lineItems = Array.from(document.querySelectorAll('#invLineItems .inv-line-row')).map(row => ({
    description: row.querySelector('.inv-li-desc').value.trim(),
    partNumber: row.querySelector('.inv-li-part').value.trim(),
    qty: Number(row.querySelector('.inv-li-qty').value) || 0,
    unitPrice: Number(row.querySelector('.inv-li-price').value) || 0
  })).filter(li => li.description || li.unitPrice > 0);

  // Same rule as parts: a blank row still carries the default rate, so only
  // keep rows with a description or some hours.
  const laborItems = Array.from(document.querySelectorAll('#invLaborItems .inv-labor-row')).map(row => ({
    description: row.querySelector('.inv-lb-desc').value.trim(),
    hours: Number(row.querySelector('.inv-lb-hours').value) || 0,
    rate: Number(row.querySelector('.inv-lb-rate').value) || 0
  })).filter(l => l.description || l.hours > 0);

  if (lineItems.length === 0 && laborItems.length === 0) {
    showToast('Add at least one part or labor line', 'warning');
    return;
  }
  const totalHours = laborItems.reduce((a, l) => a + l.hours, 0);
  const totalLabor = laborItems.reduce((a, l) => a + l.hours * l.rate, 0);

  const formData = {
    customerId: document.getElementById('inv_customerId').value || null,
    customerName: document.getElementById('inv_customerName').value,
    customerEmail: document.getElementById('inv_customerEmail').value,
    customerPhone: document.getElementById('inv_customerPhone').value,
    customerAddress: document.getElementById('inv_customerAddress').value,
    customerCityStateZip: document.getElementById('inv_customerCSZ').value,
    vehicleInfo: document.getElementById('inv_vehicleInfo').value,
    status: document.getElementById('inv_status').value,
    invoiceDate: document.getElementById('inv_invoiceDate').value,
    dueDate: document.getElementById('inv_dueDate').value,
    lineItems: lineItems,
    laborItems: laborItems,
    // legacy summary fields (older code/exports read these)
    laborHours: totalHours,
    laborRate: totalHours ? Math.round((totalLabor / totalHours) * 100) / 100 : 0,
    taxRate: Number(document.getElementById('inv_taxRate').value) || 0,
    discount: Number(document.getElementById('inv_discount').value) || 0,
    notes: document.getElementById('inv_notes').value,
    terms: document.getElementById('inv_terms').value
  };

  if (!db.invoices) db.invoices = [];

  if (existingId) {
    const idx = db.invoices.findIndex(i => i.id === existingId);
    if (idx >= 0) {
      db.invoices[idx] = Object.assign({}, db.invoices[idx], formData, { updatedAt: new Date().toISOString() });
      db.auditLogs.unshift({ id: 'LOG' + Date.now(), timestamp: new Date().toISOString(), action: 'INVOICE_UPDATED', detail: `${db.invoices[idx].number} updated`, user: 'Admin' });
    }
  } else {
    const newInv = Object.assign({}, formData, {
      id: _invGenId(),
      number: _invNextNumber(db),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    db.invoices.push(newInv);
    db.auditLogs.unshift({ id: 'LOG' + Date.now(), timestamp: new Date().toISOString(), action: 'INVOICE_CREATED', detail: `${newInv.number} created for ${newInv.customerName}`, user: 'Admin' });
  }

  saveDB(db);
  closeModal();
  showToast(existingId ? 'Invoice updated' : 'Invoice created', 'success');
  if (typeof currentView !== 'undefined' && currentView === 'invoices') renderView();
}

// ==================== CREATE FROM AN EXISTING SALE ====================
// Called from the Customer Profile modal and the Sale Detail modal.
function createInvoiceFromSale(saleId) {
  const db = getDB();
  const sale = db.sales.find(s => s.id === saleId);
  if (!sale) return;
  const cust = db.customers.find(c => c.id === sale.customerId);
  const v = db.vehicles.find(vh => vh.id === sale.vehicleId);
  const s = getAppSettings();

  const draft = {
    id: null,
    customerId: sale.customerId,
    customerName: cust ? cust.name : '',
    customerEmail: cust ? cust.email : '',
    customerPhone: cust ? cust.phone : '',
    customerAddress: cust ? _invSplitAddress(cust.address)[0] : '',
    customerCityStateZip: cust ? _invSplitAddress(cust.address)[1] : '',
    vehicleInfo: v ? `${v.year} ${v.make} ${v.model}` : '',
    poNumber: sale.id,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + (Number(s.invoiceDueDays) || 30) * 86400000).toISOString().split('T')[0],
    status: sale.status === 'Completed' ? 'paid' : 'draft',
    lineItems: (sale.lineItems || []).map(li => ({ description: li.name, partNumber: li.partNumber, qty: li.qty, unitPrice: li.unitPrice })),
    laborItems: (Number(sale.laborHours) || 0) > 0
      ? [{ description: 'Labor', hours: Number(sale.laborHours), rate: Number(sale.laborRate) || s.defaultLaborRate || 95 }]
      : [],
    taxRate: s.defaultTax != null ? s.defaultTax : 8,
    discount: 0,
    notes: s.invoiceNotes || 'Thank you for your business!',
    terms: s.invoiceTerms || 'Payment due within 30 days of invoice date.'
  };

  // Stash on a temp global so openInvoiceEditor's "new" path can pick it up.
  _invPendingPrefill = draft;
  closeModal();
  openInvoiceEditor(null);
}

let _invPendingPrefill = null;
// Wrap the editor once at load time so any pending prefill is applied transparently.
(function () {
  const originalOpenEditor = openInvoiceEditor;
  openInvoiceEditor = function (invId) {
    originalOpenEditor(invId);
    if (!invId && _invPendingPrefill) {
      const p = _invPendingPrefill;
      _invPendingPrefill = null;
      document.getElementById('inv_customerName').value = p.customerName || '';
      document.getElementById('inv_customerEmail').value = p.customerEmail || '';
      document.getElementById('inv_customerPhone').value = p.customerPhone || '';
      document.getElementById('inv_customerAddress').value = p.customerAddress || '';
      document.getElementById('inv_customerCSZ').value = p.customerCityStateZip || '';
      document.getElementById('inv_vehicleInfo').value = p.vehicleInfo || '';
      document.getElementById('inv_status').value = p.status || 'draft';
      const lw = document.getElementById('invLaborItems');
      lw.innerHTML = (p.laborItems && p.laborItems.length ? p.laborItems : [null]).map(l => _invLaborRowHtml(l)).join('');
      const wrap = document.getElementById('invLineItems');
      wrap.innerHTML = (p.lineItems || []).map(li => _invLineRowHtml(li)).join('');
      if (p.customerId) document.getElementById('inv_customerId').value = p.customerId;
    }
  };
})();

// ==================== PDF / PRINT ====================
// Builds the jsPDF document for an invoice. Shared by download/print
// (generateInvoicePDF) and the native share sheet (shareInvoiceRecord) so
// there's exactly one place that lays out the PDF.
// Zempel Auto brand palette. Black + steel blue come straight from the logo artwork
// (assets/z-auto-9.jpeg); change them here to re-skin the whole invoice.
const INV_PDF = {
  black: [14, 16, 15],        // header band + TOTAL bar (matches the logo background)
  accent: [32, 84, 114],      // steel blue: table headers, box borders, base strip
  accentLt: [96, 160, 198],   // lighter blue for rules/details on the black band
  tint: [221, 232, 239],      // pale blue behind the summary cells
  ink: [38, 42, 46],
  grid: [140, 150, 158],
  zebra: [236, 240, 243],
  muted: [110, 116, 122]
};

// Shrinks the font until `text` fits `maxW`, never below `minSize`.
function _invFitText(doc, text, maxW, size, minSize) {
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(text) > maxW) { size -= 0.5; doc.setFontSize(size); }
  return size;
}

function _invBuildPDFDoc(inv) {
  if (typeof window.jspdf === 'undefined') { showToast('PDF library not loaded', 'danger'); return null; }

  const C = INV_PDF;
  const { subtotal, laborTotal, preTax, tax, total } = _invTotals(inv);
  const s = getAppSettings();
  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  const PW = doc.internal.pageSize.getWidth();     // 215.9
  const PH = doc.internal.pageSize.getHeight();    // 279.4
  const M = 10, CW = PW - M * 2;
  const COL = [33.5, 95.5, 32, CW - 33.5 - 95.5 - 32];   // qty/hrs, description, unit price, amount
  const XP = M + COL[0] + COL[1];                         // left edge of the unit-price column
  const ROW = 5.5;
  const MIN_PART_ROWS = 5, MIN_LABOR_ROWS = 5;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.ink);

  // ---------------- Header band (Zempel Auto branding) ----------------
  const HY = 9, HH = 38, STRIP = 2.2;
  doc.setFillColor(...C.black);
  doc.rect(M, HY, CW, HH, 'F');
  doc.setFillColor(...C.accent);
  doc.rect(M, HY + HH, CW, STRIP, 'F');        // blue base strip, echoing the logo artwork

  const shop = s.bizName || 'Zempel Auto';
  const LOGO = window.ZEMPEL_LOGO_PNG;
  let logoDrawn = false;
  if (LOGO) {
    const lh = 29, lw = lh * LOGO.w / LOGO.h;
    try { doc.addImage(LOGO.data, 'PNG', M + 7, HY + (HH - lh) / 2, lw, lh); logoDrawn = true; } catch (e) { console.warn('Invoice logo failed:', e); }
  }
  if (!logoDrawn) {                              // text fallback if the logo asset is missing
    doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(255, 255, 255);
    doc.text(shop.toUpperCase(), M + 7, HY + HH / 2 + 3);
  }

  const RX = M + CW - 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(255, 255, 255);
  doc.text('INVOICE', RX, HY + 14.5, { align: 'right' });
  doc.setFillColor(...C.accentLt);
  doc.rect(RX - 30, HY + 17.5, 30, 0.7, 'F');

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(205, 210, 214);
  const contact = [
    [s.bizPhone, s.bizFax ? 'Fax ' + s.bizFax : ''].filter(Boolean).join('   |   '),
    [s.bizEmail, s.bizWebsite].filter(Boolean).join('   |   '),
    s.bizAddress || ''
  ];
  contact.forEach((line, i) => { if (line) doc.text(String(line), RX, HY + 23.5 + i * 5, { align: 'right' }); });

  // ---------------- Bill-to box ----------------
  const BY = HY + HH + STRIP + 3, BH = 52;
  doc.setDrawColor(...C.accent); doc.setLineWidth(0.9);
  doc.rect(M, BY, CW, BH, 'S');

  const rowY = i => BY + 9 + i * 9.5;
  const LX = M + 4, LW = 48.5, MX = M + 59, MW = 84;
  const field = (label, value, x, w, y, underline) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
    doc.text(label, x, y);
    const lw = doc.getTextWidth(label) + 1.5;
    if (value) {
      doc.setFontSize(9.5);
      _invFitText(doc, String(value), w - lw, 9.5, 6.5);
      doc.text(String(value), x + lw, y);
    }
    if (underline) {
      doc.setDrawColor(...C.ink); doc.setLineWidth(0.25);
      doc.line(x, y + 1.9, x + w, y + 1.9);
    }
  };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...C.ink);
  doc.text('BILL TO', LX, rowY(0));
  field('Invoice Number:', inv.number, LX, LW, rowY(1), true);
  field('Date Issued:', _invFmtDate(inv.invoiceDate), LX, LW, rowY(2), true);
  field('Due Date:', _invFmtDate(inv.dueDate), LX, LW, rowY(3), true);
  field('Status:', (inv.status || 'draft').toUpperCase(), LX, LW, rowY(4), false);

  let street = inv.customerAddress || '', csz = inv.customerCityStateZip || '';
  if (!csz) { const sp = _invSplitAddress(street); street = sp[0]; csz = sp[1]; }
  field('Name:', inv.customerName || 'Unknown', MX, MW, rowY(0), true);
  field('Street:', street, MX, MW, rowY(1), true);
  field('City, State, ZIP:', csz, MX, MW, rowY(2), true);
  field('Phone:', inv.customerPhone || '', MX, MW, rowY(3), true);
  field('Vehicle:', inv.vehicleInfo || '', MX, MW, rowY(4), false);

  // Invoice total call-out
  const TX = M + 147.5, TW = CW - 147.5 - 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...C.ink);
  doc.text('INVOICE TOTAL', TX + TW / 2, rowY(0), { align: 'center' });
  doc.setDrawColor(...C.accent); doc.setLineWidth(0.5);
  doc.rect(TX, BY + 13, TW, 34, 'S');
  const totalStr = '$' + _invMoney(total);
  _invFitText(doc, totalStr, TW - 4, 24, 11);
  doc.text(totalStr, TX + TW / 2, BY + 13 + 21, { align: 'center' });

  // ---------------- Tables ----------------
  const centerLabel = (txt, y) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C.ink);
    doc.text(txt, PW / 2, y, { align: 'center' });
  };
  const blanks = n => Array.from({ length: Math.max(0, n) }, () => ['', '', '', '']);

  const drawTable = (head, body, startY) => {
    doc.autoTable({
      startY,
      margin: { left: M, right: M, top: 12, bottom: 15 },
      tableWidth: CW,
      head: [head],
      body,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, textColor: C.ink, lineColor: C.grid, lineWidth: 0.2,
        cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 }, minCellHeight: ROW, valign: 'middle' },
      headStyles: { fillColor: C.accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.5, halign: 'center' },
      columnStyles: {
        0: { cellWidth: COL[0], halign: 'center' },
        1: { cellWidth: COL[1] },
        2: { cellWidth: COL[2], halign: 'right' },
        3: { cellWidth: COL[3], halign: 'right' }
      },
      didParseCell: d => {
        if (d.section === 'body') d.cell.styles.fillColor = d.row.index % 2 ? C.zebra : [255, 255, 255];
      }
    });
    return doc.lastAutoTable.finalY;
  };

  // Right-aligned summary cells that sit under the Unit Price / Amount columns.
  const sumRow = (y, label, value, dark) => {
    const fill = dark ? C.black : C.tint;
    doc.setFillColor(...fill); doc.setDrawColor(...C.grid); doc.setLineWidth(0.2);
    doc.rect(XP, y, COL[2], ROW, 'FD');
    doc.rect(XP + COL[2], y, COL[3], ROW, 'FD');
    doc.setFont('helvetica', dark ? 'bold' : 'normal'); doc.setFontSize(dark ? 10 : 9.5);
    doc.setTextColor(...(dark ? [255, 255, 255] : C.ink));
    doc.text(label, XP + COL[2] / 2, y + ROW / 2 + 1.3, { align: 'center' });
    doc.text(value, XP + COL[2] + COL[3] - 2, y + ROW / 2 + 1.3, { align: 'right' });
    doc.setTextColor(...C.ink);
    return y + ROW;
  };
  const needSpace = (y, h) => { if (y + h > PH - 15) { doc.addPage(); return 14; } return y; };

  // PARTS
  const parts = (inv.lineItems || []).map(li => {
    const desc = (li.description || '') + (li.partNumber ? (li.description ? '   ' : '') + '#' + li.partNumber : '');
    const q = Number(li.qty) || 0, p = Number(li.unitPrice) || 0;
    return [_invNum(q), desc, '$' + _invMoney(p), '$' + _invMoney(q * p)];
  });
  let y = BY + BH + 7;
  centerLabel('PARTS', y);
  y = drawTable(['Quantity', 'Part Description', 'Unit Price', 'Amount'],
    parts.concat(blanks(MIN_PART_ROWS - parts.length)), y + 2);
  y = needSpace(y, ROW);
  y = sumRow(y, 'Total Products', '$' + _invMoney(subtotal), false);

  // LABOR
  const labor = _invLaborItems(inv).map(l => {
    const h = Number(l.hours) || 0, r = Number(l.rate) || 0;
    return [_invNum(h), l.description || '', '$' + _invMoney(r), '$' + _invMoney(h * r)];
  });
  y = needSpace(y + 6, 6 + 2 + ROW * 3);
  centerLabel('LABOR', y);
  y = drawTable(['Hour', 'Description', '$ / Hour', 'Amount'],
    labor.concat(blanks(MIN_LABOR_ROWS - labor.length)), y + 2);

  // Summary: Total Labor / Subtotal / [Discount] / Sales Tax / TOTAL
  const disc = Number(inv.discount) || 0;
  const sumCount = 4 + (disc > 0 ? 1 : 0);
  y = needSpace(y, ROW * sumCount);
  y = sumRow(y, 'Total Labor', '$' + _invMoney(laborTotal), false);
  y = sumRow(y, 'Subtotal', '$' + _invMoney(preTax), false);
  if (disc > 0) y = sumRow(y, 'Discount', '-$' + _invMoney(disc), false);
  y = sumRow(y, 'Sales Tax' + (inv.taxRate ? ' (' + _invNum(inv.taxRate) + '%)' : ''), '$' + _invMoney(tax), false);
  y = sumRow(y, 'TOTAL', '$' + _invMoney(total), true);

  // ---------------- Footer ----------------
  let days = Number(s.invoiceDueDays) || 30;
  if (inv.invoiceDate && inv.dueDate) {
    const d = Math.round((new Date(inv.dueDate + 'T00:00:00') - new Date(inv.invoiceDate + 'T00:00:00')) / 86400000);
    if (!isNaN(d) && d >= 0) days = d;
  }
  const termsLine = inv.terms && !/^payment due within \d+ days/i.test(inv.terms.trim()) ? inv.terms : '';
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const label = 'Comments or Special Instructions:';
  const cx = M + 2 + doc.getTextWidth(label) + 2;
  // First note line shares the label's row; wrapped lines flow underneath, each ruled like the reference.
  const first = doc.splitTextToSize(inv.notes || '', M + CW - cx).slice(0, 1)[0] || '';
  const rest = inv.notes ? doc.splitTextToSize(inv.notes.slice(first.length).trim(), CW - 4).filter(Boolean) : [];
  const termsLines = termsLine ? doc.splitTextToSize('Terms: ' + termsLine, CW - 4) : [];
  const footH = 7 + 5.5 * Math.max(1, rest.length) + (termsLines.length ? 3 + termsLines.length * 3.5 : 0) + (inv.poNumber ? 6 : 0) + 2;
  y += 5;
  if (y + footH > PH - 15) { doc.addPage(); y = 16; }

  doc.setTextColor(...C.ink);
  doc.text(days > 0 ? `Payment is due within ${days} days.` : 'Payment is due upon receipt.', M + 2, y);
  doc.setDrawColor(...C.ink); doc.setLineWidth(0.25);
  doc.line(M, y + 2, XP, y + 2);
  y += 7;
  doc.text(label, M + 2, y);
  doc.text(first, cx, y);
  doc.line(cx, y + 1.9, M + CW, y + 1.9);
  rest.forEach(l => { y += 5.5; doc.text(l, M + 2, y); doc.line(M, y + 1.9, M + CW, y + 1.9); });
  if (!rest.length) { y += 5.5; doc.line(M, y + 1.9, M + CW, y + 1.9); }

  doc.setFontSize(7.5); doc.setTextColor(...C.muted);
  if (termsLines.length) { y += 6; doc.text(termsLines, M + 2, y); y += (termsLines.length - 1) * 3.5; }
  if (inv.poNumber) { y += 6; doc.text('Ref: ' + inv.poNumber, M + 2, y); }

  const pages = doc.getNumberOfPages();
  const brandLine = [shop, s.bizPhone, s.bizEmail, s.bizWebsite].filter(Boolean).join('   |   ');
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...C.accent); doc.rect(M, PH - 12.5, CW, 0.6, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.muted);
    doc.text(brandLine, PW / 2, PH - 8, { align: 'center' });
    if (pages > 1) doc.text(`${inv.number}  -  Page ${p} of ${pages}`, PW / 2, PH - 4.5, { align: 'center' });
  }
  return doc;
}

function generateInvoicePDF(invId, autoPrint) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  const doc = _invBuildPDFDoc(inv);
  if (!doc) return;

  if (autoPrint) {
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
  } else {
    doc.save(inv.number + '.pdf');
    showToast('Invoice PDF downloaded', 'success');
  }
}

// ==================== SHARE / EMAIL / SMS ====================
// Primary path: native share sheet (Web Share API), which lets the user pick
// Email, Messages/SMS, WhatsApp, AirDrop, or any other installed app, and
// attaches the actual PDF file — not just a link. Supported on iOS Safari,
// Android Chrome, and modern desktop Chrome/Edge on Windows/macOS.
// Falls back to the mailto:/sms: draft-and-attach flow below on browsers
// that don't support sharing files (e.g. Firefox, older Safari).
async function shareInvoiceRecord(invId) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  const { total } = _invTotals(inv);
  const s = getAppSettings();
  const shareText = `Invoice ${inv.number} from ${s.bizName || 'Zempel Auto'} — $${total.toFixed(2)}, due ${_invFmtDate(inv.dueDate)}.`;

  const canTryFileShare = !!(navigator.share && navigator.canShare);
  if (canTryFileShare) {
    const doc = _invBuildPDFDoc(inv);
    if (doc) {
      try {
        const blob = doc.output('blob');
        const file = new File([blob], `${inv.number}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Invoice ${inv.number}`,
            text: shareText,
            files: [file]
          });
          showToast('Invoice shared', 'success');
          return;
        }
      } catch (err) {
        // AbortError = user cancelled the share sheet, not a failure — just stop quietly.
        if (err && err.name === 'AbortError') return;
        console.warn('[shareInvoiceRecord] navigator.share failed, falling back:', err);
      }
    }
  }

  // Fallback: no file-sharing support — download the PDF and offer the
  // existing Email/Text draft options so the user can attach it manually.
  generateInvoicePDF(invId, false);
  showToast('Sharing not supported here — PDF downloaded. Use Email or Text below to send it.', 'info');
}

// Neither mailto: nor sms: links can attach a file — that's a browser/OS
// limitation, not something fixable client-side. We prefill the message and
// tell the user to attach the PDF they just downloaded.
function emailInvoiceRecord(invId) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  const { total } = _invTotals(inv);
  const s = getAppSettings();
  const subject = encodeURIComponent(`Invoice ${inv.number} from ${s.bizName || 'Zempel Auto'}`);
  const body = encodeURIComponent(
    `Hi ${inv.customerName || ''},\n\nYour invoice ${inv.number} for $${total.toFixed(2)} is ready. Due ${_invFmtDate(inv.dueDate)}.\n\n${inv.notes || ''}\n\n${s.bizName || 'Zempel Auto'}\n${s.bizPhone || ''} ${s.bizEmail || ''}`
  );
  generateInvoicePDF(invId, false);
  showToast('PDF downloaded — attach it in the email that just opened', 'info');
  window.location.href = `mailto:${inv.customerEmail || ''}?subject=${subject}&body=${body}`;
}

function smsInvoiceRecord(invId) {
  const db = getDB();
  const inv = db.invoices.find(i => i.id === invId);
  if (!inv) return;
  const { total } = _invTotals(inv);
  const s = getAppSettings();
  const msg = encodeURIComponent(
    `${s.bizName || 'Zempel Auto'}: Invoice ${inv.number} for $${total.toFixed(2)} is ready, due ${_invFmtDate(inv.dueDate)}. Questions? ${s.bizPhone || s.bizEmail || ''}`
  );
  window.location.href = `sms:${inv.customerPhone || ''}?body=${msg}`;
}

// ==================== PART LOOKUP (autocomplete on invoice part lines) ====================
// Typing in a part's Description or Part # box searches, in order:
//   1. Your inventory (instant, offline)             -> fills description, part #, price
//   2. Your price book (db.retailerPrices)           -> same, for parts you price-checked but don't stock
//   3. A supplier catalog (optional, off by default) -> e.g. PartsTech, via a Worker route
//
// Source 3 is only queried when app setting `partsLookupEnabled` is true. It expects
//   GET {base}/v1/parts/search?q=<text>
//   -> { results: [{ description, partNumber, brand, supplier, price, available }] }
// where `price` is the figure to put on the invoice (the adapter applies any markup) and
// `base` is window.__PARTS_LOOKUP_URL, falling back to the same Worker the RockAuto module uses.
// Supplier API keys stay on the Worker, never in this file.
const _invLookup = { menu: null, input: null, items: [], active: -1, token: 0, timer: null, abort: null };

function _invNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function _invSearchLocal(q) {
  const db = getDB();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const qn = _invNorm(q);
  const matches = hay => words.every(w => hay.includes(w)) || (qn.length >= 3 && _invNorm(hay).includes(qn));
  const rankOf = pn => { const n = _invNorm(pn); return n && n === qn ? 0 : n && n.startsWith(qn) ? 1 : 2; };
  const out = [], seen = new Set();

  (db.inventory || []).forEach(p => {
    const hay = [p.partNumber, p.name, p.brand, p.barcode, p.category].join(' ').toLowerCase();
    if (!matches(hay)) return;
    seen.add(_invNorm(p.partNumber));
    out.push({ src: 'Inventory', rank: rankOf(p.partNumber), description: p.name || '', partNumber: p.partNumber || '',
      brand: p.brand || '', price: Number(p.price) || 0, stock: Number(p.stock) });
  });
  (db.retailerPrices || []).forEach(r => {
    if (!r || seen.has(_invNorm(r.partNumber))) return;
    if (!matches([r.partNumber, r.name].join(' ').toLowerCase())) return;
    const market = [r.rockauto, r.oreilly, r.napa, r.autozone, r.advance, r.carquest].map(Number).filter(n => n > 0);
    out.push({ src: 'Price book', rank: rankOf(r.partNumber) + 0.5, description: r.name || '', partNumber: r.partNumber || '',
      brand: '', price: Number(r.ourPrice) || 0, marketLow: market.length ? Math.min.apply(null, market) : 0 });
  });
  out.sort((a, b) => a.rank - b.rank || (b.stock > 0) - (a.stock > 0));
  return out.slice(0, 8);
}

function _invExternalEnabled() {
  try { return !!getAppSettings().partsLookupEnabled; } catch (e) { return false; }
}

async function _invSearchExternal(q, signal) {
  const base = window.__PARTS_LOOKUP_URL || (typeof RockAutoFetch !== 'undefined' && RockAutoFetch.CONFIG.baseUrl);
  if (!base) return [];
  const res = await fetch(new URL('/v1/parts/search', base).toString() + '?q=' + encodeURIComponent(q),
    { signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!res.ok) return [];
  const j = await res.json();
  return (Array.isArray(j.results) ? j.results : []).slice(0, 8).map(r => ({
    src: String(r.supplier || 'Supplier'), description: String(r.description || ''), partNumber: String(r.partNumber || ''),
    brand: String(r.brand || ''), price: Number(r.price) || 0, available: r.available
  }));
}

function _invLookupHide() {
  if (_invLookup.menu) { _invLookup.menu.remove(); _invLookup.menu = null; }
  _invLookup.items = []; _invLookup.active = -1; _invLookup.token++;
  if (_invLookup.abort) { _invLookup.abort.abort(); _invLookup.abort = null; }
}

function _invLookupRender(row, items, footer) {
  if (!_invLookup.menu) {
    const m = document.createElement('div');
    m.id = 'invLookupMenu';
    m.setAttribute('role', 'listbox');
    m.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:80;margin-top:4px;max-height:260px;overflow-y:auto;' +
      'background:#0f172a;border:1px solid #334155;border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.55)';
    m.addEventListener('mousedown', ev => {            // mousedown (not click) so the input doesn't blur first
      const el = ev.target.closest('[data-i]');
      if (!el) return;
      ev.preventDefault();
      _invLookupPick(Number(el.dataset.i));
    });
    row.style.position = 'relative';
    row.appendChild(m);
    _invLookup.menu = m;
  }
  const m = _invLookup.menu;
  m.textContent = '';
  _invLookup.items = items;
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.dataset.i = i;
    d.setAttribute('role', 'option');
    d.style.cssText = 'padding:8px 10px;cursor:pointer;border-bottom:1px solid #1e293b;' + (i === _invLookup.active ? 'background:#1e293b;' : '');
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#fff';
    const name = document.createElement('span'); name.textContent = it.description || it.partNumber || 'Part';
    const price = document.createElement('span');
    price.style.cssText = 'color:#4ade80;font-weight:600;white-space:nowrap';
    price.textContent = it.price > 0 ? '$' + it.price.toFixed(2) : '';
    top.append(name, price);
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:2px';
    const bits = [it.partNumber, it.brand, it.src];
    if (it.src === 'Inventory' && isFinite(it.stock)) bits.push(it.stock > 0 ? it.stock + ' in stock' : 'OUT OF STOCK');
    if (it.marketLow) bits.push('market low $' + it.marketLow.toFixed(2));
    if (it.available === false) bits.push('unavailable');
    sub.textContent = bits.filter(Boolean).join('  \u00b7  ');
    if (it.src === 'Inventory' && isFinite(it.stock) && it.stock <= 0) sub.style.color = '#f87171';
    d.append(top, sub);
    m.appendChild(d);
  });
  if (footer) {
    const f = document.createElement('div');
    f.style.cssText = 'padding:7px 10px;font-size:11px;color:#64748b';
    f.textContent = footer;
    m.appendChild(f);
  }
  if (!items.length && !footer) _invLookupHide();
}

function _invLookupPick(i) {
  const it = _invLookup.items[i], input = _invLookup.input;
  if (!it || !input) return;
  const row = input.closest('.inv-line-row');
  _invLookupHide();
  if (!row) return;
  row.querySelector('.inv-li-desc').value = it.description;
  row.querySelector('.inv-li-part').value = it.partNumber;
  if (it.price > 0) row.querySelector('.inv-li-price').value = it.price.toFixed(2);
  const qty = row.querySelector('.inv-li-qty');
  if (!Number(qty.value)) qty.value = 1;
  if (it.src === 'Inventory' && isFinite(it.stock) && it.stock <= 0) showToast(it.partNumber + ' shows 0 in stock', 'warning');
  qty.focus(); qty.select();
}

async function _invLookupRun(input) {
  const row = input.closest('.inv-line-row');
  const q = input.value.trim();
  if (!row || q.length < 2) { _invLookupHide(); return; }
  _invLookup.input = input;
  const token = ++_invLookup.token;
  if (_invLookup.abort) { _invLookup.abort.abort(); _invLookup.abort = null; }

  const local = _invSearchLocal(q);
  _invLookup.active = -1;
  const external = _invExternalEnabled();
  _invLookupRender(row, local, external ? 'Searching supplier catalog\u2026' : (local.length ? '' : 'No match in inventory \u2014 keep typing to enter it manually'));
  if (!external) return;

  const ctrl = new AbortController();
  _invLookup.abort = ctrl;
  try {
    const remote = await _invSearchExternal(q, ctrl.signal);
    if (token !== _invLookup.token) return;                 // a newer keystroke superseded this search
    _invLookupRender(row, local.concat(remote), remote.length ? '' : 'No supplier results');
  } catch (e) {
    if (token !== _invLookup.token || (e && e.name === 'AbortError')) return;
    _invLookupRender(row, local, 'Supplier catalog unavailable');
  }
}

(function bindInvoiceLookup() {
  if (typeof document === 'undefined' || document.__invLookupBound) return;
  document.__invLookupBound = true;
  const isPartInput = el => el && el.matches && el.matches('.inv-li-desc, .inv-li-part');
  document.addEventListener('input', ev => {
    if (!isPartInput(ev.target)) return;
    clearTimeout(_invLookup.timer);
    const delay = _invExternalEnabled() ? 300 : 80;
    _invLookup.timer = setTimeout(() => _invLookupRun(ev.target), delay);
  });
  document.addEventListener('keydown', ev => {
    if (!_invLookup.menu || !isPartInput(ev.target)) return;
    const n = _invLookup.items.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!n) return;
      ev.preventDefault();
      _invLookup.active = ev.key === 'ArrowDown' ? Math.min(n - 1, _invLookup.active + 1) : Math.max(0, _invLookup.active - 1);
      Array.from(_invLookup.menu.querySelectorAll('[data-i]')).forEach((el, i) => {
        el.style.background = i === _invLookup.active ? '#1e293b' : '';
        if (i === _invLookup.active) el.scrollIntoView({ block: 'nearest' });
      });
    } else if (ev.key === 'Enter' && _invLookup.active >= 0) {
      ev.preventDefault();                                   // pick the highlighted match instead of submitting the form
      _invLookupPick(_invLookup.active);
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      _invLookupHide();
    }
  }, true);
  document.addEventListener('mousedown', ev => {
    if (_invLookup.menu && !_invLookup.menu.contains(ev.target) && !isPartInput(ev.target)) _invLookupHide();
  });
})();

// ==================== SETTINGS CARD ====================
// Returns an HTML string meant to be injected into renderSettings()'s grid.
function invoiceSettingsCardHtml() {
  const s = getAppSettings();
  return `
    <div class="glass-card rounded-2xl p-6">
      <h3 class="text-base font-bold text-white mb-5 flex items-center gap-2">
        <i class="ph-bold ph-receipt text-cyan-400"></i> Invoicing
      </h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Default due period (days)</label>
          <input id="inv_set_dueDays" type="number" min="1" value="${s.invoiceDueDays || 30}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Default notes to customer</label>
          <textarea id="inv_set_notes" rows="2" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">${s.invoiceNotes || 'Thank you for your business!'}</textarea>
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Default terms</label>
          <textarea id="inv_set_terms" rows="2" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">${s.invoiceTerms || 'Payment due within 30 days of invoice date.'}</textarea>
        </div>
        <p class="text-[11px] text-slate-500">Business name, logo, phone, email, address, and tax rate come from your Business Profile above — invoices reuse those automatically.</p>
        <button onclick="saveInvoiceSettings()" class="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white mt-1">Save Invoice Defaults</button>
      </div>
    </div>
  `;
}

function saveInvoiceSettings() {
  saveAppSettings({
    invoiceDueDays: parseInt(document.getElementById('inv_set_dueDays').value) || 30,
    invoiceNotes: document.getElementById('inv_set_notes').value,
    invoiceTerms: document.getElementById('inv_set_terms').value
  });
  showToast('Invoice defaults saved', 'success');
}
