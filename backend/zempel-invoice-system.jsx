/**
 * ZEMPEL AUTO CRM — INVOICE SYSTEM
 * ============================================================
 * Drop-in React component. Matches the CRM's dark navy design
 * (#0a0f1a bg, #1a2235 cards, #3b82f6 blue accent, #00c48c
 * green for money values, white text hierarchy).
 *
 * INTEGRATION POINTS (search for "INTEGRATE"):
 *   1. Import & mount <InvoiceSystem> in your App router
 *   2. Wire the `db` prop to your existing storage layer
 *   3. Add <InvoiceButton> inside CustomerProfile modal
 *   4. Add <InvoiceButton> inside SalesEstimates row
 *   5. Add <InvoiceSettingsTab> inside Settings tabs
 *
 * DEPENDENCIES:
 *   - Already in your bundle: React, ReactDOM
 *   - PDF: browser Print API (no extra deps)
 *   - Email: mailto: link (or swap with your email API)
 *   - SMS: sms: link (or swap with your SMS API)
 * ============================================================
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
} from "react";

// ─── DESIGN TOKENS (mirrors PWA exactly) ───────────────────
const T = {
  bgBase: "#0a0f1a",
  bgCard: "#111827",
  bgCardHover: "#1a2235",
  bgInput: "#0d1526",
  border: "rgba(59,130,246,0.15)",
  borderAccent: "#3b82f6",
  blue: "#3b82f6",
  blueHover: "#2563eb",
  green: "#00c48c",
  greenDim: "rgba(0,196,140,0.12)",
  amber: "#f59e0b",
  red: "#ef4444",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#4b5563",
  radius: "12px",
  radiusSm: "8px",
  font: "'Inter', 'SF Pro Display', system-ui, sans-serif",
};

// ─── INVOICE STORAGE LAYER ──────────────────────────────────
// INTEGRATE: replace localStorage calls with your KV/D1/IndexedDB
const InvoiceStorage = {
  key: "za_invoices_v1",
  settingsKey: "za_invoice_settings_v1",

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch {
      return [];
    }
  },

  save(invoices) {
    localStorage.setItem(this.key, JSON.stringify(invoices));
  },

  create(invoice) {
    const all = this.getAll();
    const newInvoice = {
      ...invoice,
      id: `INV-${Date.now()}`,
      number: `ZA-${String(all.length + 1001).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: invoice.status || "draft",
    };
    all.unshift(newInvoice);
    this.save(all);
    return newInvoice;
  },

  update(id, changes) {
    const all = this.getAll().map((inv) =>
      inv.id === id
        ? { ...inv, ...changes, updatedAt: new Date().toISOString() }
        : inv
    );
    this.save(all);
    return all.find((i) => i.id === id);
  },

  delete(id) {
    this.save(this.getAll().filter((i) => i.id !== id));
  },

  getSettings() {
    try {
      return JSON.parse(
        localStorage.getItem(this.settingsKey) ||
          JSON.stringify(defaultSettings)
      );
    } catch {
      return defaultSettings;
    }
  },

  saveSettings(s) {
    localStorage.setItem(this.settingsKey, JSON.stringify(s));
  },
};

const defaultSettings = {
  businessName: "Zempel Auto",
  businessAddress: "Dixon, MT 59831",
  businessPhone: "",
  businessEmail: "",
  businessWebsite: "zempelauto.techguruofficial.us",
  logoUrl: "https://zempelauto.techguruofficial.us/assets/z-auto-9.jpeg",
  taxRate: 0,
  defaultDueDays: 30,
  defaultNotes: "Thank you for your business!",
  defaultTerms: "Payment due within 30 days of invoice date.",
  currency: "USD",
};

// ─── CONTEXT ────────────────────────────────────────────────
const InvoiceCtx = createContext(null);
const useInvoice = () => useContext(InvoiceCtx);

// ─── UTILITIES ──────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n || 0);

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US") : "—";

const statusColors = {
  draft: { bg: "rgba(71,85,105,0.3)", text: "#94a3b8", label: "Draft" },
  sent: { bg: "rgba(59,130,246,0.2)", text: "#3b82f6", label: "Sent" },
  paid: { bg: "rgba(0,196,140,0.2)", text: "#00c48c", label: "Paid" },
  overdue: { bg: "rgba(239,68,68,0.2)", text: "#ef4444", label: "Overdue" },
  void: { bg: "rgba(107,114,128,0.2)", text: "#6b7280", label: "Void" },
};

// ─── SHARED UI PRIMITIVES ───────────────────────────────────
const Btn = ({ children, variant = "primary", onClick, disabled, style, small }) => {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: T.radiusSm,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: T.font,
    fontWeight: 600,
    fontSize: small ? 12 : 13,
    padding: small ? "6px 12px" : "9px 16px",
    transition: "all 0.18s ease",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  const variants = {
    primary: { background: T.blue, color: "#fff" },
    ghost: {
      background: "transparent",
      color: T.textSecondary,
      border: `1px solid ${T.border}`,
    },
    danger: { background: "rgba(239,68,68,0.15)", color: T.red, border: `1px solid rgba(239,68,68,0.3)` },
    success: { background: T.greenDim, color: T.green, border: `1px solid rgba(0,196,140,0.3)` },
    amber: { background: "rgba(245,158,11,0.15)", color: T.amber, border: `1px solid rgba(245,158,11,0.3)` },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
};

const Badge = ({ status }) => {
  const s = statusColors[status] || statusColors.draft;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.text,
      }}
    >
      {s.label}
    </span>
  );
};

const Input = ({ label, value, onChange, type = "text", placeholder, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
    {label && (
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
    )}
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: T.bgInput,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusSm,
        padding: "9px 12px",
        color: T.textPrimary,
        fontFamily: T.font,
        fontSize: 13,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  </div>
);

const Select = ({ label, value, onChange, options, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
    {label && (
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
    )}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: T.bgInput,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusSm,
        padding: "9px 12px",
        color: T.textPrimary,
        fontFamily: T.font,
        fontSize: 13,
        outline: "none",
        width: "100%",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

const Textarea = ({ label, value, onChange, rows = 3, placeholder }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    {label && (
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
    )}
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        background: T.bgInput,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusSm,
        padding: "9px 12px",
        color: T.textPrimary,
        fontFamily: T.font,
        fontSize: 13,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        resize: "vertical",
      }}
    />
  </div>
);

// ─── INVOICE PRINT TEMPLATE ─────────────────────────────────
// This is what gets printed / PDF'd — clean white design with Z branding
const InvoicePrintView = ({ invoice, settings }) => {
  const subtotal = (invoice.lineItems || []).reduce(
    (s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0),
    0
  );
  const tax = subtotal * ((parseFloat(settings.taxRate) || 0) / 100);
  const total = subtotal + tax + (parseFloat(invoice.laborTotal) || 0);

  return (
    <div
      id="za-invoice-print"
      style={{
        fontFamily: "'Inter', Arial, sans-serif",
        background: "#fff",
        color: "#111",
        width: "100%",
        maxWidth: 800,
        margin: "0 auto",
        padding: "48px 40px",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 40 }}>
        <div>
          <img
            src={settings.logoUrl}
            alt="Zempel Auto"
            style={{ height: 48, marginBottom: 8, objectFit: "contain" }}
            onError={(e) => { e.target.style.display = "none"; }}
          />
          <div style={{ fontWeight: 800, fontSize: 18, color: "#0a0f1a", letterSpacing: "-0.02em" }}>
            {settings.businessName}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {settings.businessAddress}
          </div>
          {settings.businessPhone && (
            <div style={{ fontSize: 12, color: "#64748b" }}>{settings.businessPhone}</div>
          )}
          {settings.businessEmail && (
            <div style={{ fontSize: 12, color: "#64748b" }}>{settings.businessEmail}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#0a0f1a", letterSpacing: "-0.03em" }}>
            INVOICE
          </div>
          <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 700, marginTop: 4 }}>
            {invoice.number}
          </div>
          <div
            style={{
              display: "inline-block",
              marginTop: 8,
              padding: "4px 14px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              background:
                invoice.status === "paid"
                  ? "#d1fae5"
                  : invoice.status === "overdue"
                  ? "#fee2e2"
                  : invoice.status === "sent"
                  ? "#dbeafe"
                  : "#f1f5f9",
              color:
                invoice.status === "paid"
                  ? "#059669"
                  : invoice.status === "overdue"
                  ? "#dc2626"
                  : invoice.status === "sent"
                  ? "#2563eb"
                  : "#475569",
            }}
          >
            {statusColors[invoice.status]?.label || "Draft"}
          </div>
        </div>
      </div>

      {/* Dates row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          padding: "16px 20px",
          background: "#f8fafc",
          borderRadius: 8,
          marginBottom: 32,
        }}
      >
        {[
          ["Invoice Date", fmtDate(invoice.invoiceDate || invoice.createdAt)],
          ["Due Date", fmtDate(invoice.dueDate)],
          ["PO / Ref", invoice.poNumber || "—"],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {label}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Bill To */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Bill To
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{invoice.customerName}</div>
        {invoice.customerEmail && <div style={{ fontSize: 13, color: "#64748b" }}>{invoice.customerEmail}</div>}
        {invoice.customerPhone && <div style={{ fontSize: 13, color: "#64748b" }}>{invoice.customerPhone}</div>}
        {invoice.customerAddress && <div style={{ fontSize: 13, color: "#64748b" }}>{invoice.customerAddress}</div>}
        {invoice.vehicleInfo && (
          <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 4, fontWeight: 600 }}>
            Vehicle: {invoice.vehicleInfo}
          </div>
        )}
      </div>

      {/* Line Items */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ background: "#0a0f1a" }}>
            {["Description", "Qty", "Unit Price", "Total"].map((h, i) => (
              <th
                key={h}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  textAlign: i === 0 ? "left" : "right",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(invoice.lineItems || []).map((item, idx) => (
            <tr
              key={idx}
              style={{ borderBottom: "1px solid #e2e8f0", background: idx % 2 === 0 ? "#fff" : "#f8fafc" }}
            >
              <td style={{ padding: "10px 14px", fontSize: 13, color: "#0f172a" }}>
                <div style={{ fontWeight: 600 }}>{item.description}</div>
                {item.partNumber && (
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Part #: {item.partNumber}</div>
                )}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right", color: "#0f172a" }}>
                {item.qty}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right", color: "#0f172a" }}>
                {fmt(item.price)}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                {fmt((parseFloat(item.qty) || 0) * (parseFloat(item.price) || 0))}
              </td>
            </tr>
          ))}
          {parseFloat(invoice.laborTotal) > 0 && (
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <td style={{ padding: "10px 14px", fontSize: 13, color: "#0f172a", fontStyle: "italic" }}>
                Labor — {invoice.laborHours || 1}h @ {fmt((invoice.laborTotal || 0) / (invoice.laborHours || 1))}/hr
              </td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right" }}>{invoice.laborHours || 1}</td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right" }}>
                {fmt((invoice.laborTotal || 0) / (invoice.laborHours || 1))}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 13, textAlign: "right", fontWeight: 600 }}>
                {fmt(invoice.laborTotal)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 32 }}>
        <div style={{ width: 260 }}>
          {[
            ["Subtotal", fmt(subtotal)],
            ...(tax > 0 ? [[`Tax (${settings.taxRate}%)`, fmt(tax)]] : []),
            ...(invoice.discount ? [["Discount", `-${fmt(invoice.discount)}`]] : []),
          ].map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>{label}</span>
              <span style={{ fontWeight: 600, color: "#0f172a" }}>{val}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0", fontSize: 18, fontWeight: 900 }}>
            <span style={{ color: "#0a0f1a" }}>Total</span>
            <span style={{ color: "#059669" }}>{fmt(total - (invoice.discount || 0))}</span>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      {(invoice.notes || settings.defaultNotes) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Notes
          </div>
          <div style={{ fontSize: 12, color: "#475569" }}>{invoice.notes || settings.defaultNotes}</div>
        </div>
      )}
      {(invoice.terms || settings.defaultTerms) && (
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Terms & Conditions
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{invoice.terms || settings.defaultTerms}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: "2px solid #0a0f1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          PARTS COMMAND · CRM — {settings.businessWebsite}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          Generated {new Date().toLocaleDateString("en-US")}
        </div>
      </div>
    </div>
  );
};

// ─── INVOICE EDITOR MODAL ───────────────────────────────────
const InvoiceEditor = ({ invoice: initial, onSave, onClose, settings }) => {
  const [inv, setInv] = useState(() => ({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerAddress: "",
    vehicleInfo: "",
    poNumber: "",
    invoiceDate: new Date().toISOString().split("T")[0],
    dueDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() + (settings.defaultDueDays || 30));
      return d.toISOString().split("T")[0];
    })(),
    status: "draft",
    lineItems: [{ description: "", partNumber: "", qty: 1, price: "" }],
    laborHours: 1,
    laborTotal: "",
    discount: "",
    notes: settings.defaultNotes || "",
    terms: settings.defaultTerms || "",
    ...initial,
  }));

  const [preview, setPreview] = useState(false);

  const set = (key, val) => setInv((p) => ({ ...p, [key]: val }));

  const updateLine = (idx, key, val) => {
    const items = [...inv.lineItems];
    items[idx] = { ...items[idx], [key]: val };
    set("lineItems", items);
  };

  const addLine = () =>
    set("lineItems", [...inv.lineItems, { description: "", partNumber: "", qty: 1, price: "" }]);

  const removeLine = (idx) =>
    set("lineItems", inv.lineItems.filter((_, i) => i !== idx));

  const subtotal = inv.lineItems.reduce(
    (s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0),
    0
  );
  const tax = subtotal * ((parseFloat(settings.taxRate) || 0) / 100);
  const total =
    subtotal +
    tax +
    (parseFloat(inv.laborTotal) || 0) -
    (parseFloat(inv.discount) || 0);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    const printHtml = document.getElementById("za-invoice-print-modal")?.innerHTML;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${inv.number || ""} — ${inv.customerName}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #fff; }
            @media print { @page { margin: 16mm; } }
          </style>
        </head>
        <body>${printHtml}</body>
      </html>
    `);
    win.document.close();
    setTimeout(() => { win.print(); }, 400);
  };

  const handleEmail = () => {
    const sub = encodeURIComponent(`Invoice ${inv.number} from Zempel Auto`);
    const body = encodeURIComponent(
      `Dear ${inv.customerName},\n\nPlease find your invoice ${inv.number} for ${fmt(total)} attached.\n\nDue date: ${fmtDate(inv.dueDate)}\n\n${settings.defaultNotes}\n\nZempel Auto\n${settings.businessEmail}`
    );
    window.location.href = `mailto:${inv.customerEmail || ""}?subject=${sub}&body=${body}`;
  };

  const handleSMS = () => {
    const msg = encodeURIComponent(
      `Zempel Auto: Invoice ${inv.number} for ${fmt(total)} is ready. Due ${fmtDate(inv.dueDate)}. Questions? ${settings.businessPhone || settings.businessEmail}`
    );
    window.location.href = `sms:${inv.customerPhone || ""}?body=${msg}`;
  };

  const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    backdropFilter: "blur(4px)",
    zIndex: 9000,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    overflowY: "auto",
    padding: "24px 16px",
  };

  const modal = {
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    width: "100%",
    maxWidth: 920,
    marginBottom: 24,
    overflow: "hidden",
  };

  if (preview) {
    return (
      <div style={overlay} onClick={(e) => e.target === e.currentTarget && setPreview(false)}>
        <div style={{ ...modal, background: "#fff", padding: 0 }}>
          {/* Preview toolbar */}
          <div style={{ background: T.bgCard, padding: "12px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: T.textSecondary, fontSize: 13, flex: 1 }}>
              Preview — {inv.number}
            </span>
            <Btn variant="ghost" small onClick={() => setPreview(false)}>← Edit</Btn>
            <Btn variant="ghost" small onClick={handlePrint}>🖨️ Print / PDF</Btn>
            <Btn variant="ghost" small onClick={handleEmail}>✉️ Email</Btn>
            <Btn variant="ghost" small onClick={handleSMS}>💬 SMS</Btn>
            <Btn variant="primary" small onClick={() => { onSave(inv); onClose(); }}>
              ✓ Save
            </Btn>
          </div>
          <div id="za-invoice-print-modal">
            <InvoicePrintView invoice={inv} settings={settings} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${T.border}`,
            background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 60%)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🧾</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: T.textPrimary }}>
                {initial?.id ? `Edit Invoice ${initial.number}` : "New Invoice"}
              </span>
              {inv.status && <Badge status={inv.status} />}
            </div>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2, marginLeft: 30 }}>
              Zempel Auto · PARTS COMMAND CRM
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" small onClick={() => setPreview(true)}>👁 Preview</Btn>
            <Btn variant="ghost" small onClick={handlePrint}>🖨️ Print</Btn>
            <Btn variant="ghost" small onClick={handleEmail}>✉️ Email</Btn>
            <Btn variant="ghost" small onClick={handleSMS}>💬 SMS</Btn>
            <Btn variant="primary" small onClick={() => { onSave(inv); onClose(); }}>
              ✓ Save Invoice
            </Btn>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 20, padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Customer & Invoice Info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Customer */}
            <div
              style={{
                background: T.bgCardHover,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Customer Info
              </div>
              <Input label="Customer Name" value={inv.customerName} onChange={(v) => set("customerName", v)} placeholder="Full name" />
              <Input label="Email" type="email" value={inv.customerEmail} onChange={(v) => set("customerEmail", v)} placeholder="email@example.com" />
              <Input label="Phone" type="tel" value={inv.customerPhone} onChange={(v) => set("customerPhone", v)} placeholder="(555) 000-0000" />
              <Input label="Address" value={inv.customerAddress} onChange={(v) => set("customerAddress", v)} placeholder="Street, City, State ZIP" />
              <Input label="Vehicle" value={inv.vehicleInfo} onChange={(v) => set("vehicleInfo", v)} placeholder="2010 Honda Pilot 3.5L V6" />
            </div>

            {/* Invoice Details */}
            <div
              style={{
                background: T.bgCardHover,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Invoice Details
              </div>
              <Select
                label="Status"
                value={inv.status}
                onChange={(v) => set("status", v)}
                options={Object.entries(statusColors).map(([k, v]) => ({ value: k, label: v.label }))}
              />
              <Input label="Invoice Date" type="date" value={inv.invoiceDate} onChange={(v) => set("invoiceDate", v)} />
              <Input label="Due Date" type="date" value={inv.dueDate} onChange={(v) => set("dueDate", v)} />
              <Input label="PO / Reference #" value={inv.poNumber} onChange={(v) => set("poNumber", v)} placeholder="Optional" />
              <Input label="Discount ($)" type="number" value={inv.discount} onChange={(v) => set("discount", v)} placeholder="0.00" />
            </div>
          </div>

          {/* Line Items */}
          <div
            style={{
              background: T.bgCardHover,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Line Items / Parts
              </div>
              <Btn variant="ghost" small onClick={addLine}>+ Add Line</Btn>
            </div>

            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1fr 1fr 1fr auto",
                gap: 8,
                padding: "6px 8px",
                borderBottom: `1px solid ${T.border}`,
                marginBottom: 6,
              }}
            >
              {["Description / Part", "Part #", "Qty", "Unit Price", ""].map((h) => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </div>
              ))}
            </div>

            {inv.lineItems.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "3fr 1fr 1fr 1fr auto",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: `1px solid rgba(59,130,246,0.07)`,
                  alignItems: "center",
                }}
              >
                <input
                  value={item.description}
                  onChange={(e) => updateLine(idx, "description", e.target.value)}
                  placeholder="JDM Engine, O2 Sensor…"
                  style={{ background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", color: T.textPrimary, fontFamily: T.font, fontSize: 12, outline: "none" }}
                />
                <input
                  value={item.partNumber}
                  onChange={(e) => updateLine(idx, "partNumber", e.target.value)}
                  placeholder="RA-12345"
                  style={{ background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", color: T.textPrimary, fontFamily: T.font, fontSize: 12, outline: "none" }}
                />
                <input
                  type="number"
                  value={item.qty}
                  onChange={(e) => updateLine(idx, "qty", e.target.value)}
                  min={0}
                  style={{ background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", color: T.textPrimary, fontFamily: T.font, fontSize: 12, outline: "none" }}
                />
                <input
                  type="number"
                  value={item.price}
                  onChange={(e) => updateLine(idx, "price", e.target.value)}
                  placeholder="0.00"
                  style={{ background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", color: T.textPrimary, fontFamily: T.font, fontSize: 12, outline: "none" }}
                />
                <button
                  onClick={() => removeLine(idx)}
                  style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 16, padding: "0 6px" }}
                >
                  ×
                </button>
              </div>
            ))}

            {/* Labor */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
              <Input label="Labor Hours" type="number" value={inv.laborHours} onChange={(v) => set("laborHours", v)} placeholder="1" />
              <Input label="Labor Total ($)" type="number" value={inv.laborTotal} onChange={(v) => set("laborTotal", v)} placeholder="0.00" />
            </div>
          </div>

          {/* Totals summary */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                background: T.bgCardHover,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: 16,
                width: 280,
              }}
            >
              {[
                ["Parts Subtotal", fmt(subtotal)],
                ...(parseFloat(inv.laborTotal) > 0 ? [["Labor", fmt(inv.laborTotal)]] : []),
                ...(tax > 0 ? [[`Tax (${settings.taxRate}%)`, fmt(tax)]] : []),
                ...(parseFloat(inv.discount) > 0 ? [["Discount", `-${fmt(inv.discount)}`]] : []),
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                  <span style={{ color: T.textSecondary }}>{label}</span>
                  <span style={{ color: T.textPrimary, fontWeight: 600 }}>{val}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 4px", fontSize: 18, fontWeight: 800 }}>
                <span style={{ color: T.textPrimary }}>Total</span>
                <span style={{ color: T.green }}>{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Notes & Terms */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Textarea label="Notes to Customer" value={inv.notes} onChange={(v) => set("notes", v)} rows={3} placeholder="Thank you for your business!" />
            <Textarea label="Terms & Conditions" value={inv.terms} onChange={(v) => set("terms", v)} rows={3} placeholder="Payment due within 30 days…" />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── INVOICE LIST (for Settings > Invoices tab & standalone) ─
const InvoiceList = () => {
  const { invoices, settings, openEditor, deleteInvoice } = useInvoice();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = invoices.filter((inv) => {
    const matchStatus = filter === "all" || inv.status === filter;
    const matchSearch =
      !search ||
      inv.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      inv.number?.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const stats = {
    total: invoices.length,
    totalValue: invoices.reduce((s, i) => {
      const sub = (i.lineItems || []).reduce((a, l) => a + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
      return s + sub + (parseFloat(i.laborTotal) || 0);
    }, 0),
    paid: invoices.filter((i) => i.status === "paid").length,
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };

  return (
    <div style={{ padding: 24, fontFamily: T.font }}>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Invoices", value: stats.total, color: T.blue },
          { label: "Total Value", value: fmt(stats.totalValue), color: T.green },
          { label: "Paid", value: stats.paid, color: T.green },
          { label: "Overdue", value: stats.overdue, color: T.red },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: T.bgCard,
              border: `1px solid ${T.border}`,
              borderRadius: T.radius,
              padding: "16px 20px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Search invoices…"
          style={{
            flex: 1,
            minWidth: 200,
            background: T.bgInput,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusSm,
            padding: "9px 14px",
            color: T.textPrimary,
            fontFamily: T.font,
            fontSize: 13,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "draft", "sent", "paid", "overdue"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? T.blue : T.bgCard,
                border: `1px solid ${filter === f ? T.blue : T.border}`,
                borderRadius: 20,
                padding: "6px 14px",
                color: filter === f ? "#fff" : T.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: T.font,
                textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <Btn variant="primary" onClick={() => openEditor(null)}>+ New Invoice</Btn>
      </div>

      {/* Invoice Rows */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: T.textMuted,
            background: T.bgCard,
            borderRadius: T.radius,
            border: `1px solid ${T.border}`,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: T.textSecondary, marginBottom: 6 }}>No invoices yet</div>
          <div style={{ fontSize: 13 }}>Create your first invoice using the button above.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((inv) => {
            const sub = (inv.lineItems || []).reduce((a, l) => a + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
            const total = sub + (parseFloat(inv.laborTotal) || 0);
            return (
              <div
                key={inv.id}
                style={{
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radiusSm,
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  cursor: "pointer",
                  transition: "border-color 0.18s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = T.blue)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.border)}
                onClick={() => openEditor(inv)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color: T.textPrimary, fontSize: 14 }}>{inv.customerName}</span>
                    <span style={{ fontSize: 11, color: T.textMuted }}>{inv.number}</span>
                    <Badge status={inv.status} />
                  </div>
                  <div style={{ fontSize: 11, color: T.textSecondary }}>
                    {fmtDate(inv.invoiceDate)} · Due {fmtDate(inv.dueDate)}
                    {inv.vehicleInfo ? ` · ${inv.vehicleInfo}` : ""}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: T.green, minWidth: 100, textAlign: "right" }}>
                  {fmt(total)}
                </div>
                <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <Btn variant="ghost" small onClick={() => openEditor(inv)}>Edit</Btn>
                  <Btn variant="danger" small onClick={() => { if (confirm(`Delete invoice ${inv.number}?`)) deleteInvoice(inv.id); }}>
                    Delete
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── SETTINGS > INVOICE TAB ──────────────────────────────────
export const InvoiceSettingsTab = () => {
  const { settings, saveSettings } = useInvoice();
  const [local, setLocal] = useState({ ...settings });
  const [saved, setSaved] = useState(false);

  const set = (k, v) => setLocal((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    saveSettings(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: 24, fontFamily: T.font, maxWidth: 700 }}>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.textPrimary, marginBottom: 4 }}>Invoice Settings</div>
      <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 24 }}>Configure defaults for all invoices</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>Business Info</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Business Name" value={local.businessName} onChange={(v) => set("businessName", v)} />
            <Input label="Logo URL" value={local.logoUrl} onChange={(v) => set("logoUrl", v)} />
            <Input label="Address" value={local.businessAddress} onChange={(v) => set("businessAddress", v)} />
            <Input label="Phone" type="tel" value={local.businessPhone} onChange={(v) => set("businessPhone", v)} />
            <Input label="Email" type="email" value={local.businessEmail} onChange={(v) => set("businessEmail", v)} />
            <Input label="Website" value={local.businessWebsite} onChange={(v) => set("businessWebsite", v)} />
          </div>
        </div>

        <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>Invoice Defaults</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Tax Rate (%)" type="number" value={local.taxRate} onChange={(v) => set("taxRate", v)} placeholder="0" />
            <Input label="Default Due Days" type="number" value={local.defaultDueDays} onChange={(v) => set("defaultDueDays", v)} placeholder="30" />
          </div>
          <Textarea label="Default Notes" value={local.defaultNotes} onChange={(v) => set("defaultNotes", v)} rows={2} />
          <Textarea label="Default Terms" value={local.defaultTerms} onChange={(v) => set("defaultTerms", v)} rows={2} />
        </div>

        <div>
          <Btn variant="primary" onClick={handleSave}>
            {saved ? "✓ Saved!" : "Save Invoice Settings"}
          </Btn>
        </div>
      </div>
    </div>
  );
};

// ─── CUSTOMER PROFILE INVOICE BUTTON ────────────────────────
// INTEGRATE: drop <CustomerInvoiceButton> inside the customer modal
// Pass the customer object in `customer` prop
export const CustomerInvoiceButton = ({ customer, sale }) => {
  const { openEditor } = useInvoice();

  const prefill = {
    customerName: customer?.name || "",
    customerEmail: customer?.email || "",
    customerPhone: customer?.phone || "",
    customerAddress: customer?.address || "",
    vehicleInfo: customer?.vehicles?.[0]
      ? `${customer.vehicles[0].year || ""} ${customer.vehicles[0].make || ""} ${customer.vehicles[0].model || ""}`.trim()
      : "",
    ...(sale
      ? {
          status: sale.status === "completed" || sale.status === "Completed" ? "paid" : "draft",
          lineItems: sale.items?.map((i) => ({
            description: i.description || i.name || "",
            partNumber: i.partNumber || "",
            qty: i.qty || 1,
            price: i.price || 0,
          })) || [{ description: sale.description || "", partNumber: "", qty: 1, price: sale.amount || 0 }],
          laborHours: sale.laborHours || 1,
          laborTotal: sale.laborCost || 0,
        }
      : {}),
  };

  return (
    <Btn variant="ghost" small onClick={() => openEditor(prefill)}>
      🧾 {sale ? "Generate Invoice" : "New Invoice"}
    </Btn>
  );
};

// ─── PROVIDER + ROOT COMPONENT ──────────────────────────────
export const InvoiceProvider = ({ children }) => {
  const [invoices, setInvoices] = useState(() => InvoiceStorage.getAll());
  const [settings, setSettings] = useState(() => InvoiceStorage.getSettings());
  const [editing, setEditing] = useState(null); // null | invoice object | "new"
  const [editorOpen, setEditorOpen] = useState(false);

  const refresh = () => setInvoices(InvoiceStorage.getAll());

  const openEditor = useCallback((inv) => {
    setEditing(inv);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditing(null);
  }, []);

  const saveInvoice = useCallback((inv) => {
    if (inv.id) {
      InvoiceStorage.update(inv.id, inv);
    } else {
      InvoiceStorage.create(inv);
    }
    refresh();
  }, []);

  const deleteInvoice = useCallback((id) => {
    InvoiceStorage.delete(id);
    refresh();
  }, []);

  const saveSettings = useCallback((s) => {
    InvoiceStorage.saveSettings(s);
    setSettings(s);
  }, []);

  return (
    <InvoiceCtx.Provider value={{ invoices, settings, openEditor, closeEditor, saveInvoice, deleteInvoice, saveSettings }}>
      {children}
      {editorOpen && (
        <InvoiceEditor
          invoice={editing}
          onSave={saveInvoice}
          onClose={closeEditor}
          settings={settings}
        />
      )}
    </InvoiceCtx.Provider>
  );
};

// ─── MAIN EXPORT: full Invoice page/tab ─────────────────────
export const InvoiceSystem = () => {
  return <InvoiceList />;
};

// ─── STANDALONE TEST HARNESS (remove after integration) ─────
export default function App() {
  return (
    <InvoiceProvider>
      <div style={{ fontFamily: T.font, background: T.bgBase, minHeight: "100vh", color: T.textPrimary }}>
        {/* Mock nav matching real CRM */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "12px 24px",
            background: T.bgCard,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <img src="https://zempelauto.techguruofficial.us/assets/z-auto-9.jpeg" alt="Zempel Auto" style={{ height: 32, borderRadius: 4 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, letterSpacing: "0.12em" }}>
            PARTS COMMAND · CRM v3.0
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>🧾 Invoice Module Active</span>
        </div>

        {/* Demo: Customer card with invoice button */}
        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Customer Profile — Invoice Button Demo
            </div>
            <div
              style={{
                background: T.bgCard,
                border: `1px solid ${T.border}`,
                borderRadius: T.radius,
                padding: 20,
                display: "flex",
                alignItems: "center",
                gap: 16,
                maxWidth: 600,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: T.blue,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 18,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                CB
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: T.textPrimary }}>Candice Barnett</div>
                <div style={{ fontSize: 12, color: T.textSecondary }}>2010 Honda Pilot · 3100 pts · $3,100 total</div>
              </div>
              <CustomerInvoiceButton
                customer={{
                  name: "Candice Barnett",
                  phone: "8708100184",
                  address: "212 B St. Dixon, MT 59831",
                  vehicles: [{ year: "2010", make: "HONDA", model: "PILOT" }],
                }}
                sale={{
                  description: "JDM 2010 HONDA PILOT 3.5L V6 ENGINE ONLY",
                  amount: 3100,
                  laborCost: 250,
                  laborHours: 1,
                  status: "Completed",
                }}
              />
            </div>
          </div>

          {/* Full Invoice List */}
          <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 24px",
                borderBottom: `1px solid ${T.border}`,
                background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 60%)",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 18, color: T.textPrimary }}>🧾 Invoices</div>
              <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>
                Create, edit, print, email & SMS invoices
              </div>
            </div>
            <InvoiceSystem />
          </div>

          {/* Settings Tab Demo */}
          <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", marginTop: 20 }}>
            <div
              style={{
                padding: "16px 24px",
                borderBottom: `1px solid ${T.border}`,
                background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 60%)",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 18, color: T.textPrimary }}>⚙️ Settings → Invoice Tab</div>
            </div>
            <InvoiceSettingsTab />
          </div>
        </div>
      </div>
    </InvoiceProvider>
  );
}
