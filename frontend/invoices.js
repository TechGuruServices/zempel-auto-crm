/**
 * Invoices Module v1.0.0
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

function _invTotals(inv) {
  const subtotal = (inv.lineItems || []).reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const laborTotal = Number(inv.laborHours || 0) * Number(inv.laborRate || 0);
  const taxable = subtotal + laborTotal - (Number(inv.discount) || 0);
  const tax = taxable * ((Number(inv.taxRate) || 0) / 100);
  const total = taxable + tax;
  return { subtotal, laborTotal, tax, total: Math.max(0, total) };
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

      <div class="flex flex-wrap gap-2 mb-4">
        ${['all', 'draft', 'sent', 'paid', 'overdue', 'void'].map(f => `
          <button onclick="_invSetFilter('${f}')" class="px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${statusFilter === f ? 'bg-blue-500 text-white' : 'glass-input text-slate-300'}">${f}</button>
        `).join('')}
      </div>

      <div class="space-y-3">
        ${shown.length === 0 ? '<p class="text-center text-slate-500 py-12">No invoices' + (statusFilter !== 'all' ? ' with status: ' + statusFilter : ' yet — create your first one above') + '</p>' :
      shown.slice().reverse().map(inv => {
        const { total } = _invTotals(inv);
        return `
            <div class="glass-card rounded-xl p-4 cursor-pointer hover:border-blue-500/30 transition-all" onclick="openInvoiceDetail('${inv.id}')">
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
  const { subtotal, laborTotal, tax, total } = _invTotals(inv);

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
        <p class="text-xs text-slate-400">${_invEsc(inv.customerAddress)}</p>
        ${inv.vehicleInfo ? `<p class="text-xs text-blue-400 mt-1">${_invEsc(inv.vehicleInfo)}</p>` : ''}
      </div>

      <div class="space-y-2 mb-4">
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

      <div class="glass-card rounded-lg p-4 space-y-2 mb-5">
        <div class="flex justify-between"><span class="text-sm text-slate-400">Parts Subtotal</span><span class="text-sm text-white">$${subtotal.toFixed(2)}</span></div>
        ${laborTotal > 0 ? `<div class="flex justify-between"><span class="text-sm text-slate-400">Labor (${inv.laborHours}h &times; $${inv.laborRate}/hr)</span><span class="text-sm text-white">$${laborTotal.toFixed(2)}</span></div>` : ''}
        ${inv.discount > 0 ? `<div class="flex justify-between"><span class="text-sm text-slate-400">Discount</span><span class="text-sm text-red-400">-$${Number(inv.discount).toFixed(2)}</span></div>` : ''}
        ${tax > 0 ? `<div class="flex justify-between"><span class="text-sm text-slate-400">Tax (${inv.taxRate}%)</span><span class="text-sm text-white">$${tax.toFixed(2)}</span></div>` : ''}
        <div class="border-t border-slate-700 pt-2 flex justify-between"><span class="text-lg font-bold text-white">Total</span><span class="text-xl font-bold text-green-400">$${total.toFixed(2)}</span></div>
      </div>

      <button id="invShareBtn-${inv.id}" onclick="shareInvoiceRecord('${inv.id}')" class="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 mb-2">
        <i class="ph-bold ph-share-network"></i> Share Invoice
      </button>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <button onclick="generateInvoicePDF('${inv.id}', false)" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-download"></i> Download PDF</button>
        <button onclick="generateInvoicePDF('${inv.id}', true)" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-printer"></i> Print</button>
        <button onclick="emailInvoiceRecord('${inv.id}')" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-envelope"></i> Email</button>
        <button onclick="smsInvoiceRecord('${inv.id}')" class="glass-input py-2.5 rounded-lg text-sm text-slate-200 flex items-center justify-center gap-2"><i class="ph-bold ph-chat-circle-text"></i> Text</button>
      </div>
      <div class="flex gap-2">
        <button onclick="openInvoiceEditor('${inv.id}')" class="btn-primary flex-1 py-2.5 rounded-lg text-sm font-semibold text-white">
          <i class="ph-bold ph-pencil-simple"></i> Edit
        </button>
        <select onchange="updateInvoiceStatus('${inv.id}', this.value)" class="glass-input px-3 py-2.5 rounded-lg text-sm text-white">
          ${['draft', 'sent', 'paid', 'overdue', 'void'].map(s => `<option value="${s}" ${inv.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <button onclick="deleteInvoiceRecord('${inv.id}')" class="btn-danger px-4 py-2.5 rounded-lg text-sm font-semibold text-white">
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
    customerName: '', customerEmail: '', customerPhone: '', customerAddress: '',
    vehicleInfo: '', poNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + (Number(s.invoiceDueDays) || 30) * 86400000).toISOString().split('T')[0],
    status: 'draft',
    lineItems: [{ description: '', partNumber: '', qty: 1, unitPrice: '' }],
    laborHours: 0, laborRate: s.defaultLaborRate || 95,
    taxRate: s.defaultTax != null ? s.defaultTax : 8,
    discount: 0,
    notes: s.invoiceNotes || 'Thank you for your business!',
    terms: s.invoiceTerms || 'Payment due within 30 days of invoice date.'
  };

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
        <div><label class="text-xs text-slate-400 mb-1 block">Address</label><input id="inv_customerAddress" value="${_invEsc(inv.customerAddress)}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>

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
            <label class="text-xs text-slate-400">Line Items</label>
            <button type="button" onclick="_invAddLine()" class="text-xs text-blue-400 flex items-center gap-1"><i class="ph-bold ph-plus"></i> Add line</button>
          </div>
          <div id="invLineItems" class="space-y-2">
            ${(inv.lineItems || []).map(li => _invLineRowHtml(li)).join('')}
          </div>
        </div>

        <div class="grid grid-cols-4 gap-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Labor Hrs</label><input id="inv_laborHours" type="number" step="0.5" min="0" value="${inv.laborHours}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Labor Rate</label><input id="inv_laborRate" type="number" step="0.01" min="0" value="${inv.laborRate}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Tax %</label><input id="inv_taxRate" type="number" step="0.01" min="0" value="${inv.taxRate}" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>
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
      <input class="inv-li-desc col-span-5 glass-input px-2 py-2 rounded-lg text-xs text-white" placeholder="Description" value="${_invEsc(li.description)}">
      <input class="inv-li-part col-span-3 glass-input px-2 py-2 rounded-lg text-xs text-white" placeholder="Part #" value="${_invEsc(li.partNumber)}">
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

function _invFillFromCustomer(custId) {
  if (!custId) return;
  const db = getDB();
  const cust = db.customers.find(c => c.id === custId);
  if (!cust) return;
  document.getElementById('inv_customerName').value = cust.name || '';
  document.getElementById('inv_customerEmail').value = cust.email || '';
  document.getElementById('inv_customerPhone').value = cust.phone || '';
  document.getElementById('inv_customerAddress').value = cust.address || '';
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

  if (lineItems.length === 0) {
    showToast('Add at least one line item', 'warning');
    return;
  }

  const formData = {
    customerId: document.getElementById('inv_customerId').value || null,
    customerName: document.getElementById('inv_customerName').value,
    customerEmail: document.getElementById('inv_customerEmail').value,
    customerPhone: document.getElementById('inv_customerPhone').value,
    customerAddress: document.getElementById('inv_customerAddress').value,
    vehicleInfo: document.getElementById('inv_vehicleInfo').value,
    status: document.getElementById('inv_status').value,
    invoiceDate: document.getElementById('inv_invoiceDate').value,
    dueDate: document.getElementById('inv_dueDate').value,
    lineItems: lineItems,
    laborHours: Number(document.getElementById('inv_laborHours').value) || 0,
    laborRate: Number(document.getElementById('inv_laborRate').value) || 0,
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
    customerAddress: cust ? cust.address : '',
    vehicleInfo: v ? `${v.year} ${v.make} ${v.model}` : '',
    poNumber: sale.id,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + (Number(s.invoiceDueDays) || 30) * 86400000).toISOString().split('T')[0],
    status: sale.status === 'Completed' ? 'paid' : 'draft',
    lineItems: (sale.lineItems || []).map(li => ({ description: li.name, partNumber: li.partNumber, qty: li.qty, unitPrice: li.unitPrice })),
    laborHours: sale.laborHours || 0,
    laborRate: sale.laborRate || s.defaultLaborRate || 95,
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
      document.getElementById('inv_vehicleInfo').value = p.vehicleInfo || '';
      document.getElementById('inv_status').value = p.status || 'draft';
      document.getElementById('inv_laborHours').value = p.laborHours || 0;
      document.getElementById('inv_laborRate').value = p.laborRate || 0;
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
function _invBuildPDFDoc(inv) {
  if (typeof window.jspdf === 'undefined') { showToast('PDF library not loaded', 'danger'); return null; }

  const { subtotal, laborTotal, tax, total } = _invTotals(inv);
  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF();

  buildPDFHeader(doc, 'INVOICE ' + inv.number);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Bill To:', 14, 42);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.text(inv.customerName || 'Unknown', 14, 48);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  let by = 53;
  if (inv.customerAddress) { doc.text(inv.customerAddress, 14, by); by += 5; }
  if (inv.customerPhone) { doc.text(inv.customerPhone, 14, by); by += 5; }
  if (inv.customerEmail) { doc.text(inv.customerEmail, 14, by); by += 5; }
  if (inv.vehicleInfo) { doc.text('Vehicle: ' + inv.vehicleInfo, 14, by); by += 5; }

  const W = doc.internal.pageSize.width;
  doc.setTextColor(100, 116, 139);
  doc.text('Invoice date: ' + _invFmtDate(inv.invoiceDate), W - 14, 42, { align: 'right' });
  doc.text('Due date: ' + _invFmtDate(inv.dueDate), W - 14, 47, { align: 'right' });
  doc.text('Status: ' + (inv.status || 'draft').toUpperCase(), W - 14, 52, { align: 'right' });
  if (inv.poNumber) doc.text('Ref: ' + inv.poNumber, W - 14, 57, { align: 'right' });

  doc.autoTable({
    head: [['Description', 'Part #', 'Qty', 'Unit Price', 'Total']],
    body: (inv.lineItems || []).map(li => [
      li.description || '', li.partNumber || '', li.qty,
      '$' + Number(li.unitPrice).toFixed(2), '$' + (li.qty * li.unitPrice).toFixed(2)
    ]),
    startY: Math.max(by + 4, 68),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: [226, 232, 240], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  let y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text('Parts Subtotal', W - 70, y); doc.text('$' + subtotal.toFixed(2), W - 14, y, { align: 'right' }); y += 6;
  if (laborTotal > 0) { doc.text(`Labor (${inv.laborHours}h x $${inv.laborRate}/hr)`, W - 70, y); doc.text('$' + laborTotal.toFixed(2), W - 14, y, { align: 'right' }); y += 6; }
  if (inv.discount > 0) { doc.text('Discount', W - 70, y); doc.text('-$' + Number(inv.discount).toFixed(2), W - 14, y, { align: 'right' }); y += 6; }
  if (tax > 0) { doc.text(`Tax (${inv.taxRate}%)`, W - 70, y); doc.text('$' + tax.toFixed(2), W - 14, y, { align: 'right' }); y += 6; }
  doc.setDrawColor(203, 213, 225); doc.line(W - 70, y, W - 14, y); y += 6;
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 185, 129);
  doc.text('TOTAL', W - 70, y); doc.text('$' + total.toFixed(2), W - 14, y, { align: 'right' }); y += 12;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
  if (inv.notes) { doc.text(doc.splitTextToSize(inv.notes, W - 28), 14, y); y += 10; }
  if (inv.terms) { doc.setFontSize(7.5); doc.setTextColor(148, 163, 184); doc.text(doc.splitTextToSize('Terms: ' + inv.terms, W - 28), 14, y); }

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
