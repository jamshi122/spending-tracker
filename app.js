// ============================================
// ⚠️ PASTE YOUR URLS HERE
// ============================================
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxhJXudubUWPaHt62mcnx1yl0JpAWJOBv4dszwo6caBJPUiB-dTHzgdTXFCrhvAZC5m/exec";
const SHEET_URL   = "https://docs.google.com/spreadsheets/d/1syWFz8Gx_0yRmREAFBqyrSDCsladhzS5_-RmcIzvJbY/edit?gid=1251417057#gid=1251417057";
const CURRENCY    = "QR";
// Default Admin PIN (change this!). Stored only in frontend for family use.
const ADMIN_PIN   = "1234";
// ============================================

const FALLBACK_CATS = [
  {id:'1', name:'Fuel', type:'expense', icon:'⛽', parentId:''},
  {id:'2', name:'Food & Dining', type:'expense', icon:'🍔', parentId:''},
  {id:'3', name:'Transportation', type:'expense', icon:'🚗', parentId:''},
  {id:'4', name:'Housing', type:'expense', icon:'🏠', parentId:''},
  {id:'5', name:'Shopping', type:'expense', icon:'🛍️', parentId:''},
  {id:'6', name:'Entertainment', type:'expense', icon:'🎬', parentId:''},
  {id:'7', name:'Health', type:'expense', icon:'💊', parentId:''},
  {id:'8', name:'Bills & Subscriptions', type:'expense', icon:'📄', parentId:''},
  {id:'9', name:'Other', type:'expense', icon:'📌', parentId:''},
  {id:'10', name:'Salary', type:'income', icon:'💼', parentId:''},
  {id:'11', name:'Business', type:'income', icon:'🏢', parentId:''},
  {id:'12', name:'Other Income', type:'income', icon:'💵', parentId:''}
];

// Simple keyword → category mapping for receipt text parser (bonus)
const RECEIPT_KEYWORDS = {
  'Food & Dining': ['burger','pizza','coffee','tea','meal','restaurant','food','lunch','dinner','breakfast','sandwich','shawarma','kebab','chicken','rice','water','juice','cola','soda','snack','bakery','bread','milk','egg','grocery','supermarket','carrefour','lulu','mono','talabat','deliveroo'],
  'Shopping': ['dress','shirt','pants','shoes','clothes','clothing','t-shirt','jeans','bag','wallet','perfume','watch','electronics','phone','charger','cable','earphone','gift'],
  'Fuel': ['petrol','diesel','fuel','gas station','woqod','shell','total'],
  'Transportation': ['taxi','uber','careem','parking','salik','toll','metro','bus'],
  'Health': ['pharmacy','medicine','doctor','clinic','hospital','dental','gym'],
  'Entertainment': ['movie','cinema','ticket','game','netflix','spotify'],
  'Personal Care': ['haircut','salon','spa','massage','cosmetics'],
  'Housing': ['rent','electricity','kahramaa','internet','wifi','ooredoo','vodafone']
};

let state = {
  transactions: [], accounts: [], cards: [], payments: [],
  fuel: [], categories: [], users: [], budgets: [],
  currentUserId: localStorage.getItem('currentUser') || '',
  isAdmin: false,
  receiptFile: null,          // File object waiting to upload
  existingReceiptUrl: ''      // when editing
};

// ---------- Utilities ----------
function money(n) {
  const v = parseFloat(n) || 0;
  return `${CURRENCY} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

function showSaving(title = 'Saving…', hint = 'This can take a few seconds') {
  document.getElementById('saving-title').textContent = title;
  document.getElementById('saving-hint').textContent = hint;
  document.getElementById('saving-overlay').classList.remove('hidden');
}
function hideSaving() {
  document.getElementById('saving-overlay').classList.add('hidden');
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const spin = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  if (text) text.classList.toggle('hidden', loading);
  if (spin) spin.classList.toggle('hidden', !loading);
}

async function fetchJSON(url, opts = {}, ms = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function api(action, payload = {}) {
  try {
    const json = await fetchJSON(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload })
    });
    setStatus(json.success);
    return json;
  } catch (e) {
    setStatus(false);
    return { success: false, error: e.toString() };
  }
}

function setStatus(online) {
  const el = document.getElementById('status');
  if (el) el.className = 'status-dot' + (online ? '' : ' offline');
}

function isAdmin() {
  const u = state.users.find(x => x.id === state.currentUserId);
  return !!(u && (u.role === 'admin' || u.name === 'Husband')); // fallback for old data
}

function getUserName(uid) {
  const u = state.users.find(x => x.id === uid);
  return u ? u.name : '—';
}

function canEditTx(tx) {
  if (isAdmin()) return true;
  return String(tx.userId) === String(state.currentUserId);
}

function canManageAccount(ownerId) {
  if (isAdmin()) return true;
  return String(ownerId) === String(state.currentUserId);
}

// ---------- Normalization ----------
function normalizeTx(t) {
  return {
    id: String(t.id),
    date: normalizeDate(t.date),
    type: t.type,
    amount: parseFloat(t.amount) || 0,
    category: t.category || '',
    subcategory: t.subcategory || '',
    product: t.product || '',
    note: t.note || '',
    accountId: String(t.accountId || ''),
    cardId: String(t.cardId || ''),
    userId: String(t.userId || ''),
    fuelId: String(t.fuelId || ''),
    receiptUrl: t.receiptUrl || '',
    isPrivate: String(t.isPrivate) === 'true' || t.isPrivate === true
  };
}
function normalizeAcc(a) {
  return { id: String(a.id), name: a.name, type: a.type, owner: String(a.owner), balance: parseFloat(a.balance) || 0, currency: a.currency || 'QAR' };
}
function normalizeCard(c) {
  return { id: String(c.id), name: c.name, last4: String(c.last4 || ''), owner: String(c.owner),
    limit: parseFloat(c.limit) || 0, balance: parseFloat(c.balance) || 0, dueDay: parseInt(c.dueDay) || 15, color: c.color || '#1c1c1e' };
}
function normalizeFuel(f) {
  return { id: String(f.id), date: normalizeDate(f.date), vehicle: f.vehicle, odometer: parseFloat(f.odometer) || 0,
    liters: parseFloat(f.liters) || 0, pricePerLiter: parseFloat(f.pricePerLiter) || 0, total: parseFloat(f.total) || 0,
    cardId: String(f.cardId || ''), accountId: String(f.accountId || ''), userId: String(f.userId || ''), fullTank: String(f.fullTank) === 'true' };
}
function normalizeDate(d) {
  if (!d) return new Date().toISOString().split('T')[0];
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.split('T')[0];
  const date = new Date(d);
  return isNaN(date) ? new Date().toISOString().split('T')[0] : date.toISOString().split('T')[0];
}

// ---------- Data loading ----------
async function fetchAll() {
  if (!BACKEND_URL || BACKEND_URL.includes("PASTE_YOUR")) return false;
  try {
    const json = await fetchJSON(BACKEND_URL);
    if (json.success) {
      state.transactions = (json.data.TX || []).map(normalizeTx);
      state.accounts    = (json.data.ACC || []).map(normalizeAcc);
      state.cards       = (json.data.CARD || []).map(normalizeCard);
      state.payments    = json.data.PAY || [];
      state.fuel        = (json.data.FUEL || []).map(normalizeFuel);
      state.categories  = (json.data.CAT && json.data.CAT.length > 0) ? json.data.CAT : FALLBACK_CATS;
      state.users       = json.data.USER || [];
      state.budgets     = json.data.BUDGET || [];
      setStatus(true);
      return true;
    }
    setStatus(false);
    return false;
  } catch (e) { setStatus(false); return false; }
}

// ---------- Visibility filters ----------
// Default: BOTH users see ALL transactions, cash and expenses.
// Exception: a transaction marked isPrivate is only visible to its creator (and admin).
function visibleTxs() {
  const uid = state.currentUserId;
  return state.transactions.filter(t => {
    if (!t.isPrivate) return true;                    // public → everyone sees it
    if (!uid) return true;                            // no profile selected → show all
    if (String(t.userId) === String(uid)) return true; // owner always sees own private
    if (isAdmin()) return true;                       // admin can see everything
    return false;                                     // hide private txs of others
  });
}

// Cash & cards: both users always see all balances (shared family view)
function visibleAccounts() {
  return state.accounts;
}

function visibleCards() {
  return state.cards;
}

// ---------- Navigation ----------
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelector(`.nav-btn[data-view="${name}"]`).classList.add('active');
  document.getElementById('page-title').innerText = name === 'dashboard' ? 'Dashboard' : name.charAt(0).toUpperCase() + name.slice(1);

  if (name === 'dashboard') renderDashboard();
  if (name === 'add') populateAddForm();
  if (name === 'accounts') renderAccounts();
  if (name === 'settings') renderSettings();
  if (name === 'history') renderHistory();
}
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---------- Dashboard ----------
function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

function renderDashboard() {
  const txs = visibleTxs();
  const accs = visibleAccounts();
  const cards = visibleCards();
  const cash = accs.reduce((s, a) => s + a.balance, 0);
  const debt = cards.reduce((s, c) => s + c.balance, 0);
  const net = cash - debt;

  const cutoff30 = dateOffset(-30);
  const recent30 = txs.filter(t => t.date >= cutoff30);
  const income = recent30.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = recent30.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const saved = income - expense;

  document.getElementById('dash-net').innerText = money(net);
  document.getElementById('dash-cash').innerText = money(cash);
  document.getElementById('dash-cards').innerText = money(debt);
  document.getElementById('dash-income').innerText = money(income).replace('.00','');
  document.getElementById('dash-expense').innerText = money(expense).replace('.00','');
  document.getElementById('dash-saved').innerText = money(saved).replace('.00','');

  renderDonut(recent30.filter(t => t.type === 'expense'));
  renderMonthlyChart(txs);
  renderCashCardBar(recent30.filter(t => t.type === 'expense'));
  renderTopCategories(recent30.filter(t => t.type === 'expense'));
  renderFuelSummary(state.fuel.filter(f => isAdmin() || f.userId === state.currentUserId));
  renderDashboardBudgets();
  renderRecent(txs);
}

function renderDonut(expenses) {
  const totals = {};
  expenses.forEach(t => totals[t.category || 'Other'] = (totals[t.category || 'Other'] || 0) + t.amount);
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const wrap = document.getElementById('donut-chart');
  const legend = document.getElementById('donut-legend');
  if (sorted.length === 0) { wrap.innerHTML = '<div class="empty">No expenses in 30 days</div>'; legend.innerHTML = ''; return; }
  const total = sorted.reduce((s, [,v]) => s + v, 0);
  const colors = ['#ff3b30','#ff9500','#ffcc00','#34c759','#007aff','#5856d6','#af52de','#ff2d55','#8e8e93','#00c7be'];
  let acc = 0;
  const stops = sorted.map(([name, val], i) => {
    const start = (acc / total) * 360; acc += val; const end = (acc / total) * 360;
    return `${colors[i % colors.length]} ${start}deg ${end}deg`;
  }).join(', ');
  wrap.innerHTML = `<div class="donut" style="background: conic-gradient(${stops})"><div class="donut-center"><small>Total</small><b>${money(total).replace('.00','')}</b></div></div>`;
  legend.innerHTML = sorted.slice(0, 8).map(([name, val], i) => `
    <div class="legend-item"><span class="legend-dot" style="background:${colors[i % colors.length]}"></span><span class="legend-name">${getCategoryIcon(name)} ${name}</span><span class="legend-val">${((val/total)*100).toFixed(0)}%</span></div>
  `).join('');
}

function renderMonthlyChart(txs) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleString('en', { month: 'short' }) });
  }
  const data = months.map(m => {
    const inc = txs.filter(t => t.date.startsWith(m.key) && t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const exp = txs.filter(t => t.date.startsWith(m.key) && t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    return { label: m.label, inc, exp };
  });
  const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
  document.getElementById('monthly-chart').innerHTML = data.map(d => `
    <div class="bar-group"><div class="bar-pair"><div class="bar inc" style="height:${(d.inc/max)*100}%"></div><div class="bar exp" style="height:${(d.exp/max)*100}%"></div></div><div class="bar-label">${d.label}</div></div>
  `).join('');
}

function renderCashCardBar(expenses) {
  const cash = expenses.filter(t => t.accountId).reduce((s, t) => s + t.amount, 0);
  const card = expenses.filter(t => t.cardId).reduce((s, t) => s + t.amount, 0);
  const total = cash + card;
  const el = document.getElementById('cashcard-bar');
  if (!el) return;
  if (total === 0) { el.innerHTML = '<div class="empty" style="width:100%">No data</div>'; return; }
  const cp = (cash/total)*100, dp = (card/total)*100;
  el.innerHTML = `<div class="cashcard-seg" style="width:${cp}%;background:#34c759">${cp > 15 ? cp.toFixed(0)+'%' : ''}</div><div class="cashcard-seg" style="width:${dp}%;background:#007aff">${dp > 15 ? dp.toFixed(0)+'%' : ''}</div>`;
}

function renderTopCategories(expenses) {
  const totals = {};
  expenses.forEach(t => totals[t.category || 'Other'] = (totals[t.category || 'Other'] || 0) + t.amount);
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0, 5);
  document.getElementById('dash-top-cats').innerHTML = sorted.length
    ? sorted.map(([name, amt]) => `<div class="item"><div class="item-icon">${getCategoryIcon(name)}</div><div class="item-info"><div class="item-title">${name}</div></div><div class="item-amt expense">${money(amt)}</div></div>`).join('')
    : '<div class="empty">No expenses yet</div>';
}

function renderFuelSummary(fuelLogs) {
  const perVehicle = calcFuelPerVehicle(fuelLogs);
  const keys = Object.keys(perVehicle);
  document.getElementById('dash-fuel').innerHTML = keys.length
    ? keys.map(v => {
        const s = perVehicle[v];
        return `<div class="vehicle-card"><div class="vehicle-name">🚗 ${v}</div><div class="vehicle-stats"><div class="vstat"><small>Efficiency</small><b>${s.efficiency}</b></div><div class="vstat"><small>Total km</small><b>${s.totalKm}</b></div><div class="vstat"><small>Cost/km</small><b>${s.costPerKm}</b></div></div></div>`;
      }).join('')
    : '<div class="empty">No fuel logs</div>';
}

function calcFuelPerVehicle(fuelLogs) {
  const byVehicle = {};
  fuelLogs.filter(f => f.fullTank).forEach(f => (byVehicle[f.vehicle] = byVehicle[f.vehicle] || []).push(f));
  const out = {};
  Object.entries(byVehicle).forEach(([vehicle, logs]) => {
    logs.sort((a,b) => a.odometer - b.odometer);
    let km = 0, L = 0, cost = 0;
    for (let i = 1; i < logs.length; i++) {
      const d = logs[i].odometer - logs[i-1].odometer;
      if (d > 0 && logs[i].liters > 0) { km += d; L += logs[i].liters; cost += logs[i].total; }
    }
    out[vehicle] = { efficiency: km > 0 ? ((L/km)*100).toFixed(1) + ' L/100' : '—', totalKm: km.toFixed(0), costPerKm: km > 0 ? money(cost/km) : '—', lastOdo: logs[logs.length-1].odometer, fillCount: logs.length };
  });
  return out;
}

function renderRecent(txs) {
  const recent = [...txs].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 8);
  document.getElementById('dash-recent').innerHTML = recent.length ? recent.map(txRowHTML).join('') : '<div class="empty">No transactions yet</div>';
}

function txRowHTML(t) {
  const icon = getCategoryIcon(t.category);
  const cls = t.type === 'income' ? 'income' : 'expense';
  const sign = t.type === 'income' ? '+' : '-';
  const sub = [t.subcategory, t.product, t.note].filter(Boolean).join(' • ');
  const source = t.cardId ? '💳' : t.accountId ? '💵' : '';
  const who = getUserName(t.userId);
  const receipt = t.receiptUrl ? ' 📎' : '';
  const lock = t.isPrivate ? ' 🔒' : '';
  return `<div class="item" onclick="openEditModal('${t.id}')">
    <div class="item-icon">${icon}</div>
    <div class="item-info">
      <div class="item-title">${escapeHtml(t.category || 'Other')}${receipt}${lock}</div>
      ${sub ? `<div class="item-sub">${escapeHtml(sub)}</div>` : ''}
      <div class="item-sub">${t.date} ${source}</div>
      <div class="item-user">👤 ${escapeHtml(who)}${t.isPrivate ? ' · private' : ''}</div>
    </div>
    <div class="item-amt ${cls}">${sign}${money(t.amount)}</div>
  </div>`;
}

function getCategoryIcon(name) {
  const cat = state.categories.find(c => c.name === name);
  return cat ? cat.icon : '📌';
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- History ----------
let historyFilter = { q: '', range: '30', type: 'all', group: 'none' };

document.getElementById('btn-history')?.addEventListener('click', () => { switchView('history'); renderHistory(); });
document.getElementById('search-input')?.addEventListener('input', (e) => { historyFilter.q = e.target.value.toLowerCase(); renderHistory(); });
document.getElementById('filter-range')?.addEventListener('change', (e) => { historyFilter.range = e.target.value; renderHistory(); });
document.getElementById('filter-type')?.addEventListener('change', (e) => { historyFilter.type = e.target.value; renderHistory(); });
document.getElementById('group-by')?.addEventListener('change', (e) => { historyFilter.group = e.target.value; renderHistory(); });

function renderHistory() {
  let list = visibleTxs();

  if (historyFilter.range !== 'all') {
    const cutoff = dateOffset(-parseInt(historyFilter.range));
    list = list.filter(t => t.date >= cutoff);
  }
  if (historyFilter.type !== 'all') list = list.filter(t => t.type === historyFilter.type);
  if (historyFilter.q) {
    list = list.filter(t => (t.category + ' ' + t.subcategory + ' ' + t.product + ' ' + t.note + ' ' + getUserName(t.userId)).toLowerCase().includes(historyFilter.q));
  }
  list.sort((a,b) => b.date.localeCompare(a.date));

  const inc = list.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const exp = list.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const net = inc - exp;
  document.getElementById('history-summary').innerHTML = `
    <div class="hsum income">Income: <b>${money(inc)}</b></div>
    <div class="hsum expense">Expense: <b>${money(exp)}</b></div>
    <div class="hsum net">Net: <b>${money(net)}</b></div>
  `;

  if (historyFilter.group === 'none') {
    document.getElementById('history-list').innerHTML = list.length ? list.map(historyRowHTML).join('') : '<div class="empty">No matching transactions</div>';
    return;
  }

  const groups = {};
  list.forEach(t => {
    let key;
    if (historyFilter.group === 'month') {
      key = t.date.substring(0, 7);
    } else {
      const d = new Date(t.date + 'T12:00:00');
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      key = d.toISOString().split('T')[0];
    }
    if (!groups[key]) groups[key] = { items: [], inc: 0, exp: 0, startDate: t.date, endDate: t.date };
    groups[key].items.push(t);
    if (t.type === 'income') groups[key].inc += t.amount;
    else groups[key].exp += t.amount;
    if (t.date < groups[key].startDate) groups[key].startDate = t.date;
    if (t.date > groups[key].endDate) groups[key].endDate = t.date;
  });

  const sortedKeys = Object.keys(groups).sort().reverse();
  let html = '';
  sortedKeys.forEach(k => {
    const g = groups[k];
    let headerText = '';
    if (historyFilter.group === 'month') {
      const [y, m] = k.split('-');
      headerText = new Date(y, m - 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    } else {
      const s = new Date(g.startDate + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const e = new Date(g.endDate + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
      headerText = `Week of ${s} - ${e}`;
    }
    html += `<div class="group-header" onclick="toggleGroup('${k}')">
      <div class="group-title"><span>▼</span> ${headerText}</div>
      <div class="group-totals">
        <span class="income">+${money(g.inc)}</span>
        <span class="expense">-${money(g.exp)}</span>
      </div>
    </div>`;
    html += `<div class="group-body" id="group-${k}">`;
    html += g.items.map(historyRowHTML).join('');
    html += `</div>`;
  });
  document.getElementById('history-list').innerHTML = html || '<div class="empty">No matching transactions</div>';
}

function historyRowHTML(t) {
  return txRowHTML(t);
}

window.toggleGroup = function(k) {
  const el = document.getElementById(`group-${k}`);
  if (el) el.classList.toggle('hidden-group');
};

// ---------- Edit / Delete Modal ----------
let editingId = null;

function openEditModal(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  editingId = id;
  const sub = [tx.subcategory, tx.product].filter(Boolean).join(' • ');
  const who = getUserName(tx.userId);
  const canEdit = canEditTx(tx);
  // Owner or admin can toggle privacy
  const canTogglePrivacy = canEdit || isAdmin();

  document.getElementById('edit-details').innerHTML = `
    <div><b>${getCategoryIcon(tx.category)} ${escapeHtml(tx.category)}</b></div>
    ${sub ? `<div>${escapeHtml(sub)}</div>` : ''}
    <div><b style="font-size:18px">${money(tx.amount)}</b> ${tx.type.toUpperCase()}</div>
    <div>📅 ${tx.date}</div>
    <div>👤 ${escapeHtml(who)}</div>
    ${tx.note ? `<div>📝 ${escapeHtml(tx.note)}</div>` : ''}
    ${tx.receiptUrl ? `<div style="margin-top:8px"><a href="${escapeHtml(tx.receiptUrl)}" target="_blank" class="link-btn">📎 View attached bill</a></div>` : ''}
    <div style="margin-top:12px;padding:10px;background:${tx.isPrivate ? '#fff3cd' : '#e8f5e9'};border-radius:10px;font-size:13px;">
      ${tx.isPrivate
        ? '🔒 <b>Private</b> — only you (and Admin) can see this'
        : '👁 <b>Visible to both</b> — family can see this'}
    </div>
    ${canTogglePrivacy ? `
      <button type="button" class="btn-secondary" id="btn-toggle-privacy" style="margin-top:10px;border-color:${tx.isPrivate ? '#34c759' : '#ff9500'};color:${tx.isPrivate ? '#34c759' : '#ff9500'}">
        ${tx.isPrivate ? '👁 Make visible to both' : '🔒 Hide from others (private)'}
      </button>
    ` : ''}
  `;

  document.getElementById('edit-delete').style.display = canEdit ? '' : 'none';
  document.getElementById('edit-open').style.display = canEdit ? '' : 'none';
  document.getElementById('edit-modal').classList.remove('hidden');

  // Wire privacy toggle
  const privacyBtn = document.getElementById('btn-toggle-privacy');
  if (privacyBtn) {
    privacyBtn.onclick = async () => {
      const newPrivate = !tx.isPrivate;
      showSaving(newPrivate ? 'Hiding from others…' : 'Making visible…');
      const res = await api('updateTx', {
        id: tx.id,
        data: {
          date: tx.date, type: tx.type, amount: tx.amount, category: tx.category,
          subcategory: tx.subcategory, product: tx.product, note: tx.note,
          accountId: tx.accountId, cardId: tx.cardId,
          receiptUrl: tx.receiptUrl || '',
          isPrivate: newPrivate
        }
      });
      hideSaving();
      if (!res.success) { toast('Failed: ' + (res.error || ''), 'error'); return; }
      await fetchAll();
      document.getElementById('edit-modal').classList.add('hidden');
      editingId = null;
      renderDashboard();
      if (document.getElementById('view-history').classList.contains('active')) renderHistory();
      toast(newPrivate ? 'Hidden from others 🔒' : 'Now visible to both 👁', 'success');
    };
  }
}

document.getElementById('edit-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
});

document.getElementById('edit-delete').addEventListener('click', async () => {
  if (!editingId) return;
  const tx = state.transactions.find(t => t.id === editingId);
  if (!tx || !canEditTx(tx)) {
    toast('You can only delete your own transactions', 'error');
    return;
  }
  if (!confirm('Delete this transaction?')) return;

  showSaving('Deleting…');
  const res = await api('deleteTx', { id: editingId });
  hideSaving();
  if (!res.success) { toast('Failed: ' + res.error, 'error'); return; }
  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
  await fetchAll();
  renderDashboard();
  if (document.getElementById('view-history').classList.contains('active')) renderHistory();
  toast('Deleted', 'success');
});

document.getElementById('edit-open').addEventListener('click', () => {
  const tx = state.transactions.find(t => t.id === editingId);
  if (!tx || !canEditTx(tx)) {
    toast('You can only edit your own transactions', 'error');
    return;
  }
  document.getElementById('edit-modal').classList.add('hidden');
  document.getElementById('tx-edit-id').value = tx.id;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-date').value = tx.date;
  document.getElementById('tx-note').value = tx.note;
  document.getElementById('tx-product').value = tx.product;
  document.getElementById('tx-type').value = tx.type;
  addType = tx.type;
  document.querySelectorAll('.tab[data-type]').forEach(t => t.classList.toggle('active', t.dataset.type === tx.type));
  document.getElementById('form-tx').classList.remove('hidden');
  document.getElementById('form-payment').classList.add('hidden');

  state.existingReceiptUrl = tx.receiptUrl || '';
  state.receiptFile = null;
  updateReceiptUI();

  populateCategories();
  setTimeout(() => {
    document.getElementById('tx-category').value = tx.category;
    updateSubcategories();
    setTimeout(() => { document.getElementById('tx-subcategory').value = tx.subcategory || ''; }, 30);
    document.getElementById('tx-source').value = tx.cardId ? 'card' : 'account';
    updateSourceOptions();
    setTimeout(() => { document.getElementById('tx-source-id').value = tx.cardId || tx.accountId; }, 30);
  }, 30);

  document.getElementById('btn-save-tx').querySelector('.btn-text').innerText = 'Update Transaction';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');
  switchView('add');
});

document.getElementById('btn-cancel-edit').addEventListener('click', () => resetAddForm());

function resetAddForm() {
  document.getElementById('tx-edit-id').value = '';
  document.getElementById('form-tx').reset();
  document.getElementById('tx-type').value = addType;
  document.getElementById('btn-save-tx').querySelector('.btn-text').innerText = 'Save';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
  state.receiptFile = null;
  state.existingReceiptUrl = '';
  updateReceiptUI();
  document.getElementById('receipt-text').value = '';
  document.getElementById('parse-suggestions').classList.add('hidden');
  populateAddForm();
}

// ---------- Add Form ----------
let addType = 'expense';
document.querySelectorAll('.tab[data-type]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-type]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    addType = tab.dataset.type;
    document.getElementById('form-tx').classList.toggle('hidden', addType === 'payment');
    document.getElementById('form-payment').classList.toggle('hidden', addType !== 'payment');
    if (addType !== 'payment') { document.getElementById('tx-type').value = addType; populateCategories(); }
  });
});

function populateAddForm() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('tx-date').value = today;
  document.getElementById('pay-date').value = today;
  populateCategories();
  populatePayOptions();
  updateSourceOptions();
  updateFuelFieldVisibility();
  // vehicle datalist
  const vehicles = [...new Set(state.fuel.map(f => f.vehicle).filter(Boolean))];
  document.getElementById('vehicle-list').innerHTML = vehicles.map(v => `<option value="${escapeHtml(v)}">`).join('');
}

function populateCategories() {
  const type = document.getElementById('tx-type').value;
  const cats = state.categories && state.categories.length > 0 ? state.categories : FALLBACK_CATS;
  const parents = cats.filter(c => c.type === type && !c.parentId);
  document.getElementById('tx-category').innerHTML = parents.length > 0
    ? parents.map(c => `<option value="${escapeHtml(c.name)}">${c.icon || '📌'} ${c.name}</option>`).join('')
    : '<option value="">No categories found</option>';
  updateSubcategories();
  updateFuelFieldVisibility();
}

function updateSubcategories() {
  const parentName = document.getElementById('tx-category').value;
  const parent = state.categories.find(c => c.name === parentName && !c.parentId);
  const subs = parent ? state.categories.filter(c => c.parentId === parent.id) : [];
  document.getElementById('tx-subcategory').innerHTML = '<option value="">— None —</option>' +
    subs.map(s => `<option value="${escapeHtml(s.name)}">${s.icon || '📌'} ${s.name}</option>`).join('');
  document.getElementById('fg-subcategory').classList.toggle('hidden', subs.length === 0);
}

function updateFuelFieldVisibility() {
  const isFuel = document.getElementById('tx-category').value === 'Fuel';
  document.getElementById('fuel-fields').classList.toggle('hidden', !isFuel);
  if (isFuel) {
    const vehicles = [...new Set(state.fuel.map(f => f.vehicle))];
    if (vehicles.length > 0 && !document.getElementById('fuel-vehicle').value) {
      document.getElementById('fuel-vehicle').value = vehicles[vehicles.length - 1];
      const lastFuel = [...state.fuel].filter(f => f.vehicle === document.getElementById('fuel-vehicle').value).sort((a,b) => b.date.localeCompare(a.date))[0];
      if (lastFuel) document.getElementById('fuel-odo').placeholder = `Last: ${lastFuel.odometer} km`;
    }
  }
}

document.getElementById('tx-category').addEventListener('change', () => { updateSubcategories(); updateFuelFieldVisibility(); });
document.getElementById('tx-source').addEventListener('change', updateSourceOptions);

['fuel-liters','fuel-ppl'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const l = parseFloat(document.getElementById('fuel-liters').value) || 0;
    const p = parseFloat(document.getElementById('fuel-ppl').value) || 0;
    document.getElementById('fuel-total').value = (l * p).toFixed(2);
    if (!document.getElementById('fuel-fields').classList.contains('hidden')) {
      document.getElementById('tx-amount').value = (l * p).toFixed(2);
    }
  });
});

function updateSourceOptions() {
  const source = document.getElementById('tx-source').value;
  const sel = document.getElementById('tx-source-id');
  if (source === 'account') {
    const accs = visibleAccounts();
    sel.innerHTML = accs.map(a => `<option value="${a.id}">${a.name} (${getUserName(a.owner)}) — ${money(a.balance)}</option>`).join('') || '<option value="">No accounts</option>';
  } else {
    const cards = visibleCards();
    sel.innerHTML = cards.map(c => `<option value="${c.id}">${c.name} •${c.last4} (${getUserName(c.owner)}) — ${money(c.balance)}</option>`).join('') || '<option value="">No cards</option>';
  }
}

function populatePayOptions() {
  document.getElementById('pay-card').innerHTML = visibleCards().map(c => `<option value="${c.id}">${c.name} •${c.last4} (${getUserName(c.owner)}) — ${money(c.balance)} owed</option>`).join('') || '<option value="">No cards</option>';
  document.getElementById('pay-account').innerHTML = visibleAccounts().map(a => `<option value="${a.id}">${a.name} — ${money(a.balance)}</option>`).join('') || '<option value="">No accounts</option>';
}

// ---------- Receipt attachment UI ----------
const receiptInput = document.getElementById('tx-receipt');
receiptInput.addEventListener('change', () => {
  const file = receiptInput.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast('File too large (max 8 MB)', 'error');
    receiptInput.value = '';
    return;
  }
  state.receiptFile = file;
  state.existingReceiptUrl = '';
  updateReceiptUI();
});

document.getElementById('btn-clear-receipt').addEventListener('click', () => {
  state.receiptFile = null;
  state.existingReceiptUrl = '';
  receiptInput.value = '';
  updateReceiptUI();
});

function updateReceiptUI() {
  const nameEl = document.getElementById('receipt-name');
  const preview = document.getElementById('receipt-preview');
  const clearBtn = document.getElementById('btn-clear-receipt');

  if (state.receiptFile) {
    nameEl.textContent = state.receiptFile.name;
    clearBtn.classList.remove('hidden');
    if (state.receiptFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(state.receiptFile);
      preview.innerHTML = `<img src="${url}" alt="preview">`;
      preview.classList.remove('hidden');
    } else {
      preview.innerHTML = `<span>📄 ${escapeHtml(state.receiptFile.name)}</span>`;
      preview.classList.remove('hidden');
    }
  } else if (state.existingReceiptUrl) {
    nameEl.textContent = 'Attached bill';
    clearBtn.classList.remove('hidden');
    preview.innerHTML = `<a href="${escapeHtml(state.existingReceiptUrl)}" target="_blank">📎 View current attachment</a>`;
    preview.classList.remove('hidden');
  } else {
    nameEl.textContent = '';
    clearBtn.classList.add('hidden');
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

// ---------- Receipt text parser (bonus) ----------
document.getElementById('btn-parse-receipt').addEventListener('click', () => {
  const text = document.getElementById('receipt-text').value.trim();
  if (!text) { toast('Paste some receipt lines first'); return; }

  const lines = text.split(/\n|;/).map(l => l.trim()).filter(Boolean);
  const suggestions = [];

  lines.forEach(line => {
    // Try to extract amount at the end: "Item name 25.50" or "25.50 Item"
    let amount = 0, desc = line;
    const m1 = line.match(/^(.*?)[\s:]+(\d+[.,]\d{1,3})$/);
    const m2 = line.match(/^(\d+[.,]\d{1,3})[\s:]+(.*)$/);
    if (m1) { desc = m1[1].trim(); amount = parseFloat(m1[2].replace(',','.')); }
    else if (m2) { amount = parseFloat(m2[1].replace(',','.')); desc = m2[2].trim(); }
    else {
      const nums = line.match(/(\d+[.,]\d{1,3})/g);
      if (nums) amount = parseFloat(nums[nums.length-1].replace(',','.'));
    }
    if (!amount || amount <= 0) return;

    const lower = desc.toLowerCase();
    let cat = 'Other';
    for (const [category, words] of Object.entries(RECEIPT_KEYWORDS)) {
      if (words.some(w => lower.includes(w))) { cat = category; break; }
    }
    suggestions.push({ desc, amount, category: cat });
  });

  const box = document.getElementById('parse-suggestions');
  if (suggestions.length === 0) {
    box.innerHTML = '<div class="hint">No priced items found. Format like: “Burger 25.00”</div>';
  } else {
    box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Suggested items (tap to use as single transaction):</div>' +
      suggestions.map((s, i) => `
        <div class="parse-item">
          <span>${escapeHtml(s.desc)} → <b>${s.category}</b> ${money(s.amount)}</span>
          <button type="button" onclick="applySuggestion(${i})">Use</button>
        </div>`).join('') +
      `<div class="hint" style="margin-top:8px">Tip: For multiple items create separate transactions (or keep total and note the items).</div>`;
    window._parseSuggestions = suggestions;
  }
  box.classList.remove('hidden');
});

window.applySuggestion = function(idx) {
  const s = window._parseSuggestions?.[idx];
  if (!s) return;
  document.getElementById('tx-amount').value = s.amount.toFixed(2);
  document.getElementById('tx-product').value = s.desc;
  // try set category
  const catSelect = document.getElementById('tx-category');
  const opt = [...catSelect.options].find(o => o.value === s.category);
  if (opt) {
    catSelect.value = s.category;
    updateSubcategories();
    updateFuelFieldVisibility();
  }
  toast(`Filled: ${s.category} ${money(s.amount)}`, 'success');
};

// ---------- File → base64 helper ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve({ base64, mimeType: file.type, name: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Submit transaction ----------
document.getElementById('form-tx').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentUserId) {
    toast('Please select your profile first', 'error');
    return;
  }

  const editId = document.getElementById('tx-edit-id').value;
  const category = document.getElementById('tx-category').value;
  const isFuel = category === 'Fuel';
  let amount = parseFloat(document.getElementById('tx-amount').value);
  if (isFuel && !editId) amount = parseFloat(document.getElementById('fuel-total').value) || amount;
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

  const sourceType = document.getElementById('tx-source').value;
  const sourceId = document.getElementById('tx-source-id').value;
  if (!sourceId) { toast('Add an account or card first', 'error'); return; }

  // Permission: when editing, must own it
  if (editId) {
    const existing = state.transactions.find(t => t.id === editId);
    if (existing && !canEditTx(existing)) {
      toast('You cannot edit another user’s transaction', 'error');
      return;
    }
  }

  const btn = document.getElementById('btn-save-tx');
  setButtonLoading(btn, true);
  showSaving(editId ? 'Updating…' : 'Saving…', 'Uploading data to Google Sheet');

  try {
    // 1. Upload receipt if present
    let receiptUrl = state.existingReceiptUrl || '';
    if (state.receiptFile) {
      showSaving('Uploading bill…', 'Please wait');
      const { base64, mimeType, name } = await fileToBase64(state.receiptFile);
      const up = await api('uploadReceipt', { data: { base64, mimeType, name } });
      if (!up.success) throw new Error(up.error || 'Upload failed');
      receiptUrl = up.url || '';
    }

    // 2. Save transaction
    showSaving(editId ? 'Updating transaction…' : 'Saving transaction…');

    if (editId) {
      const subVal = document.getElementById('tx-subcategory').value;
      const existing = state.transactions.find(t => t.id === editId);
      const res = await api('updateTx', { id: editId, data: {
        date: document.getElementById('tx-date').value,
        type: document.getElementById('tx-type').value,
        amount, category, subcategory: subVal,
        product: document.getElementById('tx-product').value,
        note: document.getElementById('tx-note').value,
        accountId: sourceType === 'account' ? sourceId : '',
        cardId: sourceType === 'card' ? sourceId : '',
        receiptUrl,
        isPrivate: existing ? existing.isPrivate : false
      }});
      if (!res.success) throw new Error(res.error || 'Update failed');
    } else if (isFuel) {
      const res = await api('addFuel', { data: {
        id: Date.now().toString(),
        date: document.getElementById('tx-date').value,
        vehicle: document.getElementById('fuel-vehicle').value.trim(),
        odometer: parseFloat(document.getElementById('fuel-odo').value),
        liters: parseFloat(document.getElementById('fuel-liters').value),
        pricePerLiter: parseFloat(document.getElementById('fuel-ppl').value),
        total: amount,
        fullTank: document.getElementById('fuel-full').checked,
        cardId: sourceType === 'card' ? sourceId : '',
        accountId: sourceType === 'account' ? sourceId : '',
        userId: state.currentUserId,
        note: document.getElementById('tx-note').value,
        receiptUrl,
        isPrivate: false
      }});
      if (!res.success) throw new Error(res.error || 'Save failed');
    } else {
      const subVal = document.getElementById('tx-subcategory').value;
      const res = await api('addTx', { data: {
        id: Date.now().toString(),
        date: document.getElementById('tx-date').value,
        type: document.getElementById('tx-type').value,
        amount, category, subcategory: subVal,
        product: document.getElementById('tx-product').value,
        note: document.getElementById('tx-note').value,
        accountId: sourceType === 'account' ? sourceId : '',
        cardId: sourceType === 'card' ? sourceId : '',
        userId: state.currentUserId,
        fuelId: '',
        receiptUrl,
        isPrivate: false
      }});
      if (!res.success) throw new Error(res.error || 'Save failed');
    }

    await fetchAll();
    resetAddForm();
    switchView('dashboard');
    toast('Saved successfully', 'success');
  } catch (err) {
    toast(String(err.message || err), 'error');
  } finally {
    setButtonLoading(btn, false);
    hideSaving();
  }
});

// ---------- Payment form ----------
document.getElementById('form-payment').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentUserId) { toast('Select your profile first', 'error'); return; }

  const btn = document.getElementById('btn-save-payment');
  setButtonLoading(btn, true);
  showSaving('Recording payment…');

  try {
    const res = await api('addPayment', { data: {
      id: Date.now().toString(),
      date: document.getElementById('pay-date').value,
      cardId: document.getElementById('pay-card').value,
      accountId: document.getElementById('pay-account').value,
      amount: parseFloat(document.getElementById('pay-amount').value),
      note: document.getElementById('pay-note').value,
      userId: state.currentUserId
    }});
    if (!res.success) throw new Error(res.error || 'Failed');
    await fetchAll();
    document.getElementById('form-payment').reset();
    document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
    switchView('dashboard');
    toast('Payment recorded', 'success');
  } catch (err) {
    toast(String(err.message || err), 'error');
  } finally {
    setButtonLoading(btn, false);
    hideSaving();
  }
});

// ---------- Accounts ----------
function renderAccounts() {
  const accs = visibleAccounts();
  const cards = visibleCards();

  document.getElementById('accounts-list').innerHTML = accs.length
    ? accs.map(a => `<div class="item"><div class="item-icon">🏦</div><div class="item-info"><div class="item-title">${escapeHtml(a.name)}</div><div class="item-sub">${a.type.toUpperCase()} • ${getUserName(a.owner)}</div></div><div class="item-amt">${money(a.balance)}</div></div>`).join('')
    : '<div class="empty">No accounts yet</div>';

  document.getElementById('cards-list').innerHTML = cards.length
    ? cards.map(c => `<div class="item"><div class="item-icon" style="background:${c.color}22">💳</div><div class="item-info"><div class="item-title">${escapeHtml(c.name)} •${c.last4}</div><div class="item-sub">${getUserName(c.owner)} • Limit ${money(c.limit)}</div></div><div class="item-amt expense">${money(c.balance)}</div></div>`).join('')
    : '<div class="empty">No cards yet</div>';
}

document.getElementById('btn-add-account').addEventListener('click', async () => {
  if (!state.currentUserId) { toast('Select your profile first', 'error'); return; }
  const name = prompt('Account name:'); if (!name) return;
  const type = prompt('Type (cash/bank/savings/wallet):', 'bank') || 'bank';
  const balance = parseFloat(prompt('Opening balance (QR):', '0') || '0');
  const owner = isAdmin() ? (prompt('Owner user id (leave blank for yourself):', state.currentUserId) || state.currentUserId) : state.currentUserId;

  showSaving('Adding account…');
  await api('addAccount', { data: { id: Date.now().toString(), name, type, owner, balance, currency: 'QAR' }});
  await fetchAll();
  hideSaving();
  renderAccounts();
  toast('Account added', 'success');
});

document.getElementById('btn-add-card').addEventListener('click', async () => {
  if (!state.currentUserId) { toast('Select your profile first', 'error'); return; }
  const name = prompt('Card name:'); if (!name) return;
  const last4 = prompt('Last 4 digits:', '0000') || '0000';
  const limit = parseFloat(prompt('Credit limit (QR):', '5000') || '5000');
  const dueDay = parseInt(prompt('Due day of month (1-28):', '15') || '15');
  const owner = isAdmin() ? (prompt('Owner user id (leave blank for yourself):', state.currentUserId) || state.currentUserId) : state.currentUserId;
  const color = prompt('Color hex:', '#1c1c1e') || '#1c1c1e';

  showSaving('Adding card…');
  await api('addCard', { data: { id: Date.now().toString(), name, last4, owner, limit, balance: 0, dueDay, color }});
  await fetchAll();
  hideSaving();
  renderAccounts();
  toast('Card added', 'success');
});

// ---------- Admin panel ----------
function renderAdminPanel() {
  const listEl = document.getElementById('admin-cat-list');
  if (!state.categories.length) {
    listEl.innerHTML = '<div class="hint">No categories found.</div>';
  } else {
    listEl.innerHTML = state.categories.map(c => `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #eee; font-size:12px;">
        <span>${c.icon || '📌'} ${escapeHtml(c.name)} (${c.type})</span>
        ${c.parentId ? '' : '<span style="color:#8e8e93; font-size:10px;">Main</span>'}
      </div>
    `).join('');
  }

  const usersEl = document.getElementById('admin-users-list');
  usersEl.innerHTML = state.users.map(u => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #eee">
      <span>${escapeHtml(u.name)} ${u.role === 'admin' ? '👑' : ''}</span>
      <span style="color:#8e8e93;font-size:11px">${u.id}</span>
    </div>
  `).join('') || '<div class="hint">No users</div>';
}

document.getElementById('btn-admin-add-cat').addEventListener('click', async () => {
  if (!isAdmin()) return;
  const type = prompt('Type (income or expense):', 'expense');
  if (type !== 'income' && type !== 'expense') return toast('Must be income or expense', 'error');
  const name = prompt('Category Name (e.g. Pet Food):'); if (!name) return;
  const icon = prompt('Emoji Icon (e.g. 🐶):', '📌') || '📌';
  const parentName = prompt('Is this a subcategory? Type the Main Category name (or leave blank for Main):');
  let parentId = '';
  if (parentName) {
    const parent = state.categories.find(c => c.name.toLowerCase() === parentName.toLowerCase());
    if (parent) parentId = parent.id;
    else return toast('Main category not found!', 'error');
  }
  showSaving('Adding category…');
  await api('addCategory', { data: {
    id: Date.now().toString(), name, type, icon, parentId, color: '#007AFF', sortOrder: 99
  }});
  await fetchAll();
  hideSaving();
  renderAdminPanel();
  populateCategories();
  toast('Category added', 'success');
});

document.getElementById('btn-admin-add-user').addEventListener('click', async () => {
  if (!isAdmin()) return;
  const name = prompt('User Name (e.g. Son, Daughter):'); if (!name) return;
  const role = prompt('Role (admin or user):', 'user') || 'user';
  showSaving('Adding user…');
  await api('addUser', { data: {
    id: Date.now().toString(), name, color: '#ff9500', role: role === 'admin' ? 'admin' : 'user'
  }});
  await fetchAll();
  hideSaving();
  renderAdminPanel();
  renderUserSwitcher();
  toast('User added', 'success');
});

// ---------- Budgets ----------
function renderDashboardBudgets() {
  const cutoff = dateOffset(-30);
  const uid = state.currentUserId;
  const uid_txs = visibleTxs().filter(t => t.date >= cutoff && t.type === 'expense');
  const budgets = state.budgets || [];
  if (budgets.length === 0) {
    document.getElementById('dash-budgets').innerHTML = '<div class="empty">No budgets set yet. Go to More → Budgets.</div>';
    return;
  }
  document.getElementById('dash-budgets').innerHTML = budgets.map(b => {
    const spent = uid_txs.filter(t => t.category === b.category).reduce((s,t) => s + t.amount, 0);
    const pct = Math.min(100, (spent / b.amount) * 100);
    const cls = spent >= b.amount ? 'over' : pct >= 80 ? 'warn' : 'ok';
    return `<div class="budget-row"><div class="budget-head"><span>${getCategoryIcon(b.category)} ${escapeHtml(b.category)}</span><span>${money(spent)} / ${money(b.amount)}</span></div><div class="budget-bar"><div class="budget-fill ${cls}" style="width:${pct}%"></div></div></div>`;
  }).join('');
}

function renderBudgetsSettings() {
  const budgets = state.budgets || [];
  document.getElementById('budgets-list').innerHTML = budgets.length
    ? budgets.map(b => `<div class="budget-row"><div class="budget-head"><span>${getCategoryIcon(b.category)} ${escapeHtml(b.category)}</span><span>${money(b.amount)}/mo</span></div><button class="link-btn" onclick="deleteBudget('${b.id}')" style="color:#ff3b30">Remove</button></div>`).join('')
    : '<p class="hint">No budgets yet.</p>';
}
window.deleteBudget = async (id) => {
  if (!confirm('Remove budget?')) return;
  showSaving('Removing…');
  await api('deleteBudget', { id });
  await fetchAll();
  hideSaving();
  renderBudgetsSettings();
};

document.getElementById('btn-add-budget').addEventListener('click', async () => {
  const cat = prompt('Category name (e.g. Fuel):'); if (!cat) return;
  const amt = parseFloat(prompt('Monthly budget in QR:')); if (!amt) return;
  showSaving('Saving budget…');
  await api('saveBudget', { data: { category: cat, amount: amt, period: 'monthly', userId: state.currentUserId || '' }});
  await fetchAll();
  hideSaving();
  renderBudgetsSettings();
});

// ---------- Dark mode ----------
const darkToggle = document.getElementById('toggle-dark');
const isDark = localStorage.getItem('darkMode') === '1';
if (isDark) { document.body.classList.add('dark'); darkToggle.checked = true; }
darkToggle.addEventListener('change', (e) => {
  if (e.target.checked) { document.body.classList.add('dark'); localStorage.setItem('darkMode', '1'); }
  else { document.body.classList.remove('dark'); localStorage.setItem('darkMode', '0'); }
});

// ---------- Settings ----------
function renderSettings() {
  const admin = isAdmin();
  document.getElementById('admin-panel').classList.toggle('hidden', !admin);
  document.getElementById('sheet-box').classList.toggle('hidden', !admin);
  if (admin) document.getElementById('sheet-link').href = SHEET_URL;

  document.getElementById('info-count').innerText = `${state.transactions.length} transactions • ${state.accounts.length} accounts • ${state.cards.length} cards`;
  document.getElementById('info-user').innerText = `Signed in as: ${getUserName(state.currentUserId)}${admin ? ' (Admin)' : ''}`;

  renderBudgetsSettings();
  if (admin) renderAdminPanel();

  document.getElementById('btn-export').onclick = () => {
    const list = visibleTxs();
    let csv = `Date,Type,Amount (${CURRENCY}),Category,Subcategory,Product,Note,User,Account,Card,Receipt\n`;
    list.forEach(t => {
      csv += `${t.date},${t.type},${t.amount},"${t.category}","${t.subcategory}","${(t.product||'').replace(/"/g,'""')}","${(t.note||'').replace(/"/g,'""')}","${getUserName(t.userId)}","${t.accountId}","${t.cardId}","${t.receiptUrl||''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('btn-sync').onclick = async () => {
    showSaving('Syncing…');
    await fetchAll();
    hideSaving();
    renderSettings();
    toast('Synced!', 'success');
  };

  document.getElementById('btn-check-update').onclick = () => {
    const overlay = document.getElementById('update-overlay');
    const bar = document.getElementById('update-progress');
    const text = document.getElementById('update-text');
    overlay.classList.remove('hidden');
    let progress = 0;
    bar.style.width = '0%';
    text.innerText = '0%';
    const interval = setInterval(() => {
      progress += 5;
      if (progress > 90) progress = 90;
      bar.style.width = progress + '%';
      text.innerText = progress + '%';
      if (progress >= 90) {
        clearInterval(interval);
        setTimeout(() => {
          bar.style.width = '100%';
          text.innerText = '100%';
          window.location.href = window.location.pathname + '?update=' + Date.now();
        }, 300);
      }
    }, 40);
  };
}

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('currentUser');
  state.currentUserId = '';
  showLoginGate();
});

// ---------- User switcher / Login ----------
function renderUserSwitcher() {
  const sel = document.getElementById('user-switcher');
  const badge = document.getElementById('current-user-badge');
  if (!state.users.length) {
    sel.innerHTML = '<option>Loading...</option>';
    badge.textContent = '';
    return;
  }

  if (isAdmin()) {
    // Admin can switch freely (including "Both")
    sel.classList.remove('hidden');
    badge.classList.add('hidden');
    sel.innerHTML = '<option value="">👥 Both (Admin)</option>' +
      state.users.map(u => `<option value="${u.id}">${u.name}${u.role === 'admin' ? ' 👑' : ''}</option>`).join('');
    sel.value = state.currentUserId || '';
  } else {
    // Regular user: locked to self
    sel.classList.add('hidden');
    badge.classList.remove('hidden');
    badge.textContent = getUserName(state.currentUserId);
  }
}

document.getElementById('user-switcher').addEventListener('change', (e) => {
  if (!isAdmin()) return;
  state.currentUserId = e.target.value;
  localStorage.setItem('currentUser', state.currentUserId);
  renderDashboard();
  if (document.getElementById('view-history').classList.contains('active')) renderHistory();
  if (document.getElementById('view-accounts').classList.contains('active')) renderAccounts();
});

function showLoginGate() {
  document.getElementById('login-gate').classList.remove('hidden');
  const box = document.getElementById('login-users');
  box.innerHTML = state.users.map(u => `
    <button class="login-user-btn" data-id="${u.id}">
      <span style="font-size:22px">${u.role === 'admin' ? '👑' : '👤'}</span>
      <span>${escapeHtml(u.name)}${u.role === 'admin' ? ' (Admin)' : ''}</span>
    </button>
  `).join('') || '<div class="hint">No users yet – will seed on first load</div>';

  box.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const user = state.users.find(u => u.id === id);
      if (!user) return;

      // Admin requires PIN
      if (user.role === 'admin' || user.name === 'Husband') {
        document.getElementById('pin-section').classList.remove('hidden');
        document.getElementById('login-error').classList.add('hidden');
        document.getElementById('login-pin').value = '';
        document.getElementById('login-pin').focus();
        document.getElementById('btn-login').onclick = () => {
          const pin = document.getElementById('login-pin').value;
          if (pin === ADMIN_PIN) {
            completeLogin(id);
          } else {
            document.getElementById('login-error').classList.remove('hidden');
          }
        };
      } else {
        completeLogin(id);
      }
    });
  });
}

function completeLogin(userId) {
  state.currentUserId = userId;
  localStorage.setItem('currentUser', userId);
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('pin-section').classList.add('hidden');
  renderUserSwitcher();
  renderDashboard();
  toast(`Welcome, ${getUserName(userId)}`, 'success');
}

// ---------- Init ----------
let hasSeeded = false;

async function init() {
  try { renderUserSwitcher(); renderDashboard(); } catch (err) { console.error(err); }

  try {
    const loaded = await fetchAll();

    // Seed default users + accounts once
    if (loaded && state.users.length === 0 && !hasSeeded) {
      hasSeeded = true;
      showSaving('Setting up first time…');
      await api('addUser', { data: { id: 'u1', name: 'Husband', color: '#007aff', role: 'admin' } });
      await api('addUser', { data: { id: 'u2', name: 'Wife', color: '#ff2d55', role: 'user' } });
      await api('addAccount', { data: { id: 'acc1', name: 'Husband Bank', type: 'bank', owner: 'u1', balance: 0, currency: 'QAR' } });
      await api('addAccount', { data: { id: 'acc2', name: 'Wife Bank', type: 'bank', owner: 'u2', balance: 0, currency: 'QAR' } });
      await fetchAll();
      hideSaving();
    }

    // If no current user selected → show login
    if (!state.currentUserId || !state.users.find(u => u.id === state.currentUserId)) {
      showLoginGate();
    } else {
      document.getElementById('login-gate').classList.add('hidden');
    }
  } catch (err) {
    console.error('Startup Error:', err);
  }

  try {
    renderUserSwitcher();
    renderDashboard();
  } catch (err) { console.error(err); }

  // Auto-sync every 60s
  setInterval(async () => {
    await fetchAll();
    if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
  }, 60000);
}

init();
