/* RMSC Invoicing v2 – invoices, quotes, customers and vehicle history for RM Service Centre.
   Everything is stored on the device (localStorage). Use Settings → Backup to keep a copy. */
(function () {
'use strict';

const APP_VERSION = '2.1.0';
const STORE_KEY = 'rmsc-invoicing-v2';
const OLD_KEY = 'garageInvoiceState';          // used by the original single-file version
const WIP_KEY = 'rmsc-editor-wip';             // unfinished invoice/quote (crash/close recovery)
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const EMAILJS_LIB = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js';

const DEFAULT_JOBS = [
  'Brake Pads', 'Brake Discs', 'Brake Fluid', 'Brake Caliper', 'Handbrake',
  'Oil Change', 'Oil Filter', 'Air Filter', 'Cabin Filter', 'Fuel Filter',
  'Spark Plugs', 'Glow Plugs', 'Timing Belt', 'Cam Belt', 'Serpentine Belt',
  'Clutch', 'Gearbox', 'Transmission Fluid', 'Differential', 'CV Joint',
  'Wheel Alignment', 'Wheel Balancing', 'Tyre Replacement', 'Puncture Repair',
  'Battery Replacement', 'Alternator', 'Starter Motor', 'Wiring / Electrics',
  'Exhaust', 'Catalytic Converter', 'DPF Clean', 'Lambda Sensor',
  'Suspension', 'Shock Absorbers', 'Springs', 'Tie Rods', 'Ball Joints',
  'Power Steering', 'Coolant Flush', 'Radiator', 'Thermostat', 'Water Pump',
  'Diagnostics / OBD Scan', 'MOT Preparation', 'Service (Full)', 'Service (Interim)',
  'Windscreen', 'Wipers', 'Lights / Bulbs', 'Air Con Regas', 'General Repair'
];

const ITEM_TYPES = { labour: 'Labour', parts: 'Parts', flat: 'Flat rate', callout: 'Callout' };
const ITEM_DEFAULTS = {
  labour:  { desc: 'Labour', rate: () => db.settings.labourRate },
  parts:   { desc: 'Parts & materials', rate: () => 0 },
  flat:    { desc: '', rate: () => 0 },
  callout: { desc: 'Callout / diagnostic fee', rate: () => db.settings.calloutFee }
};
const PAY_METHODS = ['Cash', 'Card', 'Bank transfer', 'Cheque', 'Other'];
const STATUS_LABEL = {
  draft: 'Draft', unpaid: 'Unpaid', part: 'Part paid', paid: 'Paid', overdue: 'Overdue',
  sent: 'Open', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', converted: 'Invoiced'
};

const DEFAULT_SETTINGS = {
  garageName: 'RM Service Centre', ownerName: 'Rob Magee', address: '',
  phone: '07889 874325', email: 'robmagee29@gmail.com', vatNum: '', bank: '',
  termsDays: 0, quoteValidDays: 30, labourRate: 65, calloutFee: 50, vatDefault: 20,
  invoicePrefix: 'INV-', quotePrefix: 'QUO-', footer: 'Thank you for your custom.',
  logo: '', jobs: null,
  emailjsService: '', emailjsTemplate: '', emailjsKey: '', emailTo: 'garage', copyEmail: 'RMSC.SF@outlook.com',
  lastPayMethod: 'Cash'
};

/* ============================== Helpers ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = v => esc(v).replace(/\r?\n/g, '<br>');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const money = n => (n < 0 ? '-£' : '£') + Math.abs(round2(n)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = n => { const v = num(n); return Number.isInteger(v) ? String(v) : String(round2(v)); };
const fmtInt = n => { const v = Math.round(num(n)); return v ? v.toLocaleString('en-GB') : ''; };
const clone = o => JSON.parse(JSON.stringify(o));
const normReg = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normPhone = s => String(s || '').replace(/\D/g, '').replace(/^44/, '0');
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';
const isEmail = s => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(s || '').trim());
const coarse = () => window.matchMedia('(pointer: coarse)').matches;

function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayISO() { return isoOf(new Date()); }
function addDays(iso, n) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + Number(n || 0))); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return esc(iso); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function daysBetween(a, b) { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5); }
function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  invoice: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  quote: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  car: '<path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 13h18"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  chevRight: '<path d="M9 18l6-6-6-6"/>',
  convert: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 1-5-5L13 2l1.7 4.3z" transform="translate(-1 0)"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  install: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>'
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ============================== Data ============================== */
let db;

function emptyDb() {
  return {
    version: 2, docs: [], customers: [], priceList: [],
    settings: { ...DEFAULT_SETTINGS, jobs: DEFAULT_JOBS.slice() },
    meta: { created: new Date().toISOString(), lastBackup: null, settingsUpdatedAt: '' }
  };
}

function normalise(d) {
  const base = emptyDb();
  const out = { ...base, ...d, version: 2 };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  if (!Array.isArray(out.settings.jobs) || !out.settings.jobs.length) out.settings.jobs = DEFAULT_JOBS.slice();
  out.docs = Array.isArray(d.docs) ? d.docs : [];
  out.customers = Array.isArray(d.customers) ? d.customers : [];
  out.priceList = Array.isArray(d.priceList) ? d.priceList : [];
  out.meta = { ...base.meta, ...(d.meta || {}) };
  delete out.exportedAt; delete out.app;
  out.docs.forEach(doc => {
    doc.items = Array.isArray(doc.items) ? doc.items : [];
    doc.payments = Array.isArray(doc.payments) ? doc.payments : [];
    doc.jobs = Array.isArray(doc.jobs) ? doc.jobs : [];
    doc.customer = { name: '', email: '', phone: '', address: '', ...(doc.customer || {}) };
    doc.vehicle = { reg: '', make: '', year: '', mileage: '', ...(doc.vehicle || {}) };
    doc.items.forEach(i => { if (!i.id) i.id = uid(); });
  });
  out.customers.forEach(c => { c.vehicles = Array.isArray(c.vehicles) ? c.vehicles : []; });
  return out;
}

/** Convert data saved by the original single-file app into the new format. */
function fromOldFormat(old) {
  const d = emptyDb();
  const s = old.settings || {};
  const termsMap = { 'Due on receipt': 0, 'Net 7': 7, 'Net 14': 14, 'Net 30': 30 };
  Object.assign(d.settings, {
    garageName: s.garageName || d.settings.garageName,
    ownerName: s.ownerName || d.settings.ownerName,
    address: s.address || '', phone: s.phone || d.settings.phone, email: s.email || d.settings.email,
    vatNum: s.vatNum || '', bank: s.bank || '',
    termsDays: termsMap[s.terms] != null ? termsMap[s.terms] : 0,
    labourRate: num(s.labourRate) || 65, calloutFee: num(s.calloutFee) || 50,
    vatDefault: (s.vatDefault === 0 || s.vatDefault === '0') ? 0 : (num(s.vatDefault) || 20),
    emailjsService: s.emailjsService || '', emailjsTemplate: s.emailjsTemplate || '', emailjsKey: s.emailjsKey || ''
  });
  (old.customers || []).forEach(c => {
    if (!c || !c.name) return;
    d.customers.push({ id: uid(), name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', createdAt: new Date(Number(c.id) || Date.now()).toISOString() });
  });
  (old.invoices || []).forEach(inv => {
    const created = new Date(Number(inv.id) || Date.now()).toISOString();
    const doc = {
      id: uid(), kind: 'invoice', number: inv.invNum || '', date: inv.date || todayISO(), dueDate: inv.dueDate || '',
      status: inv.status === 'draft' ? 'draft' : 'issued',
      customerId: '',
      customer: { name: inv.customerName || '', email: inv.customerEmail || '', phone: inv.customerPhone || '', address: inv.customerAddress || '' },
      vehicle: { reg: String(inv.reg || '').toUpperCase(), make: inv.vehicle || '', year: inv.year || '', mileage: inv.mileage || '' },
      jobs: Array.isArray(inv.selectedJobs) ? inv.selectedJobs : [], notes: inv.notes || '',
      items: (inv.lineItems || []).map(li => ({ id: uid(), type: ITEM_TYPES[li.type] ? li.type : 'flat', desc: li.desc || '', qty: num(li.qty), rate: num(li.rate) })),
      vatRate: num(inv.vatRate), payments: [], createdAt: created, updatedAt: created
    };
    if (inv.status === 'paid') {
      const t = calc(doc).total;
      if (t > 0) doc.payments.push({ id: uid(), date: inv.date || todayISO(), amount: t, method: 'Other', note: 'Marked paid in old app' });
    }
    linkCustomer(doc, d);
    d.docs.push(doc);
  });
  d.meta.importedFromOld = new Date().toISOString();
  d.meta.oldCount = d.docs.length;
  d.meta.oldCustomers = d.customers.length;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalise(JSON.parse(raw));
  } catch (e) { console.error('Could not read saved data', e); }
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old) { const d = fromOldFormat(JSON.parse(old)); d.meta.migratedOnLoad = true; return d; }
  } catch (e) { console.error('Could not read old data', e); }
  return emptyDb();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    console.error(e);
    toast('Could not save – the device storage may be full. Export a backup now.', 'error', 6000);
    return false;
  }
}

const getDoc = id => db.docs.find(d => d.id === id);
const getCustomer = id => db.customers.find(c => c.id === id);
const lineTotal = i => round2(num(i.qty) * num(i.rate));

function calc(doc) {
  const sub = round2((doc.items || []).reduce((s, i) => s + lineTotal(i), 0));
  const vat = round2(sub * num(doc.vatRate) / 100);
  const total = round2(sub + vat);
  const paid = round2((doc.payments || []).reduce((s, p) => s + num(p.amount), 0));
  return { sub, vat, total, paid, balance: round2(total - paid) };
}

function statusOf(doc) {
  const t = todayISO();
  if (doc.kind === 'quote') {
    if (['converted', 'accepted', 'declined', 'draft'].includes(doc.status)) return doc.status;
    if (doc.validUntil && doc.validUntil < t) return 'expired';
    return 'sent';
  }
  if (doc.status === 'draft') return 'draft';
  const c = calc(doc);
  if (c.balance <= 0) return 'paid';
  if (doc.dueDate && doc.dueDate < t) return 'overdue';
  if (c.paid > 0) return 'part';
  return 'unpaid';
}
const badge = st => `<span class="badge b-${st}">${STATUS_LABEL[st] || esc(st)}</span>`;

function findCustomer(c, list) {
  const ph = normPhone(c.phone), em = String(c.email || '').trim().toLowerCase(), nm = String(c.name || '').trim().toLowerCase();
  return (ph.length >= 6 && list.find(x => normPhone(x.phone) === ph && String(x.name || '').trim().toLowerCase() === nm))
    || (em && list.find(x => String(x.email || '').trim().toLowerCase() === em))
    || (ph.length >= 6 && list.find(x => normPhone(x.phone) === ph))
    || (nm && list.find(x => String(x.name || '').trim().toLowerCase() === nm && !(ph && x.phone && normPhone(x.phone) !== ph)));
}

/** Make sure the doc's customer exists in the customer list (create or update it). */
function linkCustomer(doc, d = db) {
  const c = doc.customer;
  if (!c.name || !c.name.trim()) return;
  let rec = doc.customerId && d.customers.find(x => x.id === doc.customerId);
  if (!rec) rec = findCustomer(c, d.customers);
  if (!rec) {
    rec = { id: uid(), name: c.name.trim(), email: (c.email || '').trim(), phone: (c.phone || '').trim(), address: (c.address || '').trim(), createdAt: new Date().toISOString() };
    d.customers.push(rec);
  } else {
    ['name', 'email', 'phone', 'address'].forEach(k => { if (c[k] && c[k].trim()) rec[k] = c[k].trim(); });
  }
  doc.customerId = rec.id;
  if (doc.vehicle && normReg(doc.vehicle.reg)) addCustomerVehicle(rec, doc.vehicle);
}

/** Add a vehicle to a customer's saved list (or update its details if it's already there). */
function addCustomerVehicle(c, v) {
  if (!Array.isArray(c.vehicles)) c.vehicles = [];
  const key = normReg(v.reg);
  if (!key) return null;
  let rec = c.vehicles.find(x => normReg(x.reg) === key);
  if (!rec) { rec = { reg: String(v.reg).toUpperCase().trim(), make: '', year: '' }; c.vehicles.push(rec); }
  if (v.make) rec.make = String(v.make).trim();
  if (v.year) rec.year = String(v.year).trim();
  return rec;
}

function nextNumber(kind) {
  const prefix = kind === 'quote' ? db.settings.quotePrefix : db.settings.invoicePrefix;
  let max = 0;
  db.docs.filter(d => d.kind === kind).forEach(d => { const m = String(d.number || '').match(/(\d+)\s*$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return (prefix || '') + String(max + 1).padStart(3, '0');
}

function vehicleIndex() {
  const map = new Map();
  const docs = db.docs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  for (const d of docs) {
    const key = normReg(d.vehicle.reg);
    if (!key) continue;
    let v = map.get(key);
    if (!v) { v = { key, reg: d.vehicle.reg, make: '', year: '', mileage: '', docs: [], customerIds: new Set(), lastDate: '' }; map.set(key, v); }
    v.docs.push(d);
    v.reg = d.vehicle.reg || v.reg;
    if (d.vehicle.make) v.make = d.vehicle.make;
    if (d.vehicle.year) v.year = d.vehicle.year;
    if (d.vehicle.mileage) v.mileage = d.vehicle.mileage;
    if (d.customerId) { v.customerIds.add(d.customerId); v.lastCustomerId = d.customerId; }
    if (d.customer && d.customer.name) v.lastCustomer = d.customer;
    v.lastDate = d.date;
  }
  // Vehicles saved on customer records (including ones with no invoices yet)
  for (const c of db.customers) {
    for (const sv of (c.vehicles || [])) {
      const key = normReg(sv.reg);
      if (!key) continue;
      let v = map.get(key);
      if (!v) {
        v = { key, reg: sv.reg, make: sv.make || '', year: sv.year || '', mileage: '', docs: [], customerIds: new Set([c.id]), lastDate: '', lastCustomerId: c.id, lastCustomer: c };
        map.set(key, v);
      } else {
        if (!v.make && sv.make) v.make = sv.make;
        if (!v.year && sv.year) v.year = sv.year;
        v.customerIds.add(c.id);
        if (!v.lastCustomerId) { v.lastCustomerId = c.id; v.lastCustomer = c; }
      }
    }
  }
  return map;
}

function customerStats(c) {
  const docs = db.docs.filter(d => d.customerId === c.id);
  let spent = 0, owed = 0, invoices = 0;
  const regs = new Map();
  docs.forEach(d => {
    if (d.vehicle.reg) regs.set(normReg(d.vehicle.reg), d.vehicle);
    if (d.kind !== 'invoice' || d.status === 'draft') return;
    invoices++;
    const k = calc(d); spent += k.paid; if (k.balance > 0) owed += k.balance;
  });
  (c.vehicles || []).forEach(v => { const k = normReg(v.reg); if (k && !regs.has(k)) regs.set(k, v); });
  return { docs, spent: round2(spent), owed: round2(owed), invoices, vehicles: Array.from(regs.values()) };
}

/* ============================== UI plumbing ============================== */
const view = () => $('#view');
let editor = null;              // { doc, isNew, dirty, dueTouched, vindex }
let lastHash = location.hash || '#/';
let suppressRoute = false;
let deferredInstall = null;
let swReg = null;
const ACTIONS = {};

function toast(msg, type = '', ms = 3200, action) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.appendChild(b); }
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

function setTop({ title, back, actions = [] }) {
  $('#top-title').textContent = title;
  const b = $('#top-back');
  b.hidden = !back; b.dataset.href = back || '';
  $('#top-actions').innerHTML = actions.map(a => {
    const inner = `${a.icon ? ic(a.icon) : ''}<span>${esc(a.label)}</span>`;
    const cls = `btn ${a.cls || 'btn-top'}`;
    const data = Object.entries(a.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return a.href ? `<a class="${cls}" href="${a.href}">${inner}</a>` : `<button type="button" class="${cls}" data-act="${a.act}"${data}>${inner}</button>`;
  }).join('');
  document.title = `${title} · RMSC Invoicing`;
}

function setNav(name) { $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name)); }

function openModal({ title, body, actions = '', onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="modal-close" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-body">${body}</div>${actions ? `<div class="modal-foot">${actions}</div>` : ''}</div></div>`;
  document.body.classList.add('modal-open');
  const m = $('.modal', root);
  if (onMount) onMount(m);
  if (!coarse()) { const f = $('input:not([type=radio]),select,textarea', m); if (f) f.focus(); }
  return m;
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.classList.remove('modal-open'); }

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}

/* ============================== Router ============================== */
const ROUTES = [
  [/^\/$/, () => pageHome()],
  [/^\/invoices$/, (m, p) => pageList('invoice', p)],
  [/^\/quotes$/, (m, p) => pageList('quote', p)],
  [/^\/customers$/, () => pageCustomers()],
  [/^\/customer\/([\w-]+)$/, m => pageCustomer(m[1])],
  [/^\/vehicle\/([A-Za-z0-9]+)$/, m => pageVehicle(m[1].toUpperCase())],
  [/^\/settings$/, (m, p) => pageSettings(p)],
  [/^\/new\/(invoice|quote)$/, (m, p) => pageEditor(newDoc(m[1], p), true)],
  [/^\/edit\/([\w-]+)$/, m => { const d = getDoc(m[1]); d ? pageEditor(clone(d), false) : notFound(); }],
  [/^\/duplicate\/([\w-]+)$/, m => { const d = getDoc(m[1]); d ? pageEditor(duplicateOf(d), true) : notFound(); }],
  [/^\/convert\/([\w-]+)$/, m => { const d = getDoc(m[1]); d ? pageEditor(invoiceFromQuote(d), true) : notFound(); }],
  [/^\/resume$/, () => resumeWip()],
  [/^\/doc\/([\w-]+)$/, m => pageDoc(m[1])]
];

function parseHash() {
  const h = (location.hash || '#/').replace(/^#/, '') || '/';
  const i = h.indexOf('?');
  return { path: i > -1 ? h.slice(0, i) : h, params: new URLSearchParams(i > -1 ? h.slice(i + 1) : '') };
}

function route(opts = {}) {
  if (suppressRoute) { suppressRoute = false; return; }
  const h = location.hash || '#/';
  if (editor && editor.dirty && h !== lastHash && !opts.force) {
    if (!confirm('Leave without saving? Your changes to this ' + editor.doc.kind + ' will be lost.')) {
      suppressRoute = true; location.hash = lastHash; return;
    }
    clearWip();
  }
  const sameRoute = h === lastHash;
  lastHash = h;
  editor = null;
  document.body.classList.remove('editing');
  closeModal();
  const v = view();
  v.oninput = null; v.onchange = null; v.onfocusout = null;
  const { path, params } = parseHash();
  let handled = false;
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { fn(m, params); handled = true; break; }
  }
  if (!handled) notFound();
  if (!(opts.keepScroll || (sameRoute && opts.keepScroll !== false))) window.scrollTo(0, 0);
}
const rerender = () => route({ keepScroll: true, force: true });

function notFound() {
  setTop({ title: 'Not found', back: '#/' }); setNav('');
  view().innerHTML = `<div class="card empty">${ic('alert')}<p>That page or record doesn't exist any more.</p><a class="btn btn-primary" href="#/">Go home</a></div>`;
}

/* ============================== Shared bits ============================== */
function docRow(d) {
  const c = calc(d), st = statusOf(d);
  const veh = [d.vehicle.reg ? `<span class="plate">${esc(d.vehicle.reg)}</span>` : '', esc(d.vehicle.make)].filter(Boolean).join(' ');
  let extra = '';
  if (d.kind === 'invoice' && st === 'overdue') extra = `<div class="row-bal red">${plural(daysBetween(d.dueDate, todayISO()), 'day')} overdue</div>`;
  else if (d.kind === 'invoice' && st === 'part') extra = `<div class="row-bal">${money(c.balance)} left</div>`;
  return `<a class="row" href="#/doc/${d.id}">
    <div class="row-main">
      <div class="row-title"><span class="row-num">${esc(d.number || '(no number)')}</span>${badge(st)}</div>
      <div class="row-name">${esc(d.customer.name || 'No customer')}</div>
      <div class="row-sub">${veh}${veh ? '<span>·</span>' : ''}<span>${fmtDate(d.date)}</span></div>
    </div>
    <div class="row-side"><div class="row-amt">${money(c.total)}</div>${extra}</div>
  </a>`;
}

function vehicleRow(v) {
  return `<a class="row" href="#/vehicle/${encodeURIComponent(v.key)}">
    <div>${ic('car')}</div>
    <div class="row-main"><div class="row-title"><span class="plate">${esc(v.reg)}</span><span class="row-name">${esc([v.make, v.year].filter(Boolean).join(' ') || 'Vehicle')}</span></div>
    <div class="row-sub">${v.docs.length ? `${plural(v.docs.length, 'visit')} · last ${fmtDate(v.lastDate)}` : 'No visits yet'}${v.lastCustomer ? ' · ' + esc(v.lastCustomer.name) : ''}</div></div>
    ${ic('chevRight', 'chev')}</a>`;
}

function customerRow(c) {
  const s = customerStats(c);
  const sub = [c.phone ? esc(c.phone) : '', s.vehicles.slice(0, 3).map(v => `<span class="plate">${esc(v.reg)}</span>`).join(' ')].filter(Boolean).join(' <span>·</span> ');
  return `<a class="row" href="#/customer/${c.id}">
    <div class="avatar">${esc(initials(c.name))}</div>
    <div class="row-main"><div class="row-name">${esc(c.name)}</div><div class="row-sub">${sub || '<span>No contact details</span>'}</div></div>
    <div class="row-side">${s.owed > 0 ? `<div class="row-amt red">${money(s.owed)}</div><div class="row-bal red">owed</div>` : `<div class="row-amt">${money(s.spent)}</div><div class="row-bal" style="color:var(--faint)">${plural(s.invoices, 'invoice')}</div>`}</div>
  </a>`;
}

const emptyState = (icon, text, btn = '') => `<div class="empty">${ic(icon)}<p>${text}</p>${btn}</div>`;

/* ============================== Home ============================== */
function pageHome() {
  setNav('home');
  setTop({ title: db.settings.garageName || 'Home', actions: [{ label: 'New', icon: 'plus', href: '#/new/invoice', cls: 'btn-primary' }] });
  const t = todayISO(), month = t.slice(0, 7);
  const issued = db.docs.filter(d => d.kind === 'invoice' && d.status !== 'draft');
  let outstanding = 0, outN = 0, overdue = 0, overN = 0, paidMonth = 0, invMonth = 0;
  issued.forEach(d => {
    const c = calc(d), st = statusOf(d);
    if (c.balance > 0) { outstanding += c.balance; outN++; }
    if (st === 'overdue') { overdue += c.balance; overN++; }
    if ((d.date || '').startsWith(month)) invMonth += c.total;
    d.payments.forEach(p => { if ((p.date || '').startsWith(month)) paidMonth += num(p.amount); });
  });
  const overdueDocs = issued.filter(d => statusOf(d) === 'overdue').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const openQuotes = db.docs.filter(d => d.kind === 'quote' && statusOf(d) === 'sent').sort((a, b) => b.date.localeCompare(a.date));
  const drafts = db.docs.filter(d => d.status === 'draft');
  const recent = db.docs.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);

  const banners = [];
  const wip = readWip();
  if (wip) banners.push(`<div class="banner warn">${ic('edit')}<div class="banner-body"><strong>Unfinished ${esc(wip.doc.kind)}</strong>${esc(wip.doc.customer.name || 'No customer yet')} · ${money(calc(wip.doc).total)}</div><div class="banner-actions"><a class="btn btn-sm btn-primary" href="#/resume">Continue</a><button class="btn btn-sm" data-act="wip-discard">Discard</button></div></div>`);
  if (db.meta.migratedOnLoad) banners.push(`<div class="banner">${ic('check')}<div class="banner-body"><strong>Brought across from the old app</strong>${plural(db.meta.oldCount || 0, 'invoice')} and ${plural(db.meta.oldCustomers || 0, 'customer')} were imported. Have a quick look to check everything is right.</div><div class="banner-actions"><button class="btn btn-sm" data-act="dismiss-migrated">OK</button></div></div>`);
  const daysSinceBackup = db.meta.lastBackup ? daysBetween(db.meta.lastBackup.slice(0, 10), t) : null;
  if (db.docs.length >= 3 && (daysSinceBackup === null || daysSinceBackup > 14)) {
    banners.push(`<div class="banner warn">${ic('shield')}<div class="banner-body"><strong>${daysSinceBackup === null ? 'No backup yet' : `Last backup ${daysSinceBackup} days ago`}</strong>Your invoices only live on this device. Save a backup to OneDrive, Google Drive or email.</div><div class="banner-actions"><button class="btn btn-sm btn-primary" data-act="backup-export">Back up now</button></div></div>`);
  }
  if (!isStandalone() && (deferredInstall || isIOS()) && !db.meta.installDismissed) {
    banners.push(`<div class="banner">${ic('install')}<div class="banner-body"><strong>Install on this phone</strong>${deferredInstall ? 'Add it to your home screen so it opens like a normal app, even offline.' : 'In Safari tap the Share button, then “Add to Home Screen”.'}</div><div class="banner-actions">${deferredInstall ? '<button class="btn btn-sm btn-primary" data-act="install">Install</button>' : ''}<button class="btn btn-sm" data-act="install-dismiss">Not now</button></div></div>`);
  }

  const section = (title, link, inner) => `<div class="section"><div class="section-head"><h2>${title}</h2>${link || ''}</div>${inner}</div>`;
  view().innerHTML = `
    <div class="search-box search-hero">${ic('search')}<input id="global-search" type="search" placeholder="Search reg, customer, phone or number…" autocomplete="off" enterkeyhint="search" aria-label="Search"></div>
    <div id="search-results"></div>
    <div id="home-main">
      ${banners.join('')}
      <div class="stats">
        <a class="stat blue" href="#/invoices?f=unpaid"><div class="stat-label">Outstanding</div><div class="stat-value">${money(outstanding)}</div><div class="stat-sub">${plural(outN, 'unpaid invoice')}</div></a>
        <a class="stat ${overN ? 'red' : ''}" href="#/invoices?f=overdue"><div class="stat-label">Overdue</div><div class="stat-value">${money(overdue)}</div><div class="stat-sub">${overN ? plural(overN, 'invoice') + ' late' : 'Nothing overdue'}</div></a>
        <div class="stat green"><div class="stat-label">Paid this month</div><div class="stat-value">${money(paidMonth)}</div><div class="stat-sub">${monthLabel(month)}</div></div>
        <div class="stat"><div class="stat-label">Invoiced this month</div><div class="stat-value">${money(invMonth)}</div><div class="stat-sub">${plural(drafts.length, 'draft')}</div></div>
      </div>
      <div class="quick">
        <a class="quick-btn" href="#/new/invoice">${ic('invoice')}New invoice</a>
        <a class="quick-btn alt" href="#/new/quote">${ic('quote')}New quote</a>
      </div>
      ${overdueDocs.length ? section('Overdue', '<a href="#/invoices?f=overdue">See all</a>', `<div class="rows">${overdueDocs.slice(0, 5).map(docRow).join('')}</div>`) : ''}
      ${openQuotes.length ? section('Open quotes', '<a href="#/quotes?f=open">See all</a>', `<div class="rows">${openQuotes.slice(0, 5).map(docRow).join('')}</div>`) : ''}
      ${section('Recent', '<a href="#/invoices">All invoices</a>', recent.length ? `<div class="rows">${recent.map(docRow).join('')}</div>`
        : `<div class="card">${emptyState('invoice', 'No invoices yet. Create your first one to get started.', '<a class="btn btn-primary" href="#/new/invoice">New invoice</a>')}</div>`)}
    </div>`;
  const input = $('#global-search');
  input.addEventListener('input', debounce(() => runSearch(input.value), 120));
}

function runSearch(q) {
  q = q.trim();
  const box = $('#search-results'), main = $('#home-main');
  if (!box) return;
  if (!q) { box.innerHTML = ''; main.hidden = false; return; }
  main.hidden = true;
  const ql = q.toLowerCase(), qr = normReg(q), qp = normPhone(q);
  const vehicles = qr ? Array.from(vehicleIndex().values()).filter(v => v.key.includes(qr) || (v.make || '').toLowerCase().includes(ql)).slice(0, 6) : [];
  const customers = db.customers.filter(c => (c.name || '').toLowerCase().includes(ql) || (qp.length >= 4 && normPhone(c.phone).includes(qp)) || (c.email || '').toLowerCase().includes(ql)).slice(0, 6);
  const docs = db.docs.filter(d => (d.number || '').toLowerCase().includes(ql)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const sec = (t, inner) => `<div class="section" style="margin-top:14px"><div class="section-head"><h2>${t}</h2></div><div class="rows">${inner}</div></div>`;
  box.innerHTML = (vehicles.length ? sec('Vehicles', vehicles.map(vehicleRow).join('')) : '')
    + (customers.length ? sec('Customers', customers.map(customerRow).join('')) : '')
    + (docs.length ? sec('Invoices & quotes', docs.map(docRow).join('')) : '')
    || `<div class="card">${emptyState('search', `Nothing found for “${esc(q)}”.`, `<a class="btn btn-primary" href="#/new/invoice${qr && qr.length >= 4 ? '?reg=' + encodeURIComponent(qr) : ''}">New invoice</a>`)}</div>`;
}

/* ============================== Invoice / quote lists ============================== */
function pageList(kind, params) {
  const isInv = kind === 'invoice';
  setNav(isInv ? 'invoices' : 'quotes');
  setTop({ title: isInv ? 'Invoices' : 'Quotes', actions: [{ label: 'New', icon: 'plus', href: `#/new/${kind}`, cls: 'btn-primary' }] });
  const f = params.get('f') || 'all';
  const filters = isInv
    ? [['all', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft', 'Drafts']]
    : [['all', 'All'], ['open', 'Open'], ['accepted', 'Accepted'], ['converted', 'Invoiced'], ['closed', 'Declined / expired']];
  const match = (d, key) => {
    const st = statusOf(d);
    switch (key) {
      case 'all': return true;
      case 'unpaid': return ['unpaid', 'part', 'overdue'].includes(st);
      case 'open': return ['draft', 'sent'].includes(st);
      case 'closed': return ['declined', 'expired'].includes(st);
      default: return st === key;
    }
  };
  const mine = db.docs.filter(d => d.kind === kind);
  const base = `#/${isInv ? 'invoices' : 'quotes'}`;
  view().innerHTML = `
    <div class="toolbar">
      <div class="search-box">${ic('search')}<input id="list-search" type="search" placeholder="Search name, reg or number" aria-label="Search" autocomplete="off"></div>
      <div class="chips">${filters.map(([k, l]) => { const n = mine.filter(d => match(d, k)).length; return `<button type="button" class="chip ${k === f ? 'on' : ''}" data-act="replace-hash" data-href="${base}${k === 'all' ? '' : '?f=' + k}">${l}${k !== 'all' && n ? ` <span class="count">${n}</span>` : ''}</button>`; }).join('')}</div>
    </div>
    <div id="list-summary" class="list-summary"></div>
    <div id="list"></div>`;
  const render = () => {
    const q = $('#list-search').value.trim().toLowerCase(), qr = normReg(q);
    const items = mine.filter(d => match(d, f) && (!q
      || [d.number, d.customer.name, d.vehicle.make, d.customer.phone].some(x => String(x || '').toLowerCase().includes(q))
      || (qr && normReg(d.vehicle.reg).includes(qr))))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number), undefined, { numeric: true }));
    let total = 0, bal = 0;
    items.forEach(d => { const c = calc(d); total += c.total; if (isInv && d.status !== 'draft' && c.balance > 0) bal += c.balance; });
    $('#list-summary').textContent = items.length ? `${plural(items.length, kind)} · ${money(total)}${isInv && bal > 0 ? ` · ${money(bal)} still to pay` : ''}` : '';
    if (!items.length) {
      $('#list').innerHTML = `<div class="card">${emptyState(isInv ? 'invoice' : 'quote', q ? 'Nothing matches your search.' : (f === 'all' ? `No ${kind}s yet.` : `No ${kind}s here.`), f === 'all' && !q ? `<a class="btn btn-primary" href="#/new/${kind}">New ${kind}</a>` : '')}</div>`;
      return;
    }
    let html = '', cur = '';
    items.forEach(d => {
      const m = (d.date || '').slice(0, 7);
      if (m !== cur) {
        cur = m;
        const mt = items.filter(x => (x.date || '').slice(0, 7) === m).reduce((s, x) => s + calc(x).total, 0);
        html += `<div class="month-head"><span>${m ? monthLabel(m) : 'No date'}</span><span>${money(mt)}</span></div>`;
      }
      html += docRow(d);
    });
    $('#list').innerHTML = `<div class="rows">${html}</div>`;
  };
  $('#list-search').addEventListener('input', debounce(render, 100));
  render();
}

/* ============================== Customers ============================== */
function pageCustomers() {
  setNav('customers');
  setTop({ title: 'Customers', actions: [{ label: 'Add', icon: 'plus', act: 'customer-add', cls: 'btn-primary' }] });
  view().innerHTML = `
    <div class="toolbar"><div class="search-box">${ic('search')}<input id="cust-search" type="search" placeholder="Search name, phone or reg" aria-label="Search" autocomplete="off"></div></div>
    <div id="list-summary" class="list-summary"></div><div id="list"></div>`;
  const render = () => {
    const q = $('#cust-search').value.trim().toLowerCase(), qp = normPhone(q), qr = normReg(q);
    let list = db.customers.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (q) {
      const regOwners = new Set();
      if (qr) {
        db.docs.forEach(d => { if (d.customerId && normReg(d.vehicle.reg).includes(qr)) regOwners.add(d.customerId); });
        db.customers.forEach(c => { if ((c.vehicles || []).some(v => normReg(v.reg).includes(qr))) regOwners.add(c.id); });
      }
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (qp.length >= 4 && normPhone(c.phone).includes(qp)) || regOwners.has(c.id));
    }
    $('#list-summary').textContent = list.length ? plural(list.length, 'customer') : '';
    $('#list').innerHTML = list.length ? `<div class="rows">${list.map(customerRow).join('')}</div>`
      : `<div class="card">${emptyState('users', q ? 'No customers match.' : 'No customers yet. They are added automatically when you save an invoice.', q ? '' : '<button class="btn btn-primary" data-act="customer-add">Add customer</button>')}</div>`;
  };
  $('#cust-search').addEventListener('input', debounce(render, 100));
  render();
}

function pageCustomer(id) {
  const c = getCustomer(id);
  if (!c) return notFound();
  setNav('customers');
  setTop({ title: c.name, back: '#/customers', actions: [{ label: 'Edit', icon: 'edit', act: 'customer-edit', data: { id: c.id } }] });
  const s = customerStats(c);
  const vix = vehicleIndex();
  const docs = s.docs.slice().sort((a, b) => b.date.localeCompare(a.date));
  const tel = normPhone(c.phone);
  view().innerHTML = `
    <div class="two-col">
      <div class="stack">
        <div class="card">
          <div class="profile"><div class="avatar lg">${esc(initials(c.name))}</div><div><h2>${esc(c.name)}</h2>
            <div class="muted small">${[c.phone, c.email].filter(Boolean).map(esc).join(' · ') || 'No contact details'}</div></div></div>
          ${c.address ? `<p class="small muted" style="margin:12px 0 0">${nl2br(c.address)}</p>` : ''}
          <div class="contact-actions">
            <a class="btn btn-sm" ${tel ? `href="tel:${tel}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>${ic('phone')}Call</a>
            <a class="btn btn-sm" ${tel ? `href="sms:${tel}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>${ic('message')}Text</a>
            <a class="btn btn-sm" ${isEmail(c.email) ? `href="mailto:${esc(c.email.trim())}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>${ic('mail')}Email</a>
          </div>
          <div class="kv"><div><span>Invoices</span><b>${s.invoices}</b></div><div><span>Paid</span><b>${money(s.spent)}</b></div><div><span>Owed</span><b class="${s.owed > 0 ? 'red' : ''}">${money(s.owed)}</b></div></div>
          <div class="btn-row"><a class="btn btn-primary" href="#/new/invoice?customer=${c.id}">${ic('plus')}Invoice</a><a class="btn" href="#/new/quote?customer=${c.id}">${ic('plus')}Quote</a></div>
        </div>
        <div class="card"><div class="card-title">${ic('car')}Vehicles<span class="spacer"></span><button class="btn btn-sm" data-act="vehicle-add" data-id="${c.id}">${ic('plus')}Add vehicle</button></div>
          ${s.vehicles.length ? s.vehicles.map(v => {
            const key = normReg(v.reg), vi = vix.get(key);
            const visits = vi ? vi.docs.filter(d => d.customerId === c.id).length : 0;
            return `<div class="mini-link"><a class="grow vlink" href="#/vehicle/${encodeURIComponent(key)}"><span class="plate">${esc(v.reg)}</span><span class="grow">${esc([vi && vi.make || v.make, vi && vi.year || v.year].filter(Boolean).join(' ') || 'Vehicle')}<small>${visits ? plural(visits, 'visit') : 'No visits yet'}</small></span></a>
              ${visits ? ic('chevRight', 'chev') : `<button class="icon-btn danger" data-act="vehicle-remove" data-id="${c.id}" data-reg="${esc(key)}" aria-label="Remove ${esc(v.reg)}">${ic('x')}</button>`}</div>`;
          }).join('') : `<p class="muted small" style="margin:0">No vehicles yet. Add one, or it'll be added automatically when you invoice it.</p>`}
        </div>
        <button class="btn btn-danger" data-act="customer-delete" data-id="${c.id}">${ic('trash')}Delete customer</button>
      </div>
      <div><div class="section-head"><h2>History</h2></div>
        ${docs.length ? `<div class="rows">${docs.map(docRow).join('')}</div>` : `<div class="card">${emptyState('invoice', 'No invoices or quotes for this customer yet.')}</div>`}
      </div>
    </div>`;
}

function customerModal(c) {
  const isNew = !c;
  c = c || { id: '', name: '', phone: '', email: '', address: '' };
  openModal({
    title: isNew ? 'Add customer' : 'Edit customer',
    body: `<div class="fields">
      <div class="field"><label for="cm-name">Name *</label><input id="cm-name" type="text" value="${esc(c.name)}" autocomplete="off" autocapitalize="words"></div>
      <div class="field"><label for="cm-phone">Phone</label><input id="cm-phone" type="tel" value="${esc(c.phone)}" autocomplete="off"></div>
      <div class="field"><label for="cm-email">Email</label><input id="cm-email" type="email" value="${esc(c.email)}" autocomplete="off"></div>
      <div class="field"><label for="cm-address">Address</label><textarea id="cm-address" rows="2">${esc(c.address)}</textarea></div>
      ${isNew ? `<div class="grid2"><div class="field"><label for="cm-reg">Vehicle reg</label><input id="cm-reg" type="text" class="reg-input" placeholder="Optional" autocapitalize="characters" spellcheck="false" oninput="this.value=this.value.toUpperCase()"></div>
        <div class="field"><label for="cm-make">Make &amp; model</label><input id="cm-make" type="text" autocapitalize="words"></div></div>` : ''}
    </div>`,
    actions: `<button class="btn" data-act="modal-close">Cancel</button><button class="btn btn-primary" data-act="customer-save" data-id="${esc(c.id)}">Save</button>`
  });
}

function vehicleModal(c, v) {
  const isNew = !v;
  v = v || { reg: '', make: '', year: '' };
  openModal({
    title: isNew ? `Add vehicle for ${firstName(c.name)}` : `Edit ${v.reg}`,
    body: `<div class="fields">
      <div class="field"><label for="vm-reg">Registration *</label><input id="vm-reg" type="text" class="reg-input" value="${esc(v.reg)}" placeholder="AB12 CDE" autocapitalize="characters" spellcheck="false" oninput="this.value=this.value.toUpperCase()" ${isNew ? '' : 'readonly'}></div>
      <div class="field"><label for="vm-make">Make &amp; model</label><input id="vm-make" type="text" value="${esc(v.make)}" placeholder="Ford Focus 1.6" autocapitalize="words"></div>
      <div class="field"><label for="vm-year">Year</label><input id="vm-year" type="text" inputmode="numeric" maxlength="4" value="${esc(v.year)}" placeholder="2019"></div>
    </div>`,
    actions: `<button class="btn" data-act="modal-close">Cancel</button><button class="btn btn-primary" data-act="vehicle-save" data-id="${c.id}">${ic('check')}Save vehicle</button>`
  });
}

/* ============================== Vehicle ============================== */
function pageVehicle(key) {
  const v = vehicleIndex().get(key);
  setNav('customers');
  if (!v) return notFound();
  const owner = v.lastCustomerId && getCustomer(v.lastCustomerId);
  setTop({ title: v.reg, back: owner ? `#/customer/${owner.id}` : '#/customers', actions: [{ label: 'Invoice', icon: 'plus', href: `#/new/invoice?reg=${encodeURIComponent(key)}`, cls: 'btn-primary' }] });
  const docs = v.docs.slice().sort((a, b) => b.date.localeCompare(a.date));
  const spent = docs.filter(d => d.kind === 'invoice' && d.status !== 'draft').reduce((s, d) => s + calc(d).total, 0);
  view().innerHTML = `
    <div class="two-col">
      <div class="stack">
        <div class="card">
          <span class="plate lg">${esc(v.reg)}</span>
          <h2 style="margin-top:14px;font-size:22px">${esc(v.make || 'Unknown make')}${v.year ? ' <span class="muted">' + esc(v.year) + '</span>' : ''}</h2>
          <div class="kv"><div><span>Visits</span><b>${v.docs.length}</b></div><div><span>Mileage</span><b>${fmtInt(v.mileage) || '–'}</b></div><div><span>Billed</span><b>${money(spent)}</b></div></div>
          ${owner ? `<a class="mini-link" style="margin-top:12px;border-top:1px solid var(--line)" href="#/customer/${owner.id}"><div class="avatar">${esc(initials(owner.name))}</div><span class="grow">${esc(owner.name)}<small>${esc(owner.phone || '')}</small></span>${ic('chevRight', 'chev')}</a>` : ''}
          <div class="btn-row"><a class="btn btn-primary" href="#/new/invoice?reg=${encodeURIComponent(key)}">${ic('plus')}Invoice</a><a class="btn" href="#/new/quote?reg=${encodeURIComponent(key)}">${ic('plus')}Quote</a>
            ${owner ? `<button class="btn" data-act="vehicle-edit" data-id="${owner.id}" data-reg="${esc(key)}">${ic('edit')}Edit</button>` : ''}</div>
        </div>
      </div>
      <div><div class="section-head"><h2>Service history</h2></div>
        ${docs.length ? '' : `<div class="card">${emptyState('car', 'No visits yet for this vehicle.', `<a class="btn btn-primary" href="#/new/invoice?reg=${encodeURIComponent(key)}">Start an invoice</a>`)}</div>`}
        <div class="rows" ${docs.length ? '' : 'hidden'}>${docs.map(d => {
          const c = calc(d);
          return `<a class="tl" href="#/doc/${d.id}"><div class="tl-top"><strong>${fmtDate(d.date)}</strong>${badge(statusOf(d))}<span class="grow"></span><strong class="num">${money(c.total)}</strong></div>
            <div class="small muted">${esc(d.number)}${d.vehicle.mileage ? ' · ' + fmtInt(d.vehicle.mileage) + ' miles' : ''}${d.kind === 'quote' ? ' · quote' : ''}</div>
            ${d.jobs.length ? `<div class="tl-jobs">${d.jobs.map(j => `<span>${esc(j)}</span>`).join('')}</div>` : ''}
            ${d.notes ? `<div class="small" style="margin-top:6px">${esc(d.notes.length > 140 ? d.notes.slice(0, 140) + '…' : d.notes)}</div>` : ''}</a>`;
        }).join('')}</div>
      </div>
    </div>`;
}

/* ============================== Editor ============================== */
function newItem(type) {
  const def = ITEM_DEFAULTS[type] || ITEM_DEFAULTS.flat;
  return { id: uid(), type, desc: def.desc, qty: 1, rate: num(def.rate()) };
}

function fillVehicle(doc, v) {
  doc.vehicle.reg = v.reg; doc.vehicle.make = v.make || ''; doc.vehicle.year = v.year || '';
  if (v.lastCustomer && !doc.customer.name) {
    const rec = v.lastCustomerId && getCustomer(v.lastCustomerId);
    const src = rec || v.lastCustomer;
    doc.customer = { name: src.name || '', email: src.email || '', phone: src.phone || '', address: src.address || '' };
    doc.customerId = rec ? rec.id : '';
  }
}

function newDoc(kind, params) {
  const s = db.settings, t = todayISO();
  const d = {
    id: uid(), kind, number: nextNumber(kind), date: t,
    dueDate: kind === 'invoice' ? addDays(t, s.termsDays) : '',
    validUntil: kind === 'quote' ? addDays(t, s.quoteValidDays) : '',
    status: 'draft', customerId: '',
    customer: { name: '', email: '', phone: '', address: '' },
    vehicle: { reg: '', make: '', year: '', mileage: '' },
    jobs: [], notes: '', items: [newItem('labour')], vatRate: num(s.vatDefault), payments: []
  };
  const cid = params && params.get('customer');
  if (cid) {
    const c = getCustomer(cid);
    if (c) {
      d.customerId = c.id;
      d.customer = { name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '' };
      const vs = customerStats(c).vehicles;
      if (vs.length === 1) { const v = vehicleIndex().get(normReg(vs[0].reg)); if (v) fillVehicle(d, v); }
    }
  }
  const reg = params && params.get('reg');
  if (reg) {
    const v = vehicleIndex().get(normReg(reg));
    if (v) fillVehicle(d, v); else d.vehicle.reg = reg.toUpperCase();
  }
  return d;
}

function duplicateOf(src) {
  const d = clone(src);
  const t = todayISO();
  Object.assign(d, { id: uid(), number: nextNumber(src.kind), date: t, status: 'draft', payments: [], createdAt: undefined, updatedAt: undefined, emailedAt: undefined, fromQuoteId: undefined, invoiceId: undefined });
  d.dueDate = d.kind === 'invoice' ? addDays(t, db.settings.termsDays) : '';
  d.validUntil = d.kind === 'quote' ? addDays(t, db.settings.quoteValidDays) : '';
  d.vehicle.mileage = '';
  d.items.forEach(i => { i.id = uid(); });
  return d;
}

function invoiceFromQuote(q) {
  const d = duplicateOf(q);
  d.kind = 'invoice';
  d.number = nextNumber('invoice');
  d.dueDate = addDays(d.date, db.settings.termsDays);
  d.validUntil = '';
  d.vehicle.mileage = q.vehicle.mileage || '';
  d.fromQuoteId = q.id;
  return d;
}

function readWip() { try { const w = JSON.parse(localStorage.getItem(WIP_KEY) || 'null'); return w && w.doc ? w : null; } catch (e) { return null; } }
function clearWip() { try { localStorage.removeItem(WIP_KEY); } catch (e) { /* ignore */ } }
const saveWip = debounce(() => { if (editor && editor.dirty) { try { localStorage.setItem(WIP_KEY, JSON.stringify({ doc: editor.doc, isNew: editor.isNew, dueTouched: editor.dueTouched, at: Date.now() })); } catch (e) { /* ignore */ } } }, 400);

function resumeWip() {
  const w = readWip();
  if (!w) { location.replace('#/'); return; }
  const exists = getDoc(w.doc.id);
  pageEditor(w.doc, !exists, { resumed: true, dueTouched: w.dueTouched });
}

function pageEditor(doc, isNew, opts = {}) {
  editor = { doc, isNew, dirty: !!opts.resumed, dueTouched: opts.dueTouched != null ? opts.dueTouched : !isNew, vindex: vehicleIndex() };
  const isInv = doc.kind === 'invoice';
  const word = isInv ? 'invoice' : 'quote';
  setNav(isInv ? 'invoices' : 'quotes');
  document.body.classList.add('editing');
  const backTo = isNew ? (isInv ? '#/invoices' : '#/quotes') : `#/doc/${doc.id}`;
  setTop({ title: isNew ? `New ${word}` : `Edit ${doc.number}`, back: backTo });

  const d = doc;
  const allJobs = Array.from(new Set([...(db.settings.jobs || []), ...d.jobs]));
  const existingNonDraft = !isNew && d.status !== 'draft';
  const saveButtons = existingNonDraft
    ? `<button type="button" class="btn btn-primary" data-act="ed-save" data-mode="keep">${ic('check')}Save changes</button>`
    : `<button type="button" class="btn" data-act="ed-save" data-mode="draft">Save draft</button><button type="button" class="btn btn-primary" data-act="ed-save" data-mode="final">${ic('check')}${isInv ? 'Save invoice' : 'Save quote'}</button>`;

  view().innerHTML = `
  <form class="editor" id="ed" autocomplete="off" novalidate onsubmit="return false">
    <div class="ed-main">
      ${opts.resumed ? `<div class="banner warn" style="margin:0">${ic('edit')}<div class="banner-body"><strong>Picked up where you left off</strong>This ${word} hasn't been saved yet.</div></div>` : ''}
      ${d.fromQuoteId ? `<div class="banner" style="margin:0">${ic('convert')}<div class="banner-body">Creating an invoice from quote <strong style="display:inline">${esc((getDoc(d.fromQuoteId) || {}).number || '')}</strong>. Check the charges, then save.</div></div>` : ''}
      <section class="card">
        <div class="card-title">${ic('user')}Customer</div>
        <div class="fields">
          <div class="field typeahead"><label for="ed-cname">Name *</label>
            <input id="ed-cname" type="text" data-f="customer.name" value="${esc(d.customer.name)}" placeholder="Start typing to find a customer" autocapitalize="words">
            <div class="ta-list" id="ta-list" hidden></div></div>
          <div class="grid2 stack-sm">
            <div class="field"><label for="ed-cphone">Phone</label><input id="ed-cphone" type="tel" data-f="customer.phone" value="${esc(d.customer.phone)}"></div>
            <div class="field"><label for="ed-cemail">Email</label><input id="ed-cemail" type="email" data-f="customer.email" value="${esc(d.customer.email)}"></div>
          </div>
          <div class="field"><label for="ed-caddr">Address</label><textarea id="ed-caddr" rows="2" data-f="customer.address">${esc(d.customer.address)}</textarea></div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">${ic('car')}Vehicle</div>
        <div class="fields">
          <div class="grid2">
            <div class="field"><label for="ed-reg">Registration</label><input id="ed-reg" type="text" class="reg-input" data-f="vehicle.reg" value="${esc(d.vehicle.reg)}" placeholder="AB12 CDE" autocapitalize="characters" spellcheck="false"></div>
            <div class="field"><label for="ed-make">Make &amp; model</label><input id="ed-make" type="text" data-f="vehicle.make" value="${esc(d.vehicle.make)}" placeholder="Ford Focus 1.6" autocapitalize="words"></div>
          </div>
          <div id="reg-hint"></div>
          <div class="grid2">
            <div class="field"><label for="ed-year">Year</label><input id="ed-year" type="text" inputmode="numeric" maxlength="4" data-f="vehicle.year" value="${esc(d.vehicle.year)}" placeholder="2019"></div>
            <div class="field"><label for="ed-miles">Mileage</label><input id="ed-miles" type="text" inputmode="numeric" data-f="vehicle.mileage" value="${esc(d.vehicle.mileage)}" placeholder="45000"></div>
          </div>
        </div>
      </section>

      <section class="card">
        <details class="jobs" id="jobs-details" ${d.jobs.length || isNew ? 'open' : ''}>
          <summary><div class="card-title">${ic('wrench')}Work carried out</div><span class="jobs-count" id="jobs-count"></span>${ic('chevDown', 'chev')}</summary>
          <div class="jobs-body">
            <div class="search-box">${ic('search')}<input id="jobs-filter" type="search" placeholder="Find or add a job…" aria-label="Find job"></div>
            <div class="jobchips" id="jobchips">${allJobs.map(j => `<button type="button" class="jc ${d.jobs.includes(j) ? 'on' : ''}" data-act="job-toggle" data-job="${esc(j)}">${esc(j)}</button>`).join('')}</div>
          </div>
        </details>
        <div class="jobs-preview" id="jobs-preview"></div>
      </section>

      <section class="card">
        <div class="card-title">${ic('cash')}Charges</div>
        <div class="li-head"><span>Type</span><span>Description</span><span class="r">Qty / hrs</span><span class="r">Rate £</span><span class="r">Total</span><span></span></div>
        <div class="lines" id="lines"></div>
        <div class="add-row">
          <button type="button" class="btn btn-sm" data-act="li-add" data-type="labour">${ic('plus')}Labour</button>
          <button type="button" class="btn btn-sm" data-act="li-add" data-type="parts">${ic('plus')}Parts</button>
          <button type="button" class="btn btn-sm" data-act="li-add" data-type="flat">${ic('plus')}Flat rate</button>
          <button type="button" class="btn btn-sm" data-act="li-add" data-type="callout">${ic('plus')}Callout</button>
          <button type="button" class="btn btn-sm" data-act="pl-open">${ic('tag')}Price list</button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">${ic('edit')}Notes</div>
        <textarea data-f="notes" rows="3" placeholder="Shown on the ${word} – e.g. advisories, next service due…">${esc(d.notes)}</textarea>
      </section>
    </div>

    <aside class="ed-side">
      <section class="card">
        <div class="card-title">${ic(isInv ? 'invoice' : 'quote')}${isInv ? 'Invoice' : 'Quote'} details</div>
        <div class="fields">
          <div class="field"><label for="ed-num">${isInv ? 'Invoice' : 'Quote'} number</label><input id="ed-num" type="text" data-f="number" value="${esc(d.number)}"></div>
          <div class="grid2">
            <div class="field"><label for="ed-date">Date</label><input id="ed-date" type="date" data-f="date" value="${esc(d.date)}"></div>
            ${isInv
              ? `<div class="field"><label for="ed-due">Due</label><input id="ed-due" type="date" data-f="dueDate" value="${esc(d.dueDate)}"></div>`
              : `<div class="field"><label for="ed-due">Valid until</label><input id="ed-due" type="date" data-f="validUntil" value="${esc(d.validUntil)}"></div>`}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="tot-row"><span>Subtotal</span><span id="t-sub"></span></div>
        <div class="tot-row"><span>VAT <select data-f="vatRate" aria-label="VAT rate">${[0, 5, 20].map(r => `<option value="${r}" ${num(d.vatRate) === r ? 'selected' : ''}>${r}%</option>`).join('')}</select></span><span id="t-vat"></span></div>
        <div class="tot-row grand"><span>Total</span><span id="t-total"></span></div>
      </section>
    </aside>
  </form>
  <div class="savebar"><div class="savebar-total"><small>Total</small><strong id="sb-total"></strong></div>${saveButtons}</div>`;

  renderLines();
  updateTotals();
  updateJobsCount();
  updateRegHint();
  const v = view();
  v.oninput = edInput;
  v.onfocusout = e => { if (e.target.id === 'ed-cname') setTimeout(() => { const l = $('#ta-list'); if (l && !l.contains(document.activeElement)) l.hidden = true; }, 180); };
  const ta = $('#ta-list');
  ta.addEventListener('mousedown', e => e.preventDefault());
  if (isNew && !opts.resumed && !coarse()) $('#ed-cname').focus();
}

function markDirty() { if (!editor) return; editor.dirty = true; saveWip(); }

function edInput(e) {
  if (!editor) return;
  const t = e.target, d = editor.doc;
  if (t.dataset.f) {
    const f = t.dataset.f;
    let v = t.value;
    if (f === 'vehicle.reg') {
      const up = v.toUpperCase();
      if (up !== v) { const p = t.selectionStart; t.value = up; try { t.setSelectionRange(p, p); } catch (_) { /* ignore */ } }
      v = up;
    }
    if (f === 'vatRate') v = num(v);
    const [a, b] = f.split('.');
    if (b) d[a][b] = v; else d[a] = v;
    if (f === 'date' && !editor.dueTouched && v) {
      if (d.kind === 'invoice') d.dueDate = addDays(v, db.settings.termsDays);
      else d.validUntil = addDays(v, db.settings.quoteValidDays);
      $('#ed-due').value = d.kind === 'invoice' ? d.dueDate : d.validUntil;
    }
    if (f === 'dueDate' || f === 'validUntil') editor.dueTouched = true;
    if (f === 'customer.name') { d.customerId = ''; showTypeahead(v); }
    if (f === 'vehicle.reg') updateRegHint();
    markDirty(); updateTotals();
    return;
  }
  const row = t.closest('.li');
  if (row && t.dataset.k) {
    const it = d.items.find(i => i.id === row.dataset.id);
    if (!it) return;
    const k = t.dataset.k;
    if (k === 'type') {
      const old = it.type; it.type = t.value;
      if (!it.desc || it.desc === (ITEM_DEFAULTS[old] || {}).desc) { it.desc = ITEM_DEFAULTS[it.type].desc; $('[data-k=desc]', row).value = it.desc; }
      const dr = num(ITEM_DEFAULTS[it.type].rate());
      if (!num(it.rate) && dr) { it.rate = dr; $('[data-k=rate]', row).value = dr; }
    } else it[k] = t.value;
    $('.li-total b', row).textContent = money(lineTotal(it));
    markDirty(); updateTotals();
    return;
  }
  if (t.id === 'jobs-filter') filterJobs(t.value);
}

function renderLines() {
  const d = editor.doc;
  const box = $('#lines');
  if (!d.items.length) { box.innerHTML = '<p class="muted small" style="margin:4px 0">No charges yet – add labour, parts or a flat rate below.</p>'; return; }
  box.innerHTML = d.items.map(i => `
    <div class="li" data-id="${i.id}">
      <label class="li-f li-type"><span>Type</span><select data-k="type" aria-label="Type">${Object.entries(ITEM_TYPES).map(([k, l]) => `<option value="${k}" ${i.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="li-f li-desc"><span>Description</span><input type="text" data-k="desc" value="${esc(i.desc)}" placeholder="What was done / supplied" aria-label="Description"></label>
      <label class="li-f li-qty"><span>Qty/hrs</span><input type="text" inputmode="decimal" data-k="qty" value="${esc(i.qty)}" aria-label="Quantity or hours"></label>
      <label class="li-f li-rate"><span>Rate £</span><input type="text" inputmode="decimal" data-k="rate" value="${esc(i.rate)}" aria-label="Rate in pounds"></label>
      <div class="li-f li-total"><span>Line total</span><b>${money(lineTotal(i))}</b></div>
      <button type="button" class="icon-btn danger li-del" data-act="li-del" aria-label="Remove line">${ic('trash')}</button>
    </div>`).join('');
}

function updateTotals() {
  if (!editor) return;
  const c = calc(editor.doc);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('t-sub', money(c.sub)); set('t-vat', money(c.vat)); set('t-total', money(c.total)); set('sb-total', money(c.total));
}

function updateJobsCount() {
  const d = editor.doc;
  $('#jobs-count').textContent = d.jobs.length ? `${d.jobs.length} selected` : '';
  $('#jobs-count').hidden = !d.jobs.length;
  $('#jobs-preview').innerHTML = d.jobs.map(j => `<span>${esc(j)}</span>`).join('');
}

function filterJobs(q) {
  q = q.trim().toLowerCase();
  let exact = false;
  $$('#jobchips .jc[data-job]').forEach(b => {
    const j = b.dataset.job.toLowerCase();
    b.hidden = q && !j.includes(q);
    if (j === q) exact = true;
  });
  const old = $('#jobchips .jc.add'); if (old) old.remove();
  if (q && !exact) {
    const raw = $('#jobs-filter').value.trim();
    $('#jobchips').insertAdjacentHTML('afterbegin', `<button type="button" class="jc add" data-act="job-add" data-job="${esc(raw)}">${ic('plus')}Add “${esc(raw)}”</button>`);
  }
}

function showTypeahead(q) {
  const list = $('#ta-list');
  q = q.trim().toLowerCase();
  if (q.length < 1) { list.hidden = true; return; }
  const qp = normPhone(q);
  const matches = db.customers.filter(c => c.name.toLowerCase().includes(q) || (qp.length >= 4 && normPhone(c.phone).includes(qp))).slice(0, 6);
  if (!matches.length) { list.hidden = true; return; }
  list.innerHTML = matches.map(c => {
    const regs = customerStats(c).vehicles.map(v => v.reg).slice(0, 3).join(', ');
    return `<button type="button" class="ta-item" data-act="ta-pick" data-id="${c.id}"><strong>${esc(c.name)}</strong><small>${[c.phone, regs].filter(Boolean).map(esc).join(' · ') || 'No details'}</small></button>`;
  }).join('');
  list.hidden = false;
}

function updateRegHint() {
  if (!editor) return;
  const d = editor.doc, box = $('#reg-hint');
  const key = normReg(d.vehicle.reg);
  const v = key && editor.vindex.get(key);
  if (v && (v.docs.some(x => x.id !== d.id) || !v.docs.length)) {
    const owner = v.lastCustomer ? v.lastCustomer.name : '';
    const needsFill = (!d.vehicle.make && v.make) || (!d.customer.name && owner);
    const seen = v.docs.length ? `<strong>Seen before</strong> – ${esc([v.make, v.year].filter(Boolean).join(' ') || 'vehicle')} · ${plural(v.docs.length, 'visit')} · last ${fmtDate(v.lastDate)}${v.mileage ? ' at ' + fmtInt(v.mileage) + ' miles' : ''}`
      : `<strong>On file</strong> – ${esc([v.make, v.year].filter(Boolean).join(' ') || 'vehicle')}`;
    box.innerHTML = `<div class="hint">${ic('clock')}<div class="hint-body">${seen}${owner ? ' · ' + esc(owner) : ''}</div>
      ${needsFill ? '<button type="button" class="btn btn-sm btn-primary" data-act="reg-fill">Fill in details</button>' : ''}</div>`;
    return;
  }
  if (!key && d.customerId) {
    const c = getCustomer(d.customerId);
    const vs = c ? customerStats(c).vehicles : [];
    if (vs.length) {
      box.innerHTML = `<div><span class="label">${esc(firstName(c.name))}'s vehicles</span><div class="vpicks">${vs.map(x => `<button type="button" class="vpick" data-act="vpick" data-reg="${esc(normReg(x.reg))}"><span class="plate">${esc(x.reg)}</span>${esc(x.make || '')}</button>`).join('')}</div></div>`;
      return;
    }
  }
  box.innerHTML = '';
}

function syncEditorInputs() {
  const d = editor.doc;
  $$('[data-f]', view()).forEach(el => {
    const [a, b] = el.dataset.f.split('.');
    const v = b ? d[a][b] : d[a];
    if (el.value !== String(v == null ? '' : v)) el.value = v == null ? '' : v;
  });
}

function editorSave(mode) {
  const d = editor.doc;
  d.customer.name = (d.customer.name || '').trim();
  d.number = (d.number || '').trim();
  if (!d.customer.name) { toast('Add the customer’s name', 'error'); $('#ed-cname').focus(); return; }
  d.items = d.items.filter(i => String(i.desc || '').trim() || num(i.rate));
  if (!d.items.length) { renderLines(); toast('Add at least one charge', 'error'); return; }
  if (!d.number) { toast(`Give the ${d.kind} a number`, 'error'); $('#ed-num').focus(); return; }
  if (d.customer.email && !isEmail(d.customer.email)) { if (!confirm('The email address looks wrong. Save anyway?')) return; }
  const dup = db.docs.find(x => x.kind === d.kind && x.id !== d.id && String(x.number).trim().toLowerCase() === d.number.toLowerCase());
  if (dup && !confirm(`${d.number} is already used by another ${d.kind}. Save anyway?`)) return;
  if (mode === 'draft') d.status = 'draft';
  else if (mode === 'final') d.status = d.kind === 'invoice' ? 'issued' : 'sent';
  d.vehicle.reg = String(d.vehicle.reg || '').toUpperCase().trim();
  d.items.forEach(i => { i.qty = num(i.qty); i.rate = num(i.rate); i.desc = String(i.desc || '').trim(); });
  d.vatRate = num(d.vatRate);
  linkCustomer(d);
  const now = new Date().toISOString();
  d.updatedAt = now; if (!d.createdAt) d.createdAt = now;
  const idx = db.docs.findIndex(x => x.id === d.id);
  if (idx > -1) db.docs[idx] = d; else db.docs.push(d);
  if (d.fromQuoteId && editor.isNew) {
    const q = getDoc(d.fromQuoteId);
    if (q) { q.status = 'converted'; q.invoiceId = d.id; q.updatedAt = now; }
  }
  if (!save()) return;
  clearWip();
  editor.dirty = false;
  toast(`${d.kind === 'invoice' ? 'Invoice' : 'Quote'} ${d.number} saved`, 'success');
  location.replace('#/doc/' + d.id);
}

/* ============================== Document page ============================== */
function pageDoc(id) {
  const d = getDoc(id);
  if (!d) return notFound();
  const isInv = d.kind === 'invoice', st = statusOf(d), c = calc(d);
  setNav(isInv ? 'invoices' : 'quotes');
  setTop({ title: d.number || (isInv ? 'Invoice' : 'Quote'), back: isInv ? '#/invoices' : '#/quotes', actions: [{ label: 'Edit', icon: 'edit', href: `#/edit/${d.id}` }] });
  const t = todayISO();

  let statusCard = '';
  if (isInv && d.status === 'draft') {
    statusCard = `<div class="card"><div class="pay-top"><div><div class="label">Draft invoice</div><div class="pay-big">${money(c.total)}</div></div>${badge('draft')}</div>
      <p class="small muted">Not issued yet. Issue it when it's ready to send – it'll then count towards what you're owed.</p>
      <button class="btn btn-primary btn-block" data-act="doc-issue">${ic('check')}Issue invoice</button></div>`;
  } else if (isInv) {
    let dueTxt = '';
    if (d.dueDate && c.balance > 0) {
      const diff = daysBetween(t, d.dueDate);
      dueTxt = diff < 0 ? `<span class="red">${plural(-diff, 'day')} overdue</span> (due ${fmtDate(d.dueDate)})` : diff === 0 ? 'Due today' : `Due ${fmtDate(d.dueDate)} · in ${plural(diff, 'day')}`;
    }
    statusCard = `<div class="card">
      <div class="pay-top"><div><div class="label">${c.balance > 0 ? 'Balance due' : (c.balance < 0 ? 'Overpaid' : 'Paid in full')}</div><div class="pay-big ${st}">${money(Math.abs(c.balance > 0 ? c.balance : (c.balance < 0 ? c.balance : c.total)))}</div></div>${badge(st)}</div>
      ${dueTxt ? `<p class="small muted" style="margin:0 0 8px">${dueTxt}</p>` : ''}
      <div class="tot-row"><span>Invoice total</span><span>${money(c.total)}</span></div>
      <div class="tot-row"><span>Paid</span><span>${money(c.paid)}</span></div>
      ${c.balance > 0 ? `<button class="btn btn-green btn-block" style="margin-top:10px" data-act="pay-add">${ic('cash')}Record payment</button>` : ''}
      ${d.payments.length ? `<div style="margin-top:12px">${d.payments.map(p => `<div class="pay-line">${ic('check', 'green')}<div class="grow"><strong>${money(num(p.amount))}</strong> · ${esc(p.method)}<small>${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</small></div><button class="icon-btn danger" data-act="pay-del" data-pid="${p.id}" aria-label="Remove payment">${ic('x')}</button></div>`).join('')}</div>` : ''}
    </div>`;
  } else {
    const inv = d.invoiceId && getDoc(d.invoiceId);
    statusCard = `<div class="card">
      <div class="pay-top"><div><div class="label">Quote total</div><div class="pay-big">${money(c.total)}</div></div>${badge(st)}</div>
      ${d.validUntil ? `<p class="small muted" style="margin:0 0 10px">${st === 'expired' ? 'Expired' : 'Valid until'} ${fmtDate(d.validUntil)}</p>` : ''}
      ${st === 'converted' && inv ? `<a class="btn btn-block" href="#/doc/${inv.id}">${ic('invoice')}View invoice ${esc(inv.number)}</a>` : `
        <button class="btn btn-primary btn-block" data-act="quote-convert">${ic('convert')}Turn into invoice</button>
        <div class="btn-row">
          ${d.status === 'draft' ? '<button class="btn btn-sm" data-act="quote-status" data-s="sent">Mark sent</button>' : ''}
          ${d.status !== 'accepted' ? '<button class="btn btn-sm" data-act="quote-status" data-s="accepted">Accepted</button>' : ''}
          ${d.status !== 'declined' ? '<button class="btn btn-sm" data-act="quote-status" data-s="declined">Declined</button>' : ''}
        </div>`}
    </div>`;
  }

  const from = d.fromQuoteId && getDoc(d.fromQuoteId);
  const cust = d.customerId && getCustomer(d.customerId);
  const regKey = normReg(d.vehicle.reg);
  const links = (cust || regKey || from) ? `<div class="card">
      ${cust ? `<a class="mini-link" href="#/customer/${cust.id}"><div class="avatar">${esc(initials(cust.name))}</div><span class="grow">${esc(cust.name)}<small>${esc(cust.phone || cust.email || 'Customer')}</small></span>${ic('chevRight', 'chev')}</a>` : ''}
      ${regKey ? `<a class="mini-link" href="#/vehicle/${encodeURIComponent(regKey)}"><span class="plate">${esc(d.vehicle.reg)}</span><span class="grow">${esc(d.vehicle.make || 'Vehicle')}<small>Service history</small></span>${ic('chevRight', 'chev')}</a>` : ''}
      ${from ? `<a class="mini-link" href="#/doc/${from.id}">${ic('quote')}<span class="grow">From quote ${esc(from.number)}<small>${fmtDate(from.date)}</small></span>${ic('chevRight', 'chev')}</a>` : ''}
    </div>` : '';

  view().innerHTML = `
    <div class="doc-layout">
      <div class="doc-side">
        ${statusCard}
        <div class="doc-actions">
          <button class="btn btn-primary wide" data-act="pdf-share">${ic('share')}Send / share PDF</button>
          <button class="btn" data-act="pdf-download">${ic('download')}PDF</button>
          <button class="btn" data-act="print">${ic('print')}Print</button>
          <button class="btn" data-act="email">${ic('mail')}Email</button>
          <a class="btn" href="#/edit/${d.id}">${ic('edit')}Edit</a>
          <a class="btn" href="#/duplicate/${d.id}">${ic('copy')}Copy</a>
          <button class="btn btn-danger" data-act="doc-delete">${ic('trash')}Delete</button>
        </div>
        ${links}
      </div>
      <div class="paper" id="paper">${paperHTML(d)}</div>
    </div>`;
  view().dataset.doc = d.id;
  // Load the PDF maker in the background so "Send / share" is quick (phones need the share right after the tap)
  setTimeout(() => { loadPdfLib().catch(() => {}); }, 800);
}

function paperHTML(d) {
  const s = db.settings, c = calc(d), isInv = d.kind === 'invoice', st = statusOf(d);
  const logo = s.logo || window.RMSC_LOGO || '';
  const lines = v => String(v || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const rows = d.items.map(i => `<tr><td><span class="p-tag">${esc(ITEM_TYPES[i.type] || i.type)}</span>${esc(i.desc)}</td><td class="r">${fmtQty(i.qty)}</td><td class="r c-rate">${money(num(i.rate))}</td><td class="r">${money(lineTotal(i))}</td></tr>`).join('');
  const veh = d.vehicle;
  const terms = isInv ? (num(s.termsDays) > 0 ? `Payment due within ${num(s.termsDays)} days.` : 'Payment due on receipt.') : (d.validUntil ? `This quote is valid until ${fmtDate(d.validUntil)}.` : '');
  return `
  <div class="p-head">
    <div class="p-brand">${logo ? `<img src="${logo}" class="p-logo" alt="${esc(s.garageName)}">` : `<div class="p-garage">${esc(s.garageName)}</div>`}</div>
    <div class="p-title">
      <div class="p-kind">${isInv ? 'Invoice' : 'Quote'}</div>
      <div class="p-num">${esc(d.number)}</div>
      <table class="p-meta"><tr><th>Date</th><td>${fmtDate(d.date)}</td></tr>
        ${isInv && d.dueDate ? `<tr><th>Due</th><td>${fmtDate(d.dueDate)}</td></tr>` : ''}
        ${!isInv && d.validUntil ? `<tr><th>Valid until</th><td>${fmtDate(d.validUntil)}</td></tr>` : ''}</table>
    </div>
  </div>
  <div class="p-parties">
    <div><div class="p-label">From</div><div class="p-name">${esc(s.garageName)}</div>
      <div class="p-detail">${[s.ownerName, ...lines(s.address), s.phone, s.email].filter(Boolean).map(esc).join('<br>')}${s.vatNum ? `<br>VAT no. ${esc(s.vatNum)}` : ''}</div></div>
    <div><div class="p-label">${isInv ? 'Bill to' : 'Prepared for'}</div><div class="p-name">${esc(d.customer.name || '—')}</div>
      <div class="p-detail">${[...lines(d.customer.address), d.customer.phone, d.customer.email].filter(Boolean).map(esc).join('<br>')}</div></div>
  </div>
  ${veh.reg || veh.make ? `<div class="p-vehicle">${veh.reg ? `<span class="p-plate">${esc(veh.reg)}</span>` : ''}<span>${esc([veh.make, veh.year].filter(Boolean).join(' '))}</span>${veh.mileage ? `<span class="p-miles">${fmtInt(veh.mileage)} miles</span>` : ''}</div>` : ''}
  <table class="p-items"><thead><tr><th>Description</th><th class="r">Qty / hrs</th><th class="r c-rate">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="p-empty">No charges</td></tr>'}</tbody></table>
  <div class="p-bottom">
    <div>
      ${d.jobs.length ? `<div class="p-box"><div class="p-label">Work carried out</div><div class="p-jobs">${d.jobs.map(j => `<span>${esc(j)}</span>`).join('')}</div></div>` : ''}
      ${d.notes ? `<div class="p-box"><div class="p-label">Notes</div>${nl2br(d.notes)}</div>` : ''}
    </div>
    <div class="p-totals">
      <div><span>Subtotal</span><span>${money(c.sub)}</span></div>
      ${num(d.vatRate) > 0 ? `<div><span>VAT ${num(d.vatRate)}%</span><span>${money(c.vat)}</span></div>` : ''}
      <div class="p-grand"><span>Total</span><span>${money(c.total)}</span></div>
      ${isInv && c.paid > 0 && c.balance > 0 ? `<div><span>Paid</span><span>-${money(c.paid)}</span></div><div class="p-due"><span>Balance due</span><span>${money(c.balance)}</span></div>` : ''}
    </div>
  </div>
  ${isInv && st === 'paid' ? '<div class="p-stamp">Paid</div>' : ''}
  ${isInv && s.bank && st !== 'paid' ? `<div class="p-box p-pay"><div class="p-label">How to pay</div>${nl2br(s.bank)}<br>Please use <strong>${esc(d.number)}</strong> as the reference.</div>` : ''}
  <div class="p-foot">${esc(terms)} ${esc(s.footer || '')}</div>`;
}

/* ---------- PDF / share / email ---------- */
let pdfLibPromise = null;
const pdfCache = new Map();
function loadPdfLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!pdfLibPromise) pdfLibPromise = loadScript(PDF_LIB).catch(e => { pdfLibPromise = null; throw e; });
  return pdfLibPromise;
}
const pdfName = d => `${d.number || d.kind} ${d.customer.name || ''}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';

function pdfFor(d) {
  const stamp = (d.updatedAt || '') + '|' + (db.meta.settingsUpdatedAt || '') + '|' + todayISO();
  const hit = pdfCache.get(d.id);
  if (hit && hit.stamp === stamp) return hit.promise;
  const p = loadPdfLib().then(() => {
    const el = document.createElement('div');
    el.className = 'paper paper-pdf';
    el.innerHTML = paperHTML(d);
    return window.html2pdf().set({
      margin: [12, 12, 12, 12], filename: pdfName(d),
      image: { type: 'jpeg', quality: 0.95 },
      // scrollX/Y: 0 stops a blank/shifted PDF when the page is scrolled down (html2canvas quirk)
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0, windowWidth: document.documentElement.clientWidth },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.p-box', '.p-totals'] }
    }).from(el).outputPdf('blob');
  });
  p.catch(() => pdfCache.delete(d.id));
  pdfCache.set(d.id, { stamp, promise: p });
  return p;
}

function shareText(d) {
  const c = calc(d), s = db.settings;
  if (d.kind === 'quote') return `Hi ${firstName(d.customer.name)}, here's your quote ${d.number} from ${s.garageName} for ${money(c.total)}.`;
  return `Hi ${firstName(d.customer.name)}, here's your invoice ${d.number} from ${s.garageName} for ${money(c.balance > 0 ? c.balance : c.total)}.${c.balance <= 0 ? ' Paid in full – thank you!' : ''}`;
}

async function withBusy(btn, fn) {
  if (btn) { btn.classList.add('loading'); btn.dataset.label = btn.innerHTML; btn.innerHTML = `${ic('refresh')}Preparing…`; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.classList.remove('loading'); btn.innerHTML = btn.dataset.label; } }
}

async function sharePdf(d, btn) {
  let blob;
  try { blob = await withBusy(btn, () => pdfFor(d)); }
  catch (e) { console.error(e); toast('Couldn’t make the PDF. The first time needs an internet connection.', 'error', 5000); return; }
  const file = new File([blob], pdfName(d), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${d.kind === 'invoice' ? 'Invoice' : 'Quote'} ${d.number}`, text: shareText(d) }); afterSent(d); }
    catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') {
        openModal({ title: 'PDF ready', body: `<p>Your ${d.kind} is ready to send.</p>`, actions: `<button class="btn" data-act="modal-close">Cancel</button><button class="btn btn-primary" data-act="pdf-share-now">${ic('share')}Share now</button>` });
        pendingShare = { file, d };
        return;
      }
      console.error(e); downloadBlob(blob, file.name);
    }
  } else {
    downloadBlob(blob, file.name);
    toast('PDF downloaded – attach it to an email or message.');
  }
}
let pendingShare = null;

function afterSent(d) {
  if (d.kind === 'quote' && d.status === 'draft') { d.status = 'sent'; d.updatedAt = new Date().toISOString(); save(); rerender(); }
}

async function emailDoc(d) {
  const s = db.settings;
  const word = d.kind === 'invoice' ? 'Invoice' : 'Quote';
  if (s.emailjsService && s.emailjsTemplate && s.emailjsKey) {
    const to = s.emailTo === 'customer' ? (d.customer.email || '').trim() : (s.copyEmail || '').trim();
    if (!isEmail(to)) { toast(s.emailTo === 'customer' ? 'This customer has no valid email address' : 'Add the “send to” email in Settings → Email', 'error'); return; }
    if (!confirm(`Email ${word.toLowerCase()} ${d.number} to ${to}?`)) return;
    try {
      if (!window.emailjs) await loadScript(EMAILJS_LIB);
      window.emailjs.init({ publicKey: s.emailjsKey });
      const c = calc(d);
      await window.emailjs.send(s.emailjsService, s.emailjsTemplate, {
        to_email: to, copy_email: s.copyEmail || '', customer_email: d.customer.email || '',
        customer_name: d.customer.name, invoice_num: d.number, doc_type: word,
        garage_name: s.garageName, garage_phone: s.phone || '', garage_email: s.email || '',
        total: money(c.total), balance: money(Math.max(c.balance, 0)),
        invoice_date: fmtDate(d.date), due_date: fmtDate(d.kind === 'invoice' ? d.dueDate : d.validUntil),
        vehicle: [d.vehicle.reg, d.vehicle.make, d.vehicle.year].filter(Boolean).join(' – '),
        invoice_details: d.items.map(i => `${ITEM_TYPES[i.type] || i.type}: ${i.desc} — ${fmtQty(i.qty)} x ${money(num(i.rate))} = ${money(lineTotal(i))}`).join('\n'),
        notes: [d.jobs.length ? 'Work done: ' + d.jobs.join(', ') : '', d.notes].filter(Boolean).join('\n'),
        bank_details: d.kind === 'invoice' ? (s.bank || '') : ''
      });
      d.emailedAt = new Date().toISOString(); save();
      toast('Email sent to ' + to, 'success');
      afterSent(d);
    } catch (e) { console.error(e); toast('Email failed: ' + ((e && (e.text || e.message)) || 'check the EmailJS settings'), 'error', 5000); }
    return;
  }
  const email = (d.customer.email || '').trim();
  const c = calc(d);
  const body = `${shareText(d)}\n\n${d.items.map(i => `• ${i.desc} – ${money(lineTotal(i))}`).join('\n')}\n\nTotal: ${money(c.total)}${d.kind === 'invoice' && s.bank ? `\n\nPayment details:\n${s.bank}\nReference: ${d.number}` : ''}\n\n${s.garageName}\n${s.phone || ''}`;
  location.href = `mailto:${isEmail(email) ? email : ''}?subject=${encodeURIComponent(`${word} ${d.number} – ${s.garageName}`)}&body=${encodeURIComponent(body)}`;
  toast('Tip: “Send / share PDF” attaches the PDF for you.', '', 5000);
}

function paymentModal(d) {
  const c = calc(d);
  const last = db.settings.lastPayMethod || 'Cash';
  openModal({
    title: 'Record payment',
    body: `<div class="fields">
      <div class="field"><label for="pm-amount">Amount (£)</label><input id="pm-amount" type="text" inputmode="decimal" value="${Math.max(c.balance, 0).toFixed(2)}"><span class="help">Balance due is ${money(c.balance)}. Change it for a part payment.</span></div>
      <div class="field"><span class="label">Paid by</span><div class="seg">${PAY_METHODS.map(m => `<label><input type="radio" name="pm-method" value="${m}" ${m === last ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label for="pm-date">Date</label><input id="pm-date" type="date" value="${todayISO()}"></div>
      <div class="field"><label for="pm-note">Note</label><input id="pm-note" type="text" placeholder="Optional"></div></div>
    </div>`,
    actions: `<button class="btn" data-act="modal-close">Cancel</button><button class="btn btn-green" data-act="pay-save" data-id="${d.id}">${ic('check')}Save payment</button>`
  });
}

function pricePickerModal() {
  const list = db.priceList.slice().sort((a, b) => a.desc.localeCompare(b.desc));
  openModal({
    title: 'Price list',
    body: list.length ? `<div class="search-box">${ic('search')}<input id="pl-search" type="search" placeholder="Search…" aria-label="Search price list"></div>
      <div class="pick-list" id="pl-picks">${list.map(p => `<button type="button" class="pick" data-act="pl-pick" data-id="${p.id}" data-s="${esc(p.desc.toLowerCase())}"><span class="grow"><strong>${esc(p.desc)}</strong><small>${esc(ITEM_TYPES[p.type] || '')}</small></span><strong class="num">${money(num(p.rate))}</strong></button>`).join('')}</div>`
      : `<div class="empty">${ic('tag')}<p>Your price list is empty. Add common parts and jobs with their usual prices in Settings, then add them here with one tap.</p><a class="btn btn-primary" href="#/settings?s=prices" data-act="modal-close-go">Open settings</a></div>`,
    onMount: m => { const s = $('#pl-search', m); if (s) s.addEventListener('input', () => { const q = s.value.trim().toLowerCase(); $$('.pick', m).forEach(b => { b.hidden = q && !b.dataset.s.includes(q); }); }); }
  });
}

/* ============================== Settings ============================== */
function pageSettings(params) {
  setNav('settings');
  setTop({ title: 'Settings' });
  const s = db.settings;
  const field = (key, label, o = {}) => {
    const v = s[key] == null ? '' : s[key];
    const help = o.help ? `<span class="help">${o.help}</span>` : '';
    if (o.type === 'textarea') return `<div class="field"><label for="s-${key}">${label}</label><textarea id="s-${key}" data-s="${key}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>${help}</div>`;
    if (o.type === 'select') return `<div class="field"><label for="s-${key}">${label}</label><select id="s-${key}" data-s="${key}" ${o.num ? 'data-num' : ''}>${o.options.map(([val, l]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${help}</div>`;
    return `<div class="field"><label for="s-${key}">${label}</label><input id="s-${key}" type="${o.type || 'text'}" ${o.num ? 'inputmode="decimal" data-num' : ''} data-s="${key}" value="${esc(v)}" placeholder="${esc(o.ph || '')}" autocomplete="off">${help}</div>`;
  };
  const counts = { inv: db.docs.filter(d => d.kind === 'invoice').length, q: db.docs.filter(d => d.kind === 'quote').length, c: db.customers.length };
  const lastBackup = db.meta.lastBackup ? `${fmtDate(db.meta.lastBackup.slice(0, 10))}` : 'never';
  const emailOn = s.emailjsService && s.emailjsTemplate && s.emailjsKey;
  view().innerHTML = `
    <div class="set-nav"><div class="chips">
      <button class="chip" data-act="jump" data-to="set-garage">Garage</button>
      <button class="chip" data-act="jump" data-to="set-invoices">Invoices</button>
      <button class="chip" data-act="jump" data-to="set-prices">Price list</button>
      <button class="chip" data-act="jump" data-to="set-jobs">Jobs</button>
      <button class="chip" data-act="jump" data-to="set-backup">Backup</button>
      <button class="chip" data-act="jump" data-to="set-email">Email</button>
      <button class="chip" data-act="jump" data-to="set-app">App</button>
    </div></div>
    <p class="small muted" style="margin:0 2px 12px">Changes save automatically.</p>

    <section class="card set-section" id="set-garage">
      <div class="card-title">${ic('wrench')}Garage details</div>
      <p class="intro">Shown at the top of every invoice and quote.</p>
      <div class="logo-prev"><img src="${s.logo || window.RMSC_LOGO || ''}" alt="Logo"><div class="btn-row" style="margin:0">
        <label class="btn btn-sm" for="logo-file">${ic('upload')}Change logo</label><input id="logo-file" type="file" accept="image/*" hidden>
        ${s.logo ? '<button class="btn btn-sm" data-act="logo-reset">Use original logo</button>' : ''}</div></div>
      <div class="fields">
        <div class="grid2 stack-sm">${field('garageName', 'Garage name')}${field('ownerName', 'Your name')}</div>
        ${field('address', 'Address', { type: 'textarea', rows: 3, ph: '123 Workshop Lane\nTown\nPostcode' })}
        <div class="grid2 stack-sm">${field('phone', 'Phone', { type: 'tel' })}${field('email', 'Email', { type: 'email' })}</div>
        ${field('vatNum', 'VAT number', { ph: 'Leave blank if not VAT registered' })}
      </div>
    </section>

    <section class="card set-section" id="set-invoices">
      <div class="card-title">${ic('invoice')}Invoices &amp; quotes</div>
      <p class="intro">Defaults for new invoices. You can still change them on each one.</p>
      <div class="fields">
        <div class="grid2">${field('labourRate', 'Labour rate (£ / hour)', { num: true })}${field('calloutFee', 'Callout fee (£)', { num: true })}</div>
        <div class="grid2">
          ${field('vatDefault', 'VAT', { type: 'select', num: true, options: [[0, '0% – not VAT registered'], [5, '5%'], [20, '20%']] })}
          ${field('termsDays', 'Payment due', { type: 'select', num: true, options: [[0, 'On receipt'], [7, 'Within 7 days'], [14, 'Within 14 days'], [30, 'Within 30 days']] })}
        </div>
        <div class="grid2">
          ${field('invoicePrefix', 'Invoice number prefix', { help: 'e.g. INV-001' })}
          ${field('quotePrefix', 'Quote number prefix', { help: 'e.g. QUO-001' })}
        </div>
        ${field('quoteValidDays', 'Quotes are valid for', { type: 'select', num: true, options: [[7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']] })}
        ${field('bank', 'Bank details (printed on invoices)', { type: 'textarea', rows: 3, ph: 'Account name: R Magee\nSort code: 12-34-56\nAccount no: 12345678' })}
        ${field('footer', 'Message at the bottom', { ph: 'Thank you for your custom.' })}
      </div>
    </section>

    <section class="card set-section" id="set-prices">
      <div class="card-title">${ic('tag')}Price list</div>
      <p class="intro">Parts and jobs you charge often. Add them to an invoice with one tap.</p>
      <div class="pl-list" id="pl-list"></div>
      <button class="btn btn-sm" style="margin-top:12px" data-act="pl-add">${ic('plus')}Add item</button>
    </section>

    <section class="card set-section" id="set-jobs">
      <div class="card-title">${ic('list')}“Work carried out” list</div>
      <p class="intro">The tick-list on each invoice. One job per line.</p>
      ${field('jobs', 'Jobs', { type: 'textarea', rows: 8 })}
      <button class="btn btn-sm" style="margin-top:10px" data-act="jobs-reset">Reset to default list</button>
    </section>

    <section class="card set-section" id="set-backup">
      <div class="card-title">${ic('shield')}Backup &amp; data</div>
      <p class="intro">Everything is stored on this device only. Save a backup regularly – on a phone choose OneDrive, Google Drive or email it to yourself. You can also use a backup to move everything to another phone or computer.</p>
      <div class="data-counts kv" style="margin-top:0"><div><span>Invoices</span><b>${counts.inv}</b></div><div><span>Quotes</span><b>${counts.q}</b></div><div><span>Customers</span><b>${counts.c}</b></div></div>
      <p class="small">Last backup: <strong>${lastBackup}</strong></p>
      <div class="btn-row">
        <button class="btn btn-primary" data-act="backup-export">${ic('download')}Save backup</button>
        <label class="btn" for="import-file">${ic('upload')}Restore backup</label><input id="import-file" type="file" accept=".json,application/json" hidden>
        <button class="btn" data-act="csv-export">${ic('list')}Export CSV</button>
      </div>
      <p class="help" style="margin-top:10px">“Restore backup” also accepts data saved from the old version of this app. CSV opens in Excel – handy for your accountant.</p>
      <details style="margin-top:14px"><summary class="small" style="cursor:pointer;color:var(--red);font-weight:600">Danger zone</summary>
        <p class="small muted" style="margin-top:8px">Erase every invoice, quote and customer from this device. Your settings are kept.</p>
        <button class="btn btn-danger btn-sm" data-act="erase-all">${ic('trash')}Erase all data</button>
      </details>
    </section>

    <section class="card set-section" id="set-email">
      <div class="card-title">${ic('mail')}Email sending (optional)</div>
      <p class="intro">Not needed – “Send / share PDF” already lets you send through WhatsApp, text or your email app. Set this up only if you want the app to send emails by itself using a free <a class="link" href="https://www.emailjs.com" target="_blank" rel="noopener">EmailJS</a> account.</p>
      <p class="small">Status: <strong class="${emailOn ? 'green' : ''}">${emailOn ? 'Set up' : 'Not set up'}</strong></p>
      <div class="fields">
        ${field('emailjsService', 'Service ID', { ph: 'service_xxxxxxx' })}
        ${field('emailjsTemplate', 'Template ID', { ph: 'template_xxxxxxx' })}
        ${field('emailjsKey', 'Public key', { ph: 'xxxxxxxxxxxxxxxx' })}
        ${field('emailTo', 'Send emails to', { type: 'select', options: [['garage', 'Me (the address below)'], ['customer', 'The customer']] })}
        ${field('copyEmail', 'My email address for copies', { type: 'email' })}
      </div>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer;font-weight:600">How to set up EmailJS</summary>
        <ol class="steps" style="margin-top:8px"><li>Sign up at emailjs.com (free for 200 emails a month).</li><li>Add an email service (Gmail, Outlook…).</li>
        <li>Create a template. Set “To” to <code>{{to_email}}</code> and use any of: <code>{{customer_name}}</code> <code>{{invoice_num}}</code> <code>{{doc_type}}</code> <code>{{total}}</code> <code>{{balance}}</code> <code>{{due_date}}</code> <code>{{vehicle}}</code> <code>{{invoice_details}}</code> <code>{{notes}}</code> <code>{{bank_details}}</code> <code>{{garage_name}}</code> <code>{{garage_phone}}</code>.</li>
        <li>Paste the Service ID, Template ID and Public key above.</li></ol></details>
    </section>

    <section class="card set-section" id="set-app">
      <div class="card-title">${ic('install')}App</div>
      <div id="install-area"></div>
      <p class="small muted">Version ${APP_VERSION}${swReg ? ' · works offline' : ''}</p>
      <div class="btn-row"><button class="btn btn-sm" data-act="check-update">${ic('refresh')}Check for updates</button></div>
    </section>`;
  renderPriceList();
  renderInstallArea();
  const v = view();
  v.onchange = settingsChange;
  const jump = params && params.get('s');
  if (jump) setTimeout(() => { const el = document.getElementById('set-' + jump); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 50);
}

function renderPriceList() {
  const box = $('#pl-list');
  if (!box) return;
  box.innerHTML = db.priceList.length ? db.priceList.map(p => `
    <div class="pl-row" data-plid="${p.id}">
      <select class="pl-type" data-pl="type" aria-label="Type">${Object.entries(ITEM_TYPES).map(([k, l]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="text" data-pl="desc" value="${esc(p.desc)}" placeholder="e.g. Oil & filter service" aria-label="Description">
      <input type="text" inputmode="decimal" data-pl="rate" value="${esc(p.rate)}" placeholder="£" aria-label="Price">
      <button class="icon-btn danger" data-act="pl-del" aria-label="Remove">${ic('trash')}</button>
    </div>`).join('') : '<p class="small muted" style="margin:0">Nothing here yet.</p>';
}

function renderInstallArea() {
  const box = $('#install-area');
  if (!box) return;
  if (isStandalone()) box.innerHTML = `<p class="small">${ic('check', 'green')} Installed on this device.</p>`;
  else if (deferredInstall) box.innerHTML = `<p class="small">Install the app so it opens from your home screen and works without signal.</p><button class="btn btn-primary btn-sm" data-act="install">${ic('install')}Install app</button>`;
  else if (isIOS()) box.innerHTML = '<p class="small">To install on iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”.</p>';
  else box.innerHTML = '<p class="small">To install: open this page in Chrome or Edge and choose “Install app” or “Add to Home screen” from the browser menu.</p>';
}

function settingsChange(e) {
  const t = e.target;
  if (t.dataset.s) {
    const key = t.dataset.s;
    let v = t.value;
    if (t.hasAttribute('data-num')) v = num(v);
    if (key === 'jobs') v = Array.from(new Set(String(v).split(/\r?\n/).map(x => x.trim()).filter(Boolean)));
    if ((key === 'email' || key === 'copyEmail') && v && !isEmail(v)) toast('That email address doesn’t look right', 'error');
    db.settings[key] = v;
    db.meta.settingsUpdatedAt = new Date().toISOString();
    if (save()) toast('Saved', 'success', 1200);
    if (key === 'garageName') setTop({ title: 'Settings' });
    return;
  }
  if (t.dataset.pl) {
    const row = t.closest('[data-plid]');
    const p = db.priceList.find(x => x.id === row.dataset.plid);
    if (!p) return;
    p[t.dataset.pl] = t.dataset.pl === 'rate' ? num(t.value) : t.value.trim();
    if (save()) toast('Saved', 'success', 1200);
    return;
  }
  if (t.id === 'logo-file' && t.files[0]) return handleLogo(t.files[0]);
  if (t.id === 'import-file' && t.files[0]) { const f = t.files[0]; t.value = ''; return importBackup(f); }
}

function handleLogo(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const sc = Math.min(1, 1000 / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    db.settings.logo = c.toDataURL('image/jpeg', 0.86);
    db.meta.settingsUpdatedAt = new Date().toISOString();
    URL.revokeObjectURL(url);
    if (save()) { applyLogo(); toast('Logo updated', 'success'); rerender(); }
  };
  img.onerror = () => toast('Couldn’t read that image', 'error');
  img.src = url;
}
function applyLogo() { const el = $('#side-logo-img'); if (el) el.src = db.settings.logo || window.RMSC_LOGO || ''; }

/* ---------- Backup / restore ---------- */
async function exportBackup() {
  const data = JSON.stringify({ ...db, app: 'rmsc-invoicing', exportedAt: new Date().toISOString() });
  const name = `RMSC-backup-${todayISO()}.json`;
  const blob = new Blob([data], { type: 'application/json' });
  let done = false;
  if (coarse() && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'RMSC backup' }); done = true; }
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!done) downloadBlob(blob, name);
  db.meta.lastBackup = new Date().toISOString();
  save();
  toast(done ? 'Backup shared' : 'Backup file downloaded', 'success');
  if (parseHash().path === '/settings' || parseHash().path === '/') rerender();
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a backup file', 'error'); return; }
  let incoming;
  if (data && Array.isArray(data.docs)) incoming = normalise(data);
  else if (data && (Array.isArray(data.invoices) || data.settings)) incoming = fromOldFormat(data);
  else { toast('That file isn’t a recognised backup', 'error'); return; }
  const ni = incoming.docs.filter(d => d.kind === 'invoice').length, nq = incoming.docs.filter(d => d.kind === 'quote').length;
  const summary = `${plural(ni, 'invoice')}, ${plural(nq, 'quote')} and ${plural(incoming.customers.length, 'customer')}`;
  pendingImport = incoming;
  const hasData = db.docs.length || db.customers.length;
  openModal({
    title: 'Restore backup',
    body: `<p>This backup has <strong>${summary}</strong>.</p>${hasData ? `<p class="small muted"><strong>Merge</strong> adds anything missing to what's already here. <strong>Replace</strong> wipes this device and uses only the backup.</p>` : ''}`,
    actions: `<button class="btn" data-act="modal-close">Cancel</button>${hasData ? '<button class="btn" data-act="import-do" data-mode="replace">Replace</button><button class="btn btn-primary" data-act="import-do" data-mode="merge">Merge</button>' : '<button class="btn btn-primary" data-act="import-do" data-mode="replace">Restore</button>'}`
  });
}
let pendingImport = null;

function doImport(mode) {
  const inc = pendingImport; pendingImport = null;
  if (!inc) return;
  try { localStorage.setItem('rmsc-before-import', JSON.stringify(db)); } catch (e) { /* not fatal */ }
  if (mode === 'replace') {
    db = inc; db.meta.migratedOnLoad = false;
  } else {
    const idMap = {};
    inc.customers.forEach(c => {
      const ex = db.customers.find(x => x.id === c.id) || findCustomer(c, db.customers);
      if (ex) idMap[c.id] = ex.id; else { db.customers.push(c); idMap[c.id] = c.id; }
    });
    const sig = d => [d.kind, String(d.number).trim().toLowerCase(), d.date, calc(d).total].join('|');
    const have = new Set(db.docs.map(d => d.id)), haveSig = new Set(db.docs.map(sig));
    let added = 0;
    inc.docs.forEach(d => {
      if (have.has(d.id) || haveSig.has(sig(d))) return;
      if (d.customerId) d.customerId = idMap[d.customerId] || d.customerId;
      db.docs.push(d); added++;
    });
    inc.priceList.forEach(p => { if (!db.priceList.find(x => x.id === p.id || x.desc === p.desc)) db.priceList.push(p); });
    toast(`${plural(added, 'record')} added`, 'success');
  }
  if (save()) { applyLogo(); closeModal(); if (mode === 'replace') toast('Backup restored', 'success'); location.hash = '#/'; rerender(); }
}

function exportCsv() {
  const rows = [['Type', 'Number', 'Date', 'Due / valid until', 'Status', 'Customer', 'Phone', 'Email', 'Reg', 'Vehicle', 'Mileage', 'Subtotal', 'VAT', 'Total', 'Paid', 'Balance', 'Work carried out']];
  db.docs.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(d => {
    const c = calc(d);
    rows.push([d.kind, d.number, d.date, d.kind === 'invoice' ? d.dueDate : d.validUntil, STATUS_LABEL[statusOf(d)], d.customer.name, d.customer.phone, d.customer.email, d.vehicle.reg, [d.vehicle.make, d.vehicle.year].filter(Boolean).join(' '), d.vehicle.mileage, c.sub.toFixed(2), c.vat.toFixed(2), c.total.toFixed(2), c.paid.toFixed(2), c.balance.toFixed(2), d.jobs.join('; ')]);
  });
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `RMSC-invoices-${todayISO()}.csv`);
}

/* ============================== Actions ============================== */
Object.assign(ACTIONS, {
  'back': el => { location.hash = el.dataset.href || '#/'; },
  'modal-close': () => closeModal(),
  'modal-close-go': el => { closeModal(); if (editor && editor.dirty) { saveWip(); } location.hash = el.getAttribute('href'); },
  'replace-hash': el => { location.replace(el.dataset.href); },
  'jump': el => { const t = document.getElementById(el.dataset.to); if (t) t.scrollIntoView({ behavior: 'smooth' }); },
  'wip-discard': () => { if (confirm('Discard the unfinished ' + (readWip() || { doc: { kind: 'invoice' } }).doc.kind + '?')) { clearWip(); rerender(); } },
  'dismiss-migrated': () => { db.meta.migratedOnLoad = false; save(); rerender(); },
  'install': async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) { /* ignore */ } deferredInstall = null; rerender(); },
  'install-dismiss': () => { db.meta.installDismissed = true; save(); rerender(); },
  'check-update': async () => { if (!swReg) { toast('Updates are checked automatically when the app is online.'); return; } try { await swReg.update(); toast(swReg.waiting || swReg.installing ? 'Downloading update…' : 'You have the latest version'); } catch (e) { toast('Couldn’t check – are you online?', 'error'); } },

  // customers
  'customer-add': () => customerModal(null),
  'customer-edit': el => customerModal(getCustomer(el.dataset.id)),
  'customer-save': el => {
    const name = $('#cm-name').value.trim(), email = $('#cm-email').value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    if (email && !isEmail(email)) { toast('That email address doesn’t look right', 'error'); return; }
    const vals = { name, email, phone: $('#cm-phone').value.trim(), address: $('#cm-address').value.trim() };
    let c = el.dataset.id && getCustomer(el.dataset.id);
    if (c) Object.assign(c, vals);
    else {
      c = { id: uid(), ...vals, vehicles: [], createdAt: new Date().toISOString() };
      const reg = $('#cm-reg') && $('#cm-reg').value;
      if (normReg(reg)) addCustomerVehicle(c, { reg, make: $('#cm-make').value });
      db.customers.push(c);
    }
    if (save()) { closeModal(); toast('Customer saved', 'success'); if (!el.dataset.id) location.hash = '#/customer/' + c.id; else rerender(); }
  },
  'customer-delete': el => {
    const c = getCustomer(el.dataset.id); if (!c) return;
    const n = db.docs.filter(d => d.customerId === c.id).length;
    if (!confirm(`Delete ${c.name}?${n ? ` Their ${plural(n, 'invoice/quote', 'invoices/quotes')} will be kept.` : ''}`)) return;
    db.customers = db.customers.filter(x => x.id !== c.id);
    db.docs.forEach(d => { if (d.customerId === c.id) d.customerId = ''; });
    if (save()) { toast('Customer deleted'); location.hash = '#/customers'; }
  },

  // vehicles on customers
  'vehicle-add': el => { const c = getCustomer(el.dataset.id); if (c) vehicleModal(c, null); },
  'vehicle-edit': el => {
    const c = getCustomer(el.dataset.id); if (!c) return;
    const key = el.dataset.reg, vi = vehicleIndex().get(key);
    const saved = (c.vehicles || []).find(x => normReg(x.reg) === key);
    vehicleModal(c, { reg: (saved || vi || {}).reg || key, make: (saved && saved.make) || (vi && vi.make) || '', year: (saved && saved.year) || (vi && vi.year) || '' });
  },
  'vehicle-save': el => {
    const c = getCustomer(el.dataset.id); if (!c) return;
    const reg = $('#vm-reg').value.trim().toUpperCase(), key = normReg(reg);
    if (key.length < 2) { toast('Enter the registration', 'error'); $('#vm-reg').focus(); return; }
    const isNew = !$('#vm-reg').readOnly;
    if (isNew) {
      if ((c.vehicles || []).some(x => normReg(x.reg) === key)) { toast(`${reg} is already on ${firstName(c.name)}'s list`, 'error'); return; }
      const other = db.customers.find(x => x.id !== c.id && (x.vehicles || []).some(v => normReg(v.reg) === key));
      if (other && !confirm(`${reg} is also saved under ${other.name}. Move it to ${c.name}?`)) return;
      if (other) other.vehicles = other.vehicles.filter(v => normReg(v.reg) !== key);
    }
    const rec = addCustomerVehicle(c, { reg, make: $('#vm-make').value, year: $('#vm-year').value });
    // allow clearing make/year when editing
    rec.make = $('#vm-make').value.trim(); rec.year = $('#vm-year').value.trim();
    if (save()) { closeModal(); toast(`${reg} saved`, 'success'); rerender(); }
  },
  'vehicle-remove': el => {
    const c = getCustomer(el.dataset.id); if (!c) return;
    const key = el.dataset.reg;
    const v = (c.vehicles || []).find(x => normReg(x.reg) === key);
    if (!confirm(`Remove ${v ? v.reg : key} from ${c.name}?`)) return;
    c.vehicles = (c.vehicles || []).filter(x => normReg(x.reg) !== key);
    if (save()) { toast('Vehicle removed'); rerender(); }
  },

  // editor
  'ed-save': el => editorSave(el.dataset.mode),
  'li-add': el => { editor.doc.items.push(newItem(el.dataset.type)); renderLines(); updateTotals(); markDirty(); const rows = $$('#lines .li'); const last = rows[rows.length - 1]; if (last) { const inp = $('[data-k=desc]', last); if (!coarse()) inp.focus(); last.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
  'li-del': el => { const id = el.closest('.li').dataset.id; editor.doc.items = editor.doc.items.filter(i => i.id !== id); renderLines(); updateTotals(); markDirty(); },
  'job-toggle': el => { const j = el.dataset.job, d = editor.doc; const i = d.jobs.indexOf(j); if (i > -1) d.jobs.splice(i, 1); else d.jobs.push(j); el.classList.toggle('on', i === -1); updateJobsCount(); markDirty(); },
  'job-add': el => {
    const j = el.dataset.job.trim(); if (!j) return;
    if (!editor.doc.jobs.includes(j)) editor.doc.jobs.push(j);
    if (!db.settings.jobs.includes(j) && confirm(`Add “${j}” to your jobs list for next time too?`)) { db.settings.jobs.push(j); save(); }
    el.remove();
    $('#jobchips').insertAdjacentHTML('afterbegin', `<button type="button" class="jc on" data-act="job-toggle" data-job="${esc(j)}">${esc(j)}</button>`);
    $('#jobs-filter').value = ''; filterJobs(''); updateJobsCount(); markDirty();
  },
  'ta-pick': el => {
    const c = getCustomer(el.dataset.id); if (!c || !editor) return;
    const d = editor.doc;
    d.customerId = c.id;
    d.customer = { name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '' };
    $('#ta-list').hidden = true;
    syncEditorInputs(); updateRegHint(); markDirty();
  },
  'reg-fill': () => {
    const d = editor.doc, v = editor.vindex.get(normReg(d.vehicle.reg)); if (!v) return;
    fillVehicle(d, v); syncEditorInputs(); updateRegHint(); markDirty();
    if (v.mileage) toast(`Last recorded mileage: ${fmtInt(v.mileage)}`);
  },
  'vpick': el => { const d = editor.doc, v = editor.vindex.get(el.dataset.reg); if (!v) return; fillVehicle(d, v); syncEditorInputs(); updateRegHint(); markDirty(); },
  'pl-open': () => pricePickerModal(),
  'pl-pick': el => {
    const p = db.priceList.find(x => x.id === el.dataset.id); if (!p || !editor) return;
    editor.doc.items.push({ id: uid(), type: p.type || 'parts', desc: p.desc, qty: 1, rate: num(p.rate) });
    closeModal(); renderLines(); updateTotals(); markDirty(); toast(`Added ${p.desc}`);
  },

  // document
  'doc-issue': () => { const d = getDoc(view().dataset.doc); if (!d) return; d.status = 'issued'; if (!d.dueDate) d.dueDate = addDays(d.date, db.settings.termsDays); d.updatedAt = new Date().toISOString(); save(); toast('Invoice issued', 'success'); rerender(); },
  'pay-add': () => { const d = getDoc(view().dataset.doc); if (d) paymentModal(d); },
  'pay-save': el => {
    const d = getDoc(el.dataset.id); if (!d) return;
    const amount = round2(num($('#pm-amount').value));
    if (amount <= 0) { toast('Enter the amount paid', 'error'); return; }
    const method = ($('input[name=pm-method]:checked') || {}).value || 'Other';
    d.payments.push({ id: uid(), amount, method, date: $('#pm-date').value || todayISO(), note: $('#pm-note').value.trim() });
    if (d.status === 'draft') d.status = 'issued';
    d.updatedAt = new Date().toISOString();
    db.settings.lastPayMethod = method;
    if (save()) { closeModal(); toast(calc(d).balance <= 0 ? 'Paid in full' : `${money(amount)} recorded`, 'success'); rerender(); }
  },
  'pay-del': el => {
    const d = getDoc(view().dataset.doc); if (!d) return;
    if (!confirm('Remove this payment?')) return;
    d.payments = d.payments.filter(p => p.id !== el.dataset.pid); d.updatedAt = new Date().toISOString();
    save(); rerender();
  },
  'quote-status': el => { const d = getDoc(view().dataset.doc); if (!d) return; d.status = el.dataset.s; d.updatedAt = new Date().toISOString(); save(); toast(`Quote marked ${STATUS_LABEL[el.dataset.s].toLowerCase()}`, 'success'); rerender(); },
  'quote-convert': () => { const d = getDoc(view().dataset.doc); if (d) location.hash = '#/convert/' + d.id; },
  'doc-delete': () => {
    const d = getDoc(view().dataset.doc); if (!d) return;
    if (!confirm(`Delete ${d.kind} ${d.number}? This can't be undone.`)) return;
    if (d.fromQuoteId) { const q = getDoc(d.fromQuoteId); if (q && q.invoiceId === d.id) { q.status = 'accepted'; delete q.invoiceId; } }
    db.docs = db.docs.filter(x => x.id !== d.id);
    if (save()) { toast(`${d.number} deleted`); location.hash = d.kind === 'invoice' ? '#/invoices' : '#/quotes'; }
  },
  'pdf-share': el => { const d = getDoc(view().dataset.doc); if (d) sharePdf(d, el); },
  'pdf-share-now': async () => { const p = pendingShare; pendingShare = null; closeModal(); if (!p) return; try { await navigator.share({ files: [p.file], title: p.d.number, text: shareText(p.d) }); afterSent(p.d); } catch (e) { if (e.name !== 'AbortError') downloadBlob(p.file, p.file.name); } },
  'pdf-download': async el => { const d = getDoc(view().dataset.doc); if (!d) return; try { const b = await withBusy(el, () => pdfFor(d)); downloadBlob(b, pdfName(d)); } catch (e) { console.error(e); toast('Couldn’t make the PDF. The first time needs an internet connection.', 'error', 5000); } },
  'print': () => window.print(),
  'email': () => { const d = getDoc(view().dataset.doc); if (d) emailDoc(d); },

  // settings
  'logo-reset': () => { db.settings.logo = ''; db.meta.settingsUpdatedAt = new Date().toISOString(); save(); applyLogo(); rerender(); },
  'pl-add': () => { db.priceList.push({ id: uid(), type: 'parts', desc: '', rate: 0 }); save(); renderPriceList(); const rows = $$('#pl-list .pl-row'); const last = rows[rows.length - 1]; if (last) $('[data-pl=desc]', last).focus(); },
  'pl-del': el => { const id = el.closest('[data-plid]').dataset.plid; db.priceList = db.priceList.filter(p => p.id !== id); save(); renderPriceList(); },
  'jobs-reset': () => { if (!confirm('Reset the jobs list to the default?')) return; db.settings.jobs = DEFAULT_JOBS.slice(); save(); rerender(); },
  'backup-export': () => exportBackup(),
  'csv-export': () => exportCsv(),
  'import-do': el => doImport(el.dataset.mode),
  'erase-all': () => {
    const typed = prompt('This deletes every invoice, quote and customer on this device.\nType DELETE to confirm.');
    if (typed !== 'DELETE') return;
    db.docs = []; db.customers = []; save(); clearWip(); toast('All data erased'); location.hash = '#/';
  }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'modal-bg') { if (e.target === el) closeModal(); return; }
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  fn(el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal();
  if (e.key === 'Escape') { const l = $('#ta-list'); if (l) l.hidden = true; }
});
window.addEventListener('beforeunload', e => { if (editor && editor.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ============================== PWA ============================== */
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const p = parseHash().path; if (p === '/' || p === '/settings') rerender(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('Installed – find RMSC on your home screen', 'success'); });

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // first visit: don't reload when offline mode switches on
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !hadController) return; reloading = true; location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    const offer = w => toast('A new version is ready', '', 15000, { label: 'Update', fn: () => w.postMessage({ type: 'SKIP_WAITING' }) });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw); });
    });
  }).catch(err => console.warn('Service worker not registered', err));
}

/* ============================== Start ============================== */
db = load();
if (db.meta.migratedOnLoad) save();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
applyLogo();
window.addEventListener('hashchange', () => route());
route();
registerSW();
// Expose for debugging in the browser console
window.RMSC = { get db() { return db; }, version: APP_VERSION, pdf: id => pdfFor(getDoc(id)) };
})();
