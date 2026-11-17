// ============================================
const BACKEND_URL = "YOUR_GOOGLE_APPS_SCRIPT_URL_HERE"; // ⚠️ PASTE YOUR URL HERE
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1syWFz8Gx_0yRmREAFBqyrSDCsladhzS5_-RmcIzvJbY/edit?gid=1251417057#gid=1251417057";         // ⚠️ PASTE YOUR URL HERE
const CURRENCY = "QR";
// ============================================

let state = {
  transactions: [], accounts: [], cards: [], payments: [],
  fuel: [], categories: [], users: [], budgets: [],
  currentUserId: sessionStorage.getItem('currentUser') || ''
};

// ============ MONEY HELPER ============
function money(n) {
  const v = parseFloat(n) || 0;
  return `${CURRENCY} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ============ API ============
async function api(action, payload = {}) {
  try {
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload })
    });
    const json = await res.json();
    setStatus(json.success);
    return json;
  } catch (e) { setStatus(false); return { success: false, error: e.toString() }; }
}

async function fetchAll() {
  try {
    const res = await fetch(BACKEND_URL);
    const json = await res.json();
    if (json.success) {
      state.transactions = (json.data.TX || []).map(normalizeTx);
      state.accounts    = (json.data.ACC || []).map(normalizeAcc);
      state.cards       = (json.data.CARD || []).map(normalizeCard);
      state.payments    = json.data.PAY || [];
      state.fuel        = (json.data.FUEL || []).map(normalizeFuel);
      state.categories  = json.data.CAT || [];
      state.users       = json.data.USER || [];
      state.budgets     = json.data.BUDGET || [];
      setStatus(true);
      await seedFirstUserIfNeeded();
    }
  } catch (e) { setStatus(false); console.error(e); }
}

async function seedFirstUserIfNeeded() {
  if (state.users.length === 0) {
    await api('addUser', { data: { id: 'u1', name: 'Husband', color: '#007aff' } });
    await api('addUser', { data: { id: 'u2', name: 'Wife', color: '#ff2d55' } });
    await fetchAll(); return;
  }
  if (state.accounts.length === 0) {
    await api('addAccount', { data: { id: 'acc1', name: 'Husband Bank', type: 'bank', owner: 'u1', balance: 0, currency: 'QAR' } });
    await api('addAccount', { data: { id: 'acc2', name: 'Wife Bank', type: 'bank', owner: 'u2', balance: 0, currency: 'QAR' } });
    await fetchAll();
  }
}

function setStatus(online) {
  const el = document.getElementById('status');
  if (el) el.className = 'status-dot' + (online ? '' : ' offline');
}

function normalizeTx(t) {
  return { id: String(t.id), date: normalizeDate(t.date), type: t.type,
    amount: parseFloat(t.amount) || 0, category: t.category || '', subcategory: t.subcategory || '',
    product: t.product || '', note: t.note || '', accountId: String(t.accountId || ''),
    cardId: String(t.cardId || ''), userId: String(t.userId || ''), fuelId: String(t.fuelId || '') };
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

// ============ NAV ============
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

// ============ DASHBOARD ============
function renderDashboard() {
  const uid = state.currentUserId;
  const filtUser = (arr) => uid ? arr.filter(x => x.userId === uid || !x.userId) : arr;
  const txs = filtUser(state.transactions);
  const cash = state.accounts.filter(a => !uid || a.owner === uid).reduce((s, a) => s + a.balance, 0);
  const debt = state.cards.filter(c => !uid || c.owner === uid).reduce((s, c) => s + c.balance, 0);
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
  renderFuelSummary(filtUser(state.fuel));
  renderDashboardBudgets();
  renderRecent(txs);
}

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
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
  return `<div class="item" onclick="openEditModal('${t.id}')">
    <div class="item-icon">${icon}</div>
    <div class="item-info"><div class="item-title">${escapeHtml(t.category || 'Other')}</div>${sub ? `<div class="item-sub">${escapeHtml(sub)}</div>` : ''}<div class="item-sub">${t.date} ${source}</div></div>
    <div class="item-amt ${cls}">${sign}${money(t.amount)}</div>
  </div>`;
}

function getCategoryIcon(name) {
  const cat = state.categories.find(c => c.name === name);
  return cat ? cat.icon : '📌';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============ ADVANCED HISTORY (WEEK/MONTH GROUPING) ============
let historyFilter = { q: '', range: '30', type: 'all', group: 'none' };

document.getElementById('btn-history')?.addEventListener('click', () => { switchView('history'); renderHistory(); });
document.getElementById('search-input')?.addEventListener('input', (e) => { historyFilter.q = e.target.value.toLowerCase(); renderHistory(); });
document.getElementById('filter-range')?.addEventListener('change', (e) => { historyFilter.range = e.target.value; renderHistory(); });
document.getElementById('filter-type')?.addEventListener('change', (e) => { historyFilter.type = e.target.value; renderHistory(); });
document.getElementById('group-by')?.addEventListener('change', (e) => { historyFilter.group = e.target.value; renderHistory(); });

function renderHistory() {
  const uid = state.currentUserId;
  let list = state.transactions.filter(t => !uid || t.userId === uid || !t.userId);

  if (historyFilter.range !== 'all') {
    const cutoff = dateOffset(-parseInt(historyFilter.range));
    list = list.filter(t => t.date >= cutoff);
  }
  if (historyFilter.type !== 'all') list = list.filter(t => t.type === historyFilter.type);
  if (historyFilter.q) {
    list = list.filter(t => (t.category + ' ' + t.subcategory + ' ' + t.product + ' ' + t.note).toLowerCase().includes(historyFilter.q));
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
    } else if (historyFilter.group === 'week') {
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
  document.getElementById('history-list').innerHTML = html;
}

function historyRowHTML(t) {
  const icon = getCategoryIcon(t.category);
  const cls = t.type === 'income' ? 'income' : 'expense';
  const sign = t.type === 'income' ? '+' : '-';
  const sub = [t.subcategory, t.product, t.note].filter(Boolean).join(' • ');
  const source = t.cardId ? '💳' : t.accountId ? '💵' : '';
  return `<div class="item" onclick="openEditModal('${t.id}')">
    <div class="item-icon">${icon}</div>
    <div class="item-info"><div class="item-title">${escapeHtml(t.category || 'Other')}</div>${sub ? `<div class="item-sub">${escapeHtml(sub)}</div>` : ''}<div class="item-sub">${t.date} ${source}</div></div>
    <div class="item-amt ${cls}">${sign}${money(t.amount)}</div>
  </div>`;
}

window.toggleGroup = function(k) {
  const el = document.getElementById(`group-${k}`);
  if (el) el.classList.toggle('hidden-group');
};

// ============ EDIT / DELETE MODAL ============
let editingId = null;

function openEditModal(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  editingId = id;
  const sub = [tx.subcategory, tx.product].filter(Boolean).join(' • ');
  document.getElementById('edit-details').innerHTML = `
    <div><b>${getCategoryIcon(tx.category)} ${escapeHtml(tx.category)}</b></div>
    ${sub ? `<div>${escapeHtml(sub)}</div>` : ''}
    <div><b style="font-size:18px">${money(tx.amount)}</b> ${tx.type.toUpperCase()}</div>
    <div>📅 ${tx.date}</div>
    ${tx.note ? `<div>📝 ${escapeHtml(tx.note)}</div>` : ''}
  `;
  document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('edit-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
});

document.getElementById('edit-delete').addEventListener('click', async () => {
  if (!editingId || !confirm('Delete this transaction?')) return;
  const res = await api('deleteTx', { id: editingId });
  if (!res.success) return alert('Failed: ' + res.error);
  document.getElementById('edit-modal').classList.add('hidden');
  editingId = null;
  await fetchAll();
  renderDashboard();
  if (document.getElementById('view-history').classList.contains('active')) renderHistory();
});

document.getElementById('edit-open').addEventListener('click', () => {
  const tx = state.transactions.find(t => t.id === editingId);
  if (!tx) return;
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
  populateCategories();
  setTimeout(() => {
    document.getElementById('tx-category').value = tx.category;
    updateSubcategories();
    setTimeout(() => { document.getElementById('tx-subcategory').value = tx.subcategory || ''; }, 30);
    document.getElementById('tx-source').value = tx.cardId ? 'card' : 'account';
    updateSourceOptions();
    setTimeout(() => { document.getElementById('tx-source-id').value = tx.cardId || tx.accountId; }, 30);
  }, 30);
  document.getElementById('btn-save-tx').innerText = 'Update Transaction';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');
  switchView('add');
});

document.getElementById('btn-cancel-edit').addEventListener('click', () => resetAddForm());

function resetAddForm() {
  document.getElementById('tx-edit-id').value = '';
  document.getElementById('form-tx').reset();
  document.getElementById('tx-type').value = addType;
  document.getElementById('btn-save-tx').innerText = 'Save';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
  populateAddForm();
}

// ============ ADD FORM ============
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
}

function populateCategories() {
  const type = document.getElementById('tx-type').value;
  const parents = state.categories.filter(c => c.type === type && !c.parentId);
  parents.sort((a,b) => (parseInt(a.sortOrder)||0) - (parseInt(b.sortOrder)||0));
  document.getElementById('tx-category').innerHTML = parents.map(c => `<option value="${escapeHtml(c.name)}">${c.icon} ${c.name}</option>`).join('');
  updateSubcategories();
  updateFuelFieldVisibility();
}

function updateSubcategories() {
  const parentName = document.getElementById('tx-category').value;
  const parent = state.categories.find(c => c.name === parentName && !c.parentId);
  const subs = parent ? state.categories.filter(c => c.parentId === parent.id) : [];
  document.getElementById('tx-subcategory').innerHTML = '<option value="">— None —</option>' + subs.map(s => `<option value="${escapeHtml(s.name)}">${s.icon} ${s.name}</option>`).join('');
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
    if (!document.getElementById('fuel-fields').classList.contains('hidden')) document.getElementById('tx-amount').value = (l * p).toFixed(2);
  });
});

function updateSourceOptions() {
  const source = document.getElementById('tx-source').value;
  const uid = state.currentUserId;
  const sel = document.getElementById('tx-source-id');
  if (source === 'account') {
    const accs = state.accounts.filter(a => !uid || a.owner === uid);
    sel.innerHTML = accs.map(a => `<option value="${a.id}">${a.name} (${getUserName(a.owner)}) — ${money(a.balance)}</option>`).join('') || '<option value="">No accounts</option>';
  } else {
    const cards = state.cards.filter(c => !uid || c.owner === uid);
    sel.innerHTML = cards.map(c => `<option value="${c.id}">${c.name} •${c.last4} (${getUserName(c.owner)}) — ${money(c.balance)}</option>`).join('') || '<option value="">No cards</option>';
  }
}

function populatePayOptions() {
  document.getElementById('pay-card').innerHTML = state.cards.map(c => `<option value="${c.id}">${c.name} •${c.last4} (${getUserName(c.owner)}) — ${money(c.balance)} owed</option>`).join('') || '<option value="">No cards</option>';
  document.getElementById('pay-account').innerHTML = state.accounts.map(a => `<option value="${a.id}">${a.name} — ${money(a.balance)}</option>`).join('') || '<option value="">No accounts</option>';
}

document.getElementById('form-tx').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('tx-edit-id').value;
  const category = document.getElementById('tx-category').value;
  const isFuel = category === 'Fuel';
  let amount = parseFloat(document.getElementById('tx-amount').value);
  if (isFuel && !editId) amount = parseFloat(document.getElementById('fuel-total').value) || amount;
  if (!amount || amount <= 0) return alert('Enter valid amount');

  const sourceType = document.getElementById('tx-source').value;
  const sourceId = document.getElementById('tx-source-id').value;
  if (!sourceId) return alert('Add an account or card first');

  const btn = document.getElementById('btn-save-tx');
  btn.disabled = true; btn.innerText = 'Saving...';

  if (editId) {
    const subVal = document.getElementById('tx-subcategory').value;
    const res = await api('updateTx', { id: editId, data: {
      date: document.getElementById('tx-date').value, type: document.getElementById('tx-type').value, amount, category, subcategory: subVal,
      product: document.getElementById('tx-product').value, note: document.getElementById('tx-note').value,
      accountId: sourceType === 'account' ? sourceId : '', cardId: sourceType === 'card' ? sourceId : ''
    }});
    btn.disabled = false; btn.innerText = 'Update Transaction';
    if (!res.success) return alert('Update failed: ' + res.error);
  } else if (isFuel) {
    const res = await api('addFuel', { data: {
      id: Date.now().toString(), date: document.getElementById('tx-date').value,
      vehicle: document.getElementById('fuel-vehicle').value.trim(), odometer: parseFloat(document.getElementById('fuel-odo').value),
      liters: parseFloat(document.getElementById('fuel-liters').value), pricePerLiter: parseFloat(document.getElementById('fuel-ppl').value), total: amount,
      fullTank: document.getElementById('fuel-full').checked, cardId: sourceType === 'card' ? sourceId : '',
      accountId: sourceType === 'account' ? sourceId : '', userId: state.currentUserId, note: document.getElementById('tx-note').value
    }});
    btn.disabled = false; btn.innerText = 'Save';
    if (!res.success) return alert('Save failed: ' + res.error);
  } else {
    const subVal = document.getElementById('tx-subcategory').value;
    const res = await api('addTx', { data: {
      id: Date.now().toString(), date: document.getElementById('tx-date').value, type: document.getElementById('tx-type').value, amount, category, subcategory: subVal,
      product: document.getElementById('tx-product').value, note: document.getElementById('tx-note').value,
      accountId: sourceType === 'account' ? sourceId : '', cardId: sourceType === 'card' ? sourceId : '', userId: state.currentUserId, fuelId: ''
    }});
    btn.disabled = false; btn.innerText = 'Save';
    if (!res.success) return alert('Save failed: ' + res.error);
  }

  await fetchAll();
  resetAddForm();
  switchView('dashboard');
});

document.getElementById('form-payment').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('addPayment', { data: {
    id: Date.now().toString(), date: document.getElementById('pay-date').value, cardId: document.getElementById('pay-card').value,
    accountId: document.getElementById('pay-account').value, amount: parseFloat(document.getElementById('pay-amount').value), note: document.getElementById('pay-note').value
  }});
  if (!res.success) return alert('Failed: ' + res.error);
  await fetchAll(); document.getElementById('form-payment').reset(); document.getElementById('pay-date').value = new Date().toISOString().split('T')[0]; switchView('dashboard');
});

// ============ ACCOUNTS & SETTINGS ============
function renderAccounts() {
  document.getElementById('accounts-list').innerHTML = state.accounts.length
    ? state.accounts.map(a => `<div class="item"><div class="item-icon">🏦</div><div class="item-info"><div class="item-title">${escapeHtml(a.name)}</div><div class="item-sub">${a.type.toUpperCase()} • ${getUserName(a.owner)}</div></div><div class="item-amt">${money(a.balance)}</div></div>`).join('')
    : '<div class="empty">No accounts yet</div>';
  document.getElementById('cards-list').innerHTML = state.cards.length
    ? state.cards.map(c => `<div class="item"><div class="item-icon" style="background:${c.color}22">💳</div><div class="item-info"><div class="item-title">${escapeHtml(c.name)} •${c.last4}</div><div class="item-sub">${getUserName(c.owner)} • Limit ${money(c.limit)}</div></div><div class="item-amt expense">${money(c.balance)}</div></div>`).join('')
    : '<div class="empty">No cards yet</div>';
}

function getUserName(uid) { const u = state.users.find(x => x.id === uid); return u ? u.name : '—'; }

document.getElementById('btn-add-account').addEventListener('click', async () => {
  const name = prompt('Account name:'); if (!name) return;
  const type = prompt('Type (cash/bank/savings/wallet):', 'bank') || 'bank';
  const balance = parseFloat(prompt('Opening balance (QR):', '0') || '0');
  const owner = state.currentUserId || state.users[0]?.id || '';
  await api('addAccount', { data: { id: Date.now().toString(), name, type, owner, balance, currency: 'QAR' }});
  await fetchAll(); renderAccounts();
});

document.getElementById('btn-add-card').addEventListener('click', async () => {
  const name = prompt('Card name:'); if (!name) return;
  const last4 = prompt('Last 4 digits:', '0000') || '0000';
  const limit = parseFloat(prompt('Credit limit (QR):', '5000') || '5000');
  const dueDay = parseInt(prompt('Due day of month (1-28):', '15') || '15');
  const owner = state.currentUserId || state.users[0]?.id || '';
  const color = prompt('Color hex:', '#1c1c1e') || '#1c1c1e';
  await api('addCard', { data: { id: Date.now().toString(), name, last4, owner, limit, balance: 0, dueDay, color }});
  await fetchAll(); renderAccounts();
});

function renderDashboardBudgets() {
  const uid = state.currentUserId;
  const cutoff = dateOffset(-30);
  const uid_txs = state.transactions.filter(t => t.date >= cutoff && t.type === 'expense' && (!uid || t.userId === uid));
  const budgets = state.budgets || [];
  if (budgets.length === 0) { document.getElementById('dash-budgets').innerHTML = '<div class="empty">No budgets set yet. Go to More → Budgets.</div>'; return; }
  document.getElementById('dash-budgets').innerHTML = budgets.map(b => {
    const spent = uid_txs.filter(t => t.category === b.category).reduce((s,t) => s+t.amount, 0);
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
window.deleteBudget = async (id) => { if (!confirm('Remove budget?')) return; await api('deleteBudget', { id }); await fetchAll(); renderBudgetsSettings(); };

document.getElementById('btn-add-budget').addEventListener('click', async () => {
  const cat = prompt('Category name (e.g. Fuel):'); if (!cat) return;
  const amt = parseFloat(prompt('Monthly budget in QR:')); if (!amt) return;
  await api('saveBudget', { data: { category: cat, amount: amt, period: 'monthly', userId: state.currentUserId || '' }});
  await fetchAll(); renderBudgetsSettings();
});

const darkToggle = document.getElementById('toggle-dark');
const isDark = localStorage.getItem('darkMode') === '1';
if (isDark) { document.body.classList.add('dark'); darkToggle.checked = true; }
darkToggle.addEventListener('change', (e) => {
  if (e.target.checked) { document.body.classList.add('dark'); localStorage.setItem('darkMode', '1'); }
  else { document.body.classList.remove('dark'); localStorage.setItem('darkMode', '0'); }
});

function renderSettings() {
  document.getElementById('sheet-link').href = SHEET_URL;
  document.getElementById('info-count').innerText = `${state.transactions.length} transactions • ${state.accounts.length} accounts • ${state.cards.length} cards`;
  renderBudgetsSettings();
  
  document.getElementById('btn-export').onclick = () => {
    let csv = `Date,Type,Amount (${CURRENCY}),Category,Subcategory,Product,Note,User,Account,Card\n`;
    state.transactions.forEach(t => { csv += `${t.date},${t.type},${t.amount},"${t.category}","${t.subcategory}","${(t.product||'').replace(/"/g,'""')}","${(t.note||'').replace(/"/g,'""')}","${getUserName(t.userId)}","${t.accountId}","${t.cardId}"\n`; });
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  document.getElementById('btn-sync').onclick = async () => { await fetchAll(); renderSettings(); alert('Synced!'); };
  document.getElementById('btn-reset-cats').onclick = async () => { if (!confirm('Reload default categories?')) return; const res = await api('resetCategories'); if (res.success) { await fetchAll(); alert('Categories reloaded!'); } else alert('Failed: ' + res.error); };
  
  // Progress Bar Update Logic
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
      if (progress > 90) {
        progress = 90; // Stop at 90% until reload
      }
      bar.style.width = progress + '%';
      text.innerText = progress + '%';
      
      if (progress >= 90) {
        clearInterval(interval);
        setTimeout(() => {
          bar.style.width = '100%';
          text.innerText = '100%';
          // Cache-busting reload
          window.location.href = window.location.pathname + '?update=' + Date.now();
        }, 300);
      }
    }, 40);
  };
}

function renderUserSwitcher() {
  const sel = document.getElementById('user-switcher');
  if (state.users.length === 0) { sel.innerHTML = '<option>Loading...</option>'; return; }
  sel.innerHTML = '<option value="">👥 Both</option>' + state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  sel.value = state.currentUserId || '';
}
document.getElementById('user-switcher').addEventListener('change', (e) => {
  state.currentUserId = e.target.value; sessionStorage.setItem('currentUser', state.currentUserId);
  renderDashboard(); if (document.getElementById('view-history').classList.contains('active')) renderHistory();
});

// ============ INIT ============
async function init() {
  await fetchAll();
  renderUserSwitcher();
  renderDashboard();
  setInterval(fetchAll, 60000);
}
init();
