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

const RECEIPT_KEYWORDS = {
  'Food & Dining': [
    'burger','pizza','coffee','tea','meal','restaurant','food','lunch','dinner','breakfast',
    'sandwich','shawarma','kebab','chicken','rice','water','juice','cola','soda','snack',
    'bakery','bread','milk','egg','grocery','supermarket','carrefour','lulu','mono','talabat',
    'deliveroo','yoghurt','yogurt','onion','mackerel','sardine','fish','meat','beef','lamb',
    'vegetable','fruit','biscuit','cookie','cream','cheese','butter','oil','sugar','flour',
    'pasta','noodle','sauce','spice','salt','tomato','potato','garlic','lemon','banana',
    'apple','orange','chicken','tuna','shrimp','prawn','dal','lentil','bean','rice','atta',
    'nabil','awafi','cremore','hypermarket','hyper market'
  ],
  'Shopping': ['dress','shirt','pants','shoes','clothes','clothing','t-shirt','jeans','bag','wallet','perfume','watch','electronics','phone','charger','cable','earphone','gift'],
  'Fuel': ['petrol','diesel','fuel','gas station','woqod','shell'],
  'Transportation': ['taxi','uber','careem','parking','salik','toll','metro','bus'],
  'Health': ['pharmacy','medicine','doctor','clinic','hospital','dental','gym'],
  'Entertainment': ['movie','cinema','ticket','game','netflix','spotify'],
  'Personal Care': ['haircut','salon','spa','massage','cosmetics'],
  'Housing': ['rent','electricity','kahramaa','internet','wifi','ooredoo','vodafone']
};

const STORE_DEFAULT_CAT = {
  'lulu': 'Food & Dining',
  'carrefour': 'Food & Dining',
  'family food': 'Food & Dining',
  'mega mart': 'Food & Dining',
  'al meera': 'Food & Dining',
  'woqod': 'Fuel',
  'shell': 'Fuel'
};

let state = {
  transactions: [], accounts: [], cards: [], payments: [],
  fuel: [], categories: [], users: [], budgets: [],
  currentUserId: localStorage.getItem('currentUser') || '',
  isAdmin: false,
  receiptFile: null,
  existingReceiptUrl: ''
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
  return !!(u && (u.role === 'admin' || u.name === 'Husband'));
}

function getUserName(uid) {
  const u = state.users.find(x => x.id === uid);
  return u ? u.name : '—';
}

function canEditTx(tx) {
  if (isAdmin()) return true;
  return String(tx.userId) === String(state.currentUserId);
}

// ---------- Local balance helpers ----------
function localAdjustBalance(type, id, delta) {
  if (!id || !delta) return;
  if (type === 'card') {
    const c = state.cards.find(x => x.id === id);
    if (c) c.balance = (parseFloat(c.balance) || 0) + delta;
  } else {
    const a = state.accounts.find(x => x.id === id);
    if (a) a.balance = (parseFloat(a.balance) || 0) + delta;
  }
}

function applyLocalTxEffect(tx, mult) {
  const amt = (parseFloat(tx.amount) || 0) * mult;
  if (tx.type === 'expense') {
    if (tx.cardId) localAdjustBalance('card', tx.cardId, amt);
    else if (tx.accountId) localAdjustBalance('acc', tx.accountId, -amt);
  } else if (tx.type === 'income' && tx.accountId) {
    localAdjustBalance('acc', tx.accountId, amt);
  }
}

function refreshCurrentView() {
  if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
  else if (document.getElementById('view-history').classList.contains('active')) renderHistory();
  else if (document.getElementById('view-accounts').classList.contains('active')) renderAccounts();
  else if (document.getElementById('view-settings').classList.contains('active')) renderSettings();
}

function backgroundSync() {
  fetchAll().then(ok => {
    if (ok) refreshCurrentView();
  }).catch(() => {});
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
function visibleTxs() {
  const uid = state.currentUserId;
  return state.transactions.filter(t => {
    if (!t.isPrivate) return true;
    if (!uid) return true;
    if (String(t.userId) === String(uid)) return true;
    if (isAdmin()) return true;
    return false;
  });
}

function visibleAccounts() { return state.accounts; }
function visibleCards() { return state.cards; }

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
  const txs = state.transactions.filter(t => !t.isPrivate || String(t.userId) === String(state.currentUserId) || isAdmin());
  const accs = state.accounts;
  const cards = state.cards;
  const cash = accs.reduce((s, a) => s + a.balance, 0);
  const debt = cards.reduce((s, c) => s + c.balance, 0);
  const net = cash - debt;

  const cutoff30 = dateOffset(-30);
  const recent30 = txs.filter(t => t.date >= cutoff30);
  const income = recent30.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = recent30.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const saved = income - expense;

  const debtFormatted = debt > 0 ? `-${money(debt)}` : money(0);

  document.getElementById('dash-net').innerText = money(net);
  document.getElementById('dash-cash').innerText = money(cash);
  document.getElementById('dash-cards').innerText = debtFormatted;

  if (document.getElementById('dash-cash-sep')) {
    document.getElementById('dash-cash-sep').innerText = money(cash);
  }
  if (document.getElementById('dash-cards-sep')) {
    document.getElementById('dash-cards-sep').innerText = debtFormatted;
  }

  document.getElementById('dash-income').innerText = money(income).replace('.00','');
  document.getElementById('dash-expense').innerText = money(expense).replace('.00','');
  document.getElementById('dash-saved').innerText = money(saved).replace('.00','');

  renderDonut(recent30.filter(t => t.type === 'expense'));
  renderSpendingTrends(txs);
  renderMonthlyChart(txs);
  renderCashCardBar(recent30.filter(t => t.type === 'expense'));
  renderTopCategories(recent30.filter(t => t.type === 'expense'));
  renderTopSubcategories(recent30.filter(t => t.type === 'expense'));
  renderFuelSummary(state.fuel);
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

function monthKeyOffset(monthsBack) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumByMonth(txs, key, type) {
  return txs.filter(t => t.date.startsWith(key) && t.type === type).reduce((s, t) => s + t.amount, 0);
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function renderSpendingTrends(txs) {
  const thisKey = monthKeyOffset(0);
  const lastKey = monthKeyOffset(1);
  const prevKey = monthKeyOffset(2);

  const thisExp = sumByMonth(txs, thisKey, 'expense');
  const lastExp = sumByMonth(txs, lastKey, 'expense');
  const prevExp = sumByMonth(txs, prevKey, 'expense');
  const thisInc = sumByMonth(txs, thisKey, 'income');
  const lastInc = sumByMonth(txs, lastKey, 'income');

  const dayOfMonth = new Date().getDate();
  const daysInThisMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const avgDailyThis = dayOfMonth > 0 ? thisExp / dayOfMonth : 0;
  const avgDailyLast = lastExp / (new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate() || 30);
  const projected = avgDailyThis * daysInThisMonth;

  const expDelta = pctChange(thisExp, lastExp);
  const incDelta = pctChange(thisInc, lastInc);
  const avgDelta = pctChange(avgDailyThis, avgDailyLast);

  const deltaClass = (p) => p > 3 ? 'up' : p < -3 ? 'down' : 'flat';
  const deltaLabel = (p) => {
    const arrow = p > 3 ? '▲' : p < -3 ? '▼' : '●';
    let cls = deltaClass(p);
    return `<div class="trend-delta ${cls}">${arrow} ${Math.abs(p).toFixed(0)}% vs last month</div>`;
  };

  const cards = document.getElementById('trend-cards');
  if (cards) {
    cards.innerHTML = `
      <div class="trend-card">
        <small>This month spend</small>
        <div class="trend-val expense" style="color:#ff3b30">${money(thisExp).replace('.00','')}</div>
        ${deltaLabel(expDelta)}
      </div>
      <div class="trend-card">
        <small>Last month spend</small>
        <div class="trend-val">${money(lastExp).replace('.00','')}</div>
        <div class="trend-delta flat">vs prior: ${pctChange(lastExp, prevExp) >= 0 ? '+' : ''}${pctChange(lastExp, prevExp).toFixed(0)}%</div>
      </div>
      <div class="trend-card">
        <small>Avg / day (this month)</small>
        <div class="trend-val">${money(avgDailyThis).replace('.00','')}</div>
        ${deltaLabel(avgDelta)}
      </div>
      <div class="trend-card">
        <small>Projected month-end</small>
        <div class="trend-val">${money(projected).replace('.00','')}</div>
        <div class="trend-delta flat">at current pace</div>
      </div>
    `;
  }

  const catThis = {}, catLast = {};
  txs.filter(t => t.type === 'expense' && t.date.startsWith(thisKey)).forEach(t => {
    catThis[t.category || 'Other'] = (catThis[t.category || 'Other'] || 0) + t.amount;
  });
  txs.filter(t => t.type === 'expense' && t.date.startsWith(lastKey)).forEach(t => {
    catLast[t.category || 'Other'] = (catLast[t.category || 'Other'] || 0) + t.amount;
  });
  const allCats = [...new Set([...Object.keys(catThis), ...Object.keys(catLast)])];
  const catDeltas = allCats.map(c => ({
    name: c,
    thisAmt: catThis[c] || 0,
    lastAmt: catLast[c] || 0,
    delta: (catThis[c] || 0) - (catLast[c] || 0)
  })).filter(x => x.thisAmt > 0 || x.lastAmt > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const insights = [];
  if (thisExp === 0 && lastExp === 0) {
    insights.push('No spending data yet for trend analysis.');
  } else {
    if (expDelta > 10) insights.push(`Spending is up <b>${expDelta.toFixed(0)}%</b> vs last month.`);
    else if (expDelta < -10) insights.push(`Spending is down <b>${Math.abs(expDelta).toFixed(0)}%</b> vs last month — good control.`);
    else insights.push(`Spending is roughly stable vs last month (${expDelta >= 0 ? '+' : ''}${expDelta.toFixed(0)}%).`);

    if (projected > lastExp * 1.15 && dayOfMonth >= 5) {
      insights.push(`At this pace you may spend <b>${money(projected).replace('.00','')}</b> this month (above last month).`);
    }

    const risers = catDeltas.filter(c => c.delta > 0).slice(0, 2);
    const fallers = catDeltas.filter(c => c.delta < 0).slice(0, 2);
    risers.forEach(c => insights.push(`${getCategoryIcon(c.name)} <b>${escapeHtml(c.name)}</b> up ${money(c.delta).replace('.00','')} vs last month.`));
    fallers.forEach(c => insights.push(`${getCategoryIcon(c.name)} <b>${escapeHtml(c.name)}</b> down ${money(Math.abs(c.delta)).replace('.00','')} vs last month.`));

    if (thisInc > 0 || lastInc > 0) {
      insights.push(`Income this month: <b>${money(thisInc).replace('.00','')}</b> (${incDelta >= 0 ? '+' : ''}${incDelta.toFixed(0)}% vs last).`);
    }
  }

  const insEl = document.getElementById('trend-insights');
  if (insEl) {
    insEl.innerHTML = insights.length
      ? `<ul style="margin:0;padding-left:18px">${insights.map(i => `<li>${i}</li>`).join('')}</ul>`
      : '';
  }
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
    <div class="bar-group" title="Income ${money(d.inc)} · Expense ${money(d.exp)}">
      <div class="bar-pair">
        <div class="bar inc" style="height:${(d.inc/max)*100}%"></div>
        <div class="bar exp" style="height:${(d.exp/max)*100}%"></div>
      </div>
      <div class="bar-label">${d.label}</div>
    </div>
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
    ? sorted.map(([name, amt]) => `<div class="item"><div class="item-icon">${getCategoryIcon(name)}</div><div class="item-info"><div class="item-title">${escapeHtml(name)}</div></div><div class="item-amt expense">${money(amt)}</div></div>`).join('')
    : '<div class="empty">No expenses yet</div>';
}

function renderTopSubcategories(expenses) {
  const el = document.getElementById('dash-top-subs');
  if (!el) return;
  const totals = {};
  expenses.forEach(t => {
    const sub = (t.subcategory || '').trim();
    if (!sub) return;
    const key = `${t.category || 'Other'} › ${sub}`;
    totals[key] = (totals[key] || 0) + t.amount;
  });
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0, 8);
  el.innerHTML = sorted.length
    ? sorted.map(([name, amt]) => {
        const [main, sub] = name.split(' › ');
        return `<div class="item">
          <div class="item-icon">${getCategoryIcon(main)}</div>
          <div class="item-info">
            <div class="item-title">${escapeHtml(sub)}</div>
            <div class="item-sub">${escapeHtml(main)}</div>
          </div>
          <div class="item-amt expense">${money(amt)}</div>
        </div>`;
      }).join('')
    : '<div class="empty">No subcategory spending yet — pick a subcategory when adding expenses</div>';
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
let historyFilter = { q: '', range: '30', type: 'all', category: 'all', group: 'none' };

document.getElementById('btn-history')?.addEventListener('click', () => { switchView('history'); renderHistory(); });
document.getElementById('search-input')?.addEventListener('input', (e) => { historyFilter.q = e.target.value.toLowerCase(); renderHistory(); });
document.getElementById('filter-range')?.addEventListener('change', (e) => { historyFilter.range = e.target.value; renderHistory(); });
document.getElementById('filter-type')?.addEventListener('change', (e) => { historyFilter.type = e.target.value; renderHistory(); });
document.getElementById('filter-category')?.addEventListener('change', (e) => { historyFilter.category = e.target.value; renderHistory(); });
document.getElementById('group-by')?.addEventListener('change', (e) => { historyFilter.group = e.target.value; renderHistory(); });

function populateHistoryCategoryFilter() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;
  const cats = [...new Set(state.transactions.map(t => t.category).filter(Boolean))].sort();
  const current = historyFilter.category || 'all';
  sel.innerHTML = '<option value="all">All categories</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}

function renderHistory() {
  populateHistoryCategoryFilter();
  let list = visibleTxs();

  if (historyFilter.range !== 'all') {
    const cutoff = dateOffset(-parseInt(historyFilter.range));
    list = list.filter(t => t.date >= cutoff);
  }
  if (historyFilter.type !== 'all') list = list.filter(t => t.type === historyFilter.type);
  if (historyFilter.category && historyFilter.category !== 'all') {
    list = list.filter(t => t.category === historyFilter.category);
  }
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
    } else if (historyFilter.group === 'category') {
      key = t.category || 'Other';
    } else if (historyFilter.group === 'subcategory') {
      key = (t.subcategory || '').trim()
        ? `${t.category || 'Other'} › ${t.subcategory}`
        : `${t.category || 'Other'} › (no subcategory)`;
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

  let sortedKeys = Object.keys(groups);
  if (historyFilter.group === 'category' || historyFilter.group === 'subcategory') {
    sortedKeys.sort((a, b) => groups[b].exp - groups[a].exp);
  } else {
    sortedKeys.sort().reverse();
  }

  let html = '';
  sortedKeys.forEach(k => {
    const g = groups[k];
    let headerText = '';
    if (historyFilter.group === 'month') {
      const [y, m] = k.split('-');
      headerText = new Date(y, m - 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    } else if (historyFilter.group === 'category' || historyFilter.group === 'subcategory') {
      headerText = k;
    } else {
      const s = new Date(g.startDate + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const e = new Date(g.endDate + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
      headerText = `Week of ${s} - ${e}`;
    }
    const safeId = k.replace(/[^a-zA-Z0-9_-]/g, '_');
    html += `<div class="group-header" onclick="toggleGroup('${safeId}')">
      <div class="group-title"><span>▼</span> ${escapeHtml(headerText)}</div>
      <div class="group-totals">
        <span class="income">+${money(g.inc)}</span>
        <span class="expense">-${money(g.exp)}</span>
      </div>
    </div>`;
    html += `<div class="group-body" id="group-${safeId}">`;
    html += g.items.map(historyRowHTML).join('');
    html += `</div>`;
  });
  document.getElementById('history-list').innerHTML = html || '<div class="empty">No matching transactions</div>';
}

function historyRowHTML(t) { return txRowHTML(t); }

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

  const privacyBtn = document.getElementById('btn-toggle-privacy');
  if (privacyBtn) {
    privacyBtn.onclick = () => {
      const newPrivate = !tx.isPrivate;
      const idx = state.transactions.findIndex(t => t.id === tx.id);
      if (idx >= 0) state.transactions[idx].isPrivate = newPrivate;

      document.getElementById('edit-modal').classList.add('hidden');
      editingId = null;
      refreshCurrentView();
      toast(newPrivate ? 'Hidden from others 🔒' : 'Now visible to both 👁', 'success');

      api('updateTx', {
        id: tx.id,
        data: {
          date: tx.date, type: tx.type, amount: tx.amount, category: tx.category,
          subcategory: tx.subcategory, product: tx.product, note: tx.note,
          accountId: tx.accountId, cardId: tx.cardId,
          receiptUrl: tx.receiptUrl || '',
          isPrivate: newPrivate
        }
      }).then(res => {
        if (!res.success) {
          if (idx >= 0) state.transactions[idx].isPrivate = !newPrivate;
          refreshCurrentView();
          toast('Could not save privacy: ' + (res.error || ''), 'error');
        }
      });
    };
  }
}

document.getElementById('edit-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
});

document.getElementById('edit-delete').addEventListener('click', () => {
  if (!editingId) return;
  const tx = state.transactions.find(t => t.id === editingId);
  if (!tx || !canEditTx(tx)) {
    toast('You can only delete your own transactions', 'error');
    return;
  }
  if (!confirm('Delete this transaction?')) return;

  const id = editingId;
  const snapshot = { ...tx };

  state.transactions = state.transactions.filter(t => t.id !== id);
  applyLocalTxEffect(snapshot, -1);
  if (snapshot.fuelId) {
    state.fuel = state.fuel.filter(f => f.id !== snapshot.fuelId);
  }

  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
  refreshCurrentView();
  toast('Deleted', 'success');

  api('deleteTx', { id }).then(res => {
    if (!res.success) {
      state.transactions.push(snapshot);
      applyLocalTxEffect(snapshot, +1);
      refreshCurrentView();
      toast('Delete failed – restored: ' + (res.error || ''), 'error');
    }
  });
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
    sel.innerHTML = cards.map(c => {
      const owed = parseFloat(c.balance) || 0;
      const limit = parseFloat(c.limit) || 0;
      const avail = limit - owed;
      return `<option value="${c.id}">${c.name} •${c.last4} (${getUserName(c.owner)}) — Avail: ${money(avail)} | Owed: -${money(owed)}</option>`;
    }).join('') || '<option value="">No cards</option>';
  }
}

function populatePayOptions() {
  document.getElementById('pay-card').innerHTML = visibleCards().map(c => {
    const owed = parseFloat(c.balance) || 0;
    const limit = parseFloat(c.limit) || 0;
    const avail = limit - owed;
    return `<option value="${c.id}">${c.name} •${c.last4} — Owed: -${money(owed)} (Avail: ${money(avail)})</option>`;
  }).join('') || '<option value="">No cards</option>';
  document.getElementById('pay-account').innerHTML = visibleAccounts().map(a => `<option value="${a.id}">${a.name} — ${money(a.balance)}</option>`).join('') || '<option value="">No accounts</option>';
}

// ---------- Receipt attachment + OCR ----------
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
  if (file.type.startsWith('image/')) {
    document.getElementById('btn-scan-ocr').classList.remove('hidden');
  }
});

document.getElementById('btn-clear-receipt').addEventListener('click', () => {
  state.receiptFile = null;
  state.existingReceiptUrl = '';
  receiptInput.value = '';
  updateReceiptUI();
  document.getElementById('btn-scan-ocr').classList.add('hidden');
  document.getElementById('ocr-status').classList.add('hidden');
});

function updateReceiptUI() {
  const nameEl = document.getElementById('receipt-name');
  const preview = document.getElementById('receipt-preview');
  const clearBtn = document.getElementById('btn-clear-receipt');
  const scanBtn = document.getElementById('btn-scan-ocr');

  if (state.receiptFile) {
    nameEl.textContent = state.receiptFile.name || 'Photo';
    clearBtn.classList.remove('hidden');
    if (state.receiptFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(state.receiptFile);
      preview.innerHTML = `<img src="${url}" alt="preview">`;
      preview.classList.remove('hidden');
      if (scanBtn) scanBtn.classList.remove('hidden');
    } else {
      preview.innerHTML = `<span>📄 ${escapeHtml(state.receiptFile.name)}</span>`;
      preview.classList.remove('hidden');
      if (scanBtn) scanBtn.classList.add('hidden');
    }
  } else if (state.existingReceiptUrl) {
    nameEl.textContent = 'Attached bill';
    clearBtn.classList.remove('hidden');
    preview.innerHTML = `<a href="${escapeHtml(state.existingReceiptUrl)}" target="_blank">📎 View current attachment</a>`;
    preview.classList.remove('hidden');
    if (scanBtn) scanBtn.classList.add('hidden');
  } else {
    nameEl.textContent = '';
    clearBtn.classList.add('hidden');
    preview.classList.add('hidden');
    preview.innerHTML = '';
    if (scanBtn) scanBtn.classList.add('hidden');
  }
}

function prepareImageForOCR(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxW = 1600;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

document.getElementById('btn-scan-ocr')?.addEventListener('click', async () => {
  if (!state.receiptFile || !state.receiptFile.type.startsWith('image/')) {
    toast('Take or choose a receipt photo first', 'error');
    return;
  }
  if (typeof Tesseract === 'undefined') {
    toast('OCR library not loaded – check internet', 'error');
    return;
  }

  const status = document.getElementById('ocr-status');
  const scanBtn = document.getElementById('btn-scan-ocr');
  status.classList.remove('hidden');
  status.textContent = 'Scanning receipt… 0%';
  scanBtn.disabled = true;

  try {
    const blob = await prepareImageForOCR(state.receiptFile);
    const result = await Tesseract.recognize(blob, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          status.textContent = `Scanning receipt… ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    const text = (result?.data?.text || '').trim();
    if (!text) {
      status.textContent = 'Could not read text – try a clearer photo';
      toast('OCR found no text', 'error');
      return;
    }
    document.getElementById('receipt-text').value = text;
    status.textContent = 'Scan complete – reviewing items…';
    parseReceiptText(text);
    toast('Receipt scanned ✓', 'success');
  } catch (err) {
    console.error(err);
    status.textContent = 'Scan failed';
    toast('OCR failed: ' + (err.message || err), 'error');
  } finally {
    scanBtn.disabled = false;
  }
});

function guessCategory(desc, fullText) {
  const lower = (desc + ' ' + (fullText || '')).toLowerCase();
  for (const [store, cat] of Object.entries(STORE_DEFAULT_CAT)) {
    if (lower.includes(store)) return cat;
  }
  for (const [category, words] of Object.entries(RECEIPT_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) return category;
  }
  return 'Food & Dining';
}

function parseReceiptText(text) {
  if (!text || !text.trim()) {
    toast('No text to parse', 'error');
    return;
  }

  const lines = text.split(/
/).map(l => l.trim()).filter(Boolean);
  const suggestions = [];
  let receiptTotal = null;
  let receiptDate = null;

  for (const line of lines) {
    const t = line.match(/total\s*[:\s]*(\d+[.,]\d{2})/i);
    if (t) receiptTotal = parseFloat(t[1].replace(',', '.'));
  }

  for (const line of lines) {
    const d = line.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (d) {
      let y = d[3];
      if (y.length === 2) y = '20' + y;
      receiptDate = `${y}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}`;
      break;
    }
  }

  const skipRe = /customer|tel:|fax:|visa|mastercard|auth|eft|card no|points|happiness|thank|items\s*:|payment|receipt|store|pos|self checkout|www\.|lulu hyper/i;

  lines.forEach(line => {
    if (skipRe.test(line)) return;
    if (/^total/i.test(line)) return;
    if (/^\d{10,}$/.test(line.replace(/\s/g,''))) return;

    let amount = 0, desc = line;
    const m1 = line.match(/^(.*?)[\s.]+(\d+[.,]\d{2})\s*$/);
    const qtyOnly = line.match(/^\d+\s*x\s+(\d+[.,]\d{2})\s*$/i);
    if (qtyOnly) return;

    if (m1) {
      desc = m1[1].replace(/[\s.]+$/g, '').replace(/^\d+\s+/, '').trim();
      amount = parseFloat(m1[2].replace(',', '.'));
    } else {
      const nums = line.match(/(\d+[.,]\d{2})/g);
      if (nums && nums.length) {
        amount = parseFloat(nums[nums.length - 1].replace(',', '.'));
        desc = line.replace(nums[nums.length - 1], '').trim();
      }
    }

    desc = desc.replace(/^\d{8,}\s*/, '').replace(/\s+/g, ' ').trim();
    if (!desc || desc.length < 2) return;
    if (!amount || amount <= 0 || amount > 50000) return;
    if (receiptTotal && Math.abs(amount - receiptTotal) < 0.01 && /total/i.test(line)) return;

    const category = guessCategory(desc, text);
    suggestions.push({ desc, amount, category });
  });

  const seen = new Set();
  const unique = suggestions.filter(s => {
    const k = s.desc.toLowerCase() + '|' + s.amount.toFixed(2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const box = document.getElementById('parse-suggestions');
  if (unique.length === 0 && !receiptTotal) {
    box.innerHTML = '<div class="hint">No priced items found. Try a sharper photo or paste text manually.</div>';
    box.classList.remove('hidden');
    return;
  }

  const itemsSum = unique.reduce((s, x) => s + x.amount, 0);
  const mainTotal = receiptTotal || itemsSum;
  const mainCat = unique[0]?.category || guessCategory(text, text) || 'Food & Dining';
  const noteItems = unique.map(s => `${s.desc} ${s.amount.toFixed(2)}`).join('; ');

  let html = '';
  if (mainTotal > 0) {
    html += `<div style="font-weight:600;margin-bottom:8px">One transaction (recommended)</div>
      <div class="parse-item">
        <span><b>${escapeHtml(mainCat)}</b> · Total ${money(mainTotal)}
          <div class="hint" style="margin:0">${unique.length} items${receiptDate ? ' · ' + receiptDate : ''}</div>
        </span>
        <button type="button" onclick="applyReceiptTotal()">Use total</button>
      </div>`;
  }

  if (unique.length) {
    html += `<div style="font-weight:600;margin:12px 0 6px">Or item by item</div>` +
      unique.map((s, i) => `
        <div class="parse-item">
          <span>${escapeHtml(s.desc)} → <b>${s.category}</b> ${money(s.amount)}</span>
          <button type="button" onclick="applySuggestion(${i})">Use</button>
        </div>`).join('');
  }

  html += `<div class="hint" style="margin-top:8px">Photo stays attached when you Save. OCR may misread — check amounts.</div>`;

  window._parseSuggestions = unique;
  window._receiptBundle = {
    total: mainTotal,
    category: mainCat,
    note: noteItems,
    product: unique.length <= 3 ? unique.map(s => s.desc).join(', ') : `${unique.length} items`,
    date: receiptDate
  };

  box.innerHTML = html;
  box.classList.remove('hidden');
}

document.getElementById('btn-parse-receipt').addEventListener('click', () => {
  const text = document.getElementById('receipt-text').value.trim();
  if (!text) { toast('Scan a photo or paste receipt text first'); return; }
  parseReceiptText(text);
});

window.applySuggestion = function(idx) {
  const s = window._parseSuggestions?.[idx];
  if (!s) return;
  document.getElementById('tx-amount').value = s.amount.toFixed(2);
  document.getElementById('tx-product').value = s.desc;
  const catSelect = document.getElementById('tx-category');
  const opt = [...catSelect.options].find(o => o.value === s.category);
  if (opt) {
    catSelect.value = s.category;
    updateSubcategories();
    updateFuelFieldVisibility();
    setTimeout(() => {
      const sub = document.getElementById('tx-subcategory');
      const g = [...sub.options].find(o => /grocer/i.test(o.value));
      if (g) sub.value = g.value;
    }, 50);
  }
  toast(`Filled: ${s.category} ${money(s.amount)}`, 'success');
};

window.applyReceiptTotal = function() {
  const b = window._receiptBundle;
  if (!b) return;
  document.getElementById('tx-amount').value = b.total.toFixed(2);
  document.getElementById('tx-product').value = b.product || '';
  document.getElementById('tx-note').value = b.note || '';
  if (b.date) document.getElementById('tx-date').value = b.date;
  const catSelect = document.getElementById('tx-category');
  const opt = [...catSelect.options].find(o => o.value === b.category);
  if (opt) {
    catSelect.value = b.category;
    updateSubcategories();
    updateFuelFieldVisibility();
    setTimeout(() => {
      const sub = document.getElementById('tx-subcategory');
      const g = [...sub.options].find(o => /grocer/i.test(o.value));
      if (g) sub.value = g.value;
    }, 50);
  }
  toast(`Filled total ${money(b.total)} → ${b.category}`, 'success');
};

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

// ---------- Submit transaction (OPTIMISTIC) ----------
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

  if (editId) {
    const existing = state.transactions.find(t => t.id === editId);
    if (existing && !canEditTx(existing)) {
      toast('You cannot edit another user’s transaction', 'error');
      return;
    }
  }

  const btn = document.getElementById('btn-save-tx');
  setButtonLoading(btn, true);

  const subVal = document.getElementById('tx-subcategory').value;
  const dateVal = document.getElementById('tx-date').value;
  const typeVal = document.getElementById('tx-type').value;
  const productVal = document.getElementById('tx-product').value;
  const noteVal = document.getElementById('tx-note').value;
  const accountId = sourceType === 'account' ? sourceId : '';
  const cardId = sourceType === 'card' ? sourceId : '';
  const receiptFile = state.receiptFile;
  let receiptUrl = state.existingReceiptUrl || '';

  let localTx = null;
  let oldTxSnapshot = null;
  let fuelPayload = null;

  if (editId) {
    const idx = state.transactions.findIndex(t => t.id === editId);
    if (idx >= 0) {
      oldTxSnapshot = { ...state.transactions[idx] };
      applyLocalTxEffect(oldTxSnapshot, -1);
      localTx = {
        ...oldTxSnapshot,
        date: dateVal, type: typeVal, amount, category,
        subcategory: subVal, product: productVal, note: noteVal,
        accountId, cardId, receiptUrl
      };
      state.transactions[idx] = localTx;
      applyLocalTxEffect(localTx, +1);
    }
  } else {
    const newId = Date.now().toString();
    localTx = {
      id: newId, date: dateVal, type: typeVal, amount, category,
      subcategory: isFuel ? (document.getElementById('fuel-vehicle').value.trim() || '') : subVal,
      product: isFuel ? `⛽ ${document.getElementById('fuel-liters').value}L` : productVal,
      note: noteVal, accountId, cardId,
      userId: state.currentUserId, fuelId: isFuel ? newId : '',
      receiptUrl, isPrivate: false
    };
    state.transactions.unshift(localTx);
    applyLocalTxEffect(localTx, +1);

    if (isFuel) {
      fuelPayload = {
        id: newId, date: dateVal,
        vehicle: document.getElementById('fuel-vehicle').value.trim(),
        odometer: parseFloat(document.getElementById('fuel-odo').value) || 0,
        liters: parseFloat(document.getElementById('fuel-liters').value) || 0,
        pricePerLiter: parseFloat(document.getElementById('fuel-ppl').value) || 0,
        total: amount,
        fullTank: document.getElementById('fuel-full').checked,
        cardId, accountId, userId: state.currentUserId,
        note: noteVal, receiptUrl, isPrivate: false
      };
      state.fuel.push({
        id: newId, date: dateVal, vehicle: fuelPayload.vehicle,
        odometer: fuelPayload.odometer, liters: fuelPayload.liters,
        pricePerLiter: fuelPayload.pricePerLiter, total: amount,
        cardId, accountId, userId: state.currentUserId,
        fullTank: fuelPayload.fullTank
      });
    }
  }

  resetAddForm();
  switchView('dashboard');
  toast(editId ? 'Updated ✓' : 'Saved ✓', 'success');
  setButtonLoading(btn, false);

  if (typeVal === 'expense' || isFuel) {
    const catName = isFuel ? 'Fuel' : category;
    const budget = (state.budgets || []).find(b => b.category === catName);
    if (budget) {
      const spent = getBudgetSpent(catName);
      const limit = parseFloat(budget.amount) || 0;
      if (limit > 0 && spent >= limit) {
        setTimeout(() => toast(`⚠️ ${catName} budget exceeded: ${money(spent)} / ${money(limit)}`, 'error'), 600);
      } else if (limit > 0 && spent / limit >= 0.8) {
        setTimeout(() => toast(`⚡ ${catName}: ${Math.round(spent / limit * 100)}% of budget used`, 'info'), 600);
      }
    }
  }

  (async () => {
    try {
      if (receiptFile) {
        const { base64, mimeType, name } = await fileToBase64(receiptFile);
        const up = await api('uploadReceipt', { data: { base64, mimeType, name } });
        if (up.success && up.url) {
          receiptUrl = up.url;
          const t = state.transactions.find(x => x.id === localTx.id);
          if (t) t.receiptUrl = receiptUrl;
        }
      }

      let res;
      if (editId) {
        res = await api('updateTx', { id: editId, data: {
          date: dateVal, type: typeVal, amount, category, subcategory: subVal,
          product: productVal, note: noteVal, accountId, cardId,
          receiptUrl, isPrivate: localTx ? localTx.isPrivate : false
        }});
      } else if (isFuel && fuelPayload) {
        fuelPayload.receiptUrl = receiptUrl;
        res = await api('addFuel', { data: fuelPayload });
      } else {
        res = await api('addTx', { data: {
          id: localTx.id, date: dateVal, type: typeVal, amount, category,
          subcategory: subVal, product: productVal, note: noteVal,
          accountId, cardId, userId: state.currentUserId, fuelId: '',
          receiptUrl, isPrivate: false
        }});
      }

      if (!res.success) throw new Error(res.error || 'Save failed');
    } catch (err) {
      if (editId && oldTxSnapshot) {
        const idx = state.transactions.findIndex(t => t.id === editId);
        if (idx >= 0) {
          applyLocalTxEffect(state.transactions[idx], -1);
          state.transactions[idx] = oldTxSnapshot;
          applyLocalTxEffect(oldTxSnapshot, +1);
        }
      } else if (localTx) {
        applyLocalTxEffect(localTx, -1);
        state.transactions = state.transactions.filter(t => t.id !== localTx.id);
        if (isFuel) state.fuel = state.fuel.filter(f => f.id !== localTx.id);
      }
      refreshCurrentView();
      toast('Save failed – reverted: ' + (err.message || err), 'error');
      backgroundSync();
    }
  })();
});

// ---------- Payment form (OPTIMISTIC) ----------
document.getElementById('form-payment').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.currentUserId) { toast('Select your profile first', 'error'); return; }

  const btn = document.getElementById('btn-save-payment');
  const payId = Date.now().toString();
  const cardId = document.getElementById('pay-card').value;
  const accountId = document.getElementById('pay-account').value;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const note = document.getElementById('pay-note').value;
  const date = document.getElementById('pay-date').value;

  if (!amount || amount <= 0) { toast('Enter valid amount', 'error'); return; }

  // Reduce credit card owed balance AND deduct payment from main bank account
  localAdjustBalance('card', cardId, -amount);
  if (accountId) localAdjustBalance('acc', accountId, -amount);

  setButtonLoading(btn, true);
  document.getElementById('form-payment').reset();
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  switchView('dashboard');
  toast('Payment recorded ✓', 'success');
  setButtonLoading(btn, false);

  api('addPayment', { data: {
    id: payId, date, cardId, accountId, amount, note, userId: state.currentUserId
  }}).then(res => {
    if (!res.success) {
      localAdjustBalance('card', cardId, +amount);
      if (accountId) localAdjustBalance('acc', accountId, +amount);
      refreshCurrentView();
      toast('Payment failed – reverted: ' + (res.error || ''), 'error');
      backgroundSync();
    }
  });
});

// ---------- Accounts ----------
function renderAccounts() {
  const accs = visibleAccounts();
  const cards = visibleCards();

  document.getElementById('accounts-list').innerHTML = accs.length
    ? accs.map(a => `<div class="item"><div class="item-icon">🏦</div><div class="item-info"><div class="item-title">${escapeHtml(a.name)}</div><div class="item-sub">${a.type.toUpperCase()} • ${getUserName(a.owner)}</div></div><div class="item-amt">${money(a.balance)}</div></div>`).join('')
    : '<div class="empty">No accounts yet</div>';

  document.getElementById('cards-list').innerHTML = cards.length
    ? cards.map(c => {
        const owed = parseFloat(c.balance) || 0;
        const limit = parseFloat(c.limit) || 0;
        const available = limit - owed;
        const displayOwed = owed > 0 ? `-${money(owed)}` : money(0);
        return `<div class="item">
          <div class="item-icon" style="background:${c.color}22">💳</div>
          <div class="item-info">
            <div class="item-title">${escapeHtml(c.name)} •${c.last4}</div>
            <div class="item-sub">${getUserName(c.owner)} • Limit ${money(limit)}</div>
            <div class="item-sub" style="color:#007aff;font-weight:600;margin-top:2px;">Available to spend: ${money(available)}</div>
          </div>
          <div class="item-amt expense">${displayOwed}</div>
        </div>`;
      }).join('')
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
  const limit = parseFloat(prompt('Credit limit (QR):', '9000') || '9000');
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
function getBudgetSpent(category, days = 30) {
  const cutoff = dateOffset(-days);
  return state.transactions
    .filter(t => t.type === 'expense' && t.date >= cutoff && t.category === category)
    .reduce((s, t) => s + t.amount, 0);
}

function renderDashboardBudgets() {
  const budgets = state.budgets || [];
  const alertEl = document.getElementById('budget-alerts');

  if (budgets.length === 0) {
    document.getElementById('dash-budgets').innerHTML = '<div class="empty">No budgets set yet. Go to More → Budgets.</div>';
    if (alertEl) alertEl.classList.add('hidden');
    return;
  }

  const rows = [];
  const alerts = [];

  budgets.forEach(b => {
    const spent = getBudgetSpent(b.category);
    const limit = parseFloat(b.amount) || 0;
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    const cls = spent >= limit ? 'over' : pct >= 80 ? 'warn' : 'ok';
    rows.push(`<div class="budget-row"><div class="budget-head"><span>${getCategoryIcon(b.category)} ${escapeHtml(b.category)}</span><span>${money(spent)} / ${money(limit)}</span></div><div class="budget-bar"><div class="budget-fill ${cls}" style="width:${pct}%"></div></div></div>`);

    if (spent >= limit && limit > 0) {
      alerts.push(`⚠️ <b>${escapeHtml(b.category)}</b> over budget: ${money(spent)} / ${money(limit)}`);
    } else if (pct >= 80 && limit > 0) {
      alerts.push(`⚡ <b>${escapeHtml(b.category)}</b> nearly full: ${pct.toFixed(0)}% used`);
    }
  });

  document.getElementById('dash-budgets').innerHTML = rows.join('');

  if (alertEl) {
    if (alerts.length) {
      alertEl.innerHTML = '<b>Budget alerts</b><br>' + alerts.map(a => `<div>${a}</div>`).join('');
      alertEl.classList.remove('hidden');
      alertEl.classList.toggle('over', alerts.some(a => a.includes('over budget')));
    } else {
      alertEl.classList.add('hidden');
    }
  }
}

function populateBudgetCategorySelect() {
  const sel = document.getElementById('budget-cat-select');
  if (!sel) return;
  const parents = (state.categories || []).filter(c => c.type === 'expense' && !c.parentId);
  const list = parents.length ? parents : FALLBACK_CATS.filter(c => c.type === 'expense');
  sel.innerHTML = '<option value="">— Select category —</option>' +
    list.map(c => `<option value="${escapeHtml(c.name)}">${c.icon || '📌'} ${escapeHtml(c.name)}</option>`).join('');
}

function renderBudgetsSettings() {
  populateBudgetCategorySelect();
  const budgets = state.budgets || [];
  document.getElementById('budgets-list').innerHTML = budgets.length
    ? budgets.map(b => {
        const spent = getBudgetSpent(b.category);
        const over = spent >= (parseFloat(b.amount) || 0);
        return `<div class="budget-row">
          <div class="budget-head">
            <span>${getCategoryIcon(b.category)} ${escapeHtml(b.category)}${over ? ' ⚠️' : ''}</span>
            <span>${money(b.amount)}/mo · spent ${money(spent)}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button class="link-btn" onclick="editBudgetAmount('${b.id}','${escapeHtml(b.category)}',${parseFloat(b.amount)||0})">Edit amount</button>
            <button class="link-btn" onclick="deleteBudget('${b.id}')" style="color:#ff3b30">Remove</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="hint">No budgets yet. Choose a category below.</p>';
}

window.deleteBudget = async (id) => {
  if (!confirm('Remove budget?')) return;
  state.budgets = (state.budgets || []).filter(b => b.id !== id);
  renderBudgetsSettings();
  renderDashboardBudgets();
  toast('Budget removed', 'success');
  api('deleteBudget', { id }).then(res => {
    if (!res.success) backgroundSync();
  });
};

window.editBudgetAmount = async (id, category, currentAmt) => {
  const raw = prompt(`New monthly budget for ${category} (QR):`, String(currentAmt));
  if (raw === null) return;
  const amt = parseFloat(raw);
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }

  const b = (state.budgets || []).find(x => x.id === id);
  if (b) b.amount = amt;
  renderBudgetsSettings();
  renderDashboardBudgets();
  toast('Budget updated ✓', 'success');

  api('saveBudget', { data: { id, category, amount: amt, period: 'monthly', userId: '' } }).then(res => {
    if (!res.success) {
      toast('Could not save budget: ' + (res.error || ''), 'error');
      backgroundSync();
    }
  });
};

document.getElementById('btn-add-budget').addEventListener('click', () => {
  const cat = document.getElementById('budget-cat-select').value;
  const amt = parseFloat(document.getElementById('budget-amount-input').value);
  if (!cat) { toast('Select a category', 'error'); return; }
  if (!amt || amt <= 0) { toast('Enter a valid monthly amount', 'error'); return; }

  const existing = (state.budgets || []).find(b => b.category === cat);
  if (existing) {
    existing.amount = amt;
  } else {
    const id = Date.now().toString();
    state.budgets = state.budgets || [];
    state.budgets.push({ id, category: cat, amount: amt, period: 'monthly', userId: '' });
  }

  document.getElementById('budget-amount-input').value = '';
  renderBudgetsSettings();
  renderDashboardBudgets();
  toast('Budget saved ✓', 'success');

  api('saveBudget', { data: { category: cat, amount: amt, period: 'monthly', userId: '' } }).then(res => {
    if (!res.success) {
      toast('Could not save: ' + (res.error || ''), 'error');
      backgroundSync();
    } else {
      backgroundSync();
    }
  });
});

// ---------- Print ----------
document.getElementById('btn-print')?.addEventListener('click', () => {
  switchView('dashboard');
  setTimeout(() => window.print(), 200);
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
    const ok = await fetchAll();
    hideSaving();
    refreshCurrentView();
    toast(ok ? 'Synced!' : 'Sync failed – check connection', ok ? 'success' : 'error');
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
    sel.classList.remove('hidden');
    badge.classList.add('hidden');
    sel.innerHTML = '<option value="">👥 Both (Admin)</option>' +
      state.users.map(u => `<option value="${u.id}">${u.name}${u.role === 'admin' ? ' 👑' : ''}</option>`).join('');
    sel.value = state.currentUserId || '';
  } else {
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

  setInterval(() => { backgroundSync(); }, 180000);
}

init();
