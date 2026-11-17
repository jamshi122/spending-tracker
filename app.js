// ============================================
// YOUR CONFIGURATION - DO NOT CHANGE
// ============================================
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxhJXudubUWPaHt62mcnx1yl0JpAWJOBv4dszwo6caBJPUiB-dTHzgdTXFCrhvAZC5m/exec";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1syWFz8Gx_0yRmREAFBqyrSDCsladhzS5_-RmcIzvJbY/edit";
// ============================================

let state = {
  transactions: [],
  accounts: [],
  cards: [],
  payments: [],
  fuel: [],
  categories: [],
  users: [],
  currentUserId: sessionStorage.getItem('currentUser') || ''
};

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
  } catch (e) {
    setStatus(false);
    return { success: false, error: e.toString() };
  }
}

async function fetchAll() {
  try {
    const res = await fetch(BACKEND_URL);
    const json = await res.json();
    if (json.success) {
      state.transactions = (json.data.TX || []).map(normalizeTx);
      state.accounts = (json.data.ACC || []).map(normalizeAcc);
      state.cards = (json.data.CARD || []).map(normalizeCard);
      state.payments = json.data.PAY || [];
      state.fuel = (json.data.FUEL || []).map(normalizeFuel);
      state.categories = json.data.CAT || [];
      state.users = json.data.USER || [];
      setStatus(true);
      await seedFirstUserIfNeeded();
    }
  } catch (e) {
    setStatus(false);
    console.error(e);
  }
}

async function seedFirstUserIfNeeded() {
  if (state.users.length === 0) {
    await api('addUser', { data: { id: 'u1', name: 'Husband', color: '#007aff' } });
    await api('addUser', { data: { id: 'u2', name: 'Wife', color: '#ff2d55' } });
    await fetchAll();
    return;
  }
  if (state.accounts.length === 0) {
    await api('addAccount', { data: {
      id: 'acc1', name: 'Husband Bank', type: 'bank',
      owner: 'u1', balance: 0, currency: 'USD'
    }});
    await api('addAccount', { data: {
      id: 'acc2', name: 'Wife Bank', type: 'bank',
      owner: 'u2', balance: 0, currency: 'USD'
    }});
    await fetchAll();
  }
}

function setStatus(online) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status-dot' + (online ? '' : ' offline');
  el.title = online ? 'Connected' : 'Offline — changes queued';
}

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
    fuelId: String(t.fuelId || '')
  };
}
function normalizeAcc(a) {
  return {
    id: String(a.id), name: a.name, type: a.type,
    owner: String(a.owner), balance: parseFloat(a.balance) || 0,
    currency: a.currency || 'USD'
  };
}
function normalizeCard(c) {
  return {
    id: String(c.id), name: c.name, last4: String(c.last4 || ''),
    owner: String(c.owner), limit: parseFloat(c.limit) || 0,
    balance: parseFloat(c.balance) || 0,
    dueDay: parseInt(c.dueDay) || 15,
    color: c.color || '#1c1c1e'
  };
}
function normalizeFuel(f) {
  return {
    id: String(f.id), date: normalizeDate(f.date),
    vehicle: f.vehicle, odometer: parseFloat(f.odometer) || 0,
    liters: parseFloat(f.liters) || 0,
    pricePerLiter: parseFloat(f.pricePerLiter) || 0,
    total: parseFloat(f.total) || 0,
    cardId: String(f.cardId || ''),
    accountId: String(f.accountId || ''),
    userId: String(f.userId || ''),
    fullTank: String(f.fullTank) === 'true'
  };
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
  document.getElementById('page-title').innerText =
    name.charAt(0).toUpperCase() + name.slice(1);

  if (name === 'dashboard') renderDashboard();
  if (name === 'add') populateAddForm();
  if (name === 'accounts') renderAccounts();
  if (name === 'analytics') renderAnalytics();
  if (name === 'settings') renderSettings();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ============ DASHBOARD ============
function renderDashboard() {
  const uid = state.currentUserId;
  const filterByUser = (arr) => uid ? arr.filter(x => x.userId === uid || !x.userId) : arr;
  const txs = filterByUser(state.transactions);

  const cash = state.accounts
    .filter(a => !uid || a.owner === uid)
    .reduce((s, a) => s + a.balance, 0);
  const cardsDebt = state.cards
    .filter(c => !uid || c.owner === uid)
    .reduce((s, c) => s + c.balance, 0);
  const net = cash - cardsDebt;

  const cutoff = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
  const recent30 = txs.filter(t => t.date >= cutoff);
  const income = recent30.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = recent30.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const fuelEff = calcFuelEfficiency(filterByUser(state.fuel));

  document.getElementById('dash-net').innerText = `$${net.toFixed(2)}`;
  document.getElementById('dash-cash').innerText = `$${cash.toFixed(2)}`;
  document.getElementById('dash-cards').innerText = `$${cardsDebt.toFixed(2)}`;
  document.getElementById('dash-income').innerText = `$${income.toFixed(0)}`;
  document.getElementById('dash-expense').innerText = `$${expense.toFixed(0)}`;
  document.getElementById('dash-fuel').innerText = fuelEff || '—';

  const accEl = document.getElementById('dash-accounts');
  const filteredCards = state.cards.filter(c => !uid || c.owner === uid);
  const filteredAccs = state.accounts.filter(a => !uid || a.owner === uid);
  accEl.innerHTML = [
    ...filteredAccs.map(a => `
      <div class="mini-card" style="background:linear-gradient(135deg,#34c759,#30d158)">
        <small>${a.name}</small>
        <b>$${a.balance.toFixed(2)}</b>
        <small>${a.type.toUpperCase()}</small>
      </div>
    `),
    ...filteredCards.map(c => `
      <div class="mini-card" style="background:linear-gradient(135deg,${c.color},${shade(c.color,-30)})">
        <small>${c.name} •${c.last4}</small>
        <b>$${c.balance.toFixed(2)}</b>
        <small>Limit $${c.limit.toFixed(0)}</small>
      </div>
    `)
  ].join('') || '<div class="empty">No accounts/cards yet</div>';

  const catTotals = {};
  recent30.filter(t => t.type === 'expense').forEach(t => {
    const k = t.category || 'Other';
    catTotals[k] = (catTotals[k] || 0) + t.amount;
  });
  const topCats = Object.entries(catTotals).sort((a,b) => b[1]-a[1]).slice(0, 5);
  document.getElementById('dash-top-cats').innerHTML = topCats.length
    ? topCats.map(([name, amt]) => `
        <div class="item">
          <div class="item-icon">${getCategoryIcon(name)}</div>
          <div class="item-info"><div class="item-title">${name}</div></div>
          <div class="item-amt expense">$${amt.toFixed(2)}</div>
        </div>
      `).join('')
    : '<div class="empty">No expenses in 30 days</div>';

  const recent = [...txs].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 8);
  document.getElementById('dash-recent').innerHTML = recent.length
    ? recent.map(t => txRowHTML(t)).join('')
    : '<div class="empty">No transactions yet</div>';
}

function txRowHTML(t) {
  const icon = getCategoryIcon(t.category);
  const amtClass = t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '↔';
  const sub = [t.subcategory, t.product, t.note].filter(Boolean).join(' • ');
  return `<div class="item">
    <div class="item-icon">${icon}</div>
    <div class="item-info">
      <div class="item-title">${t.category || 'Uncategorized'}</div>
      ${sub ? `<div class="item-sub">${escapeHtml(sub)}</div>` : ''}
      <div class="item-sub">${t.date}</div>
    </div>
    <div class="item-amt ${amtClass}">${sign}$${t.amount.toFixed(2)}</div>
  </div>`;
}

function getCategoryIcon(name) {
  const cat = state.categories.find(c => c.name === name);
  return cat ? cat.icon : '📌';
}

function shade(hex, percent) {
  const num = parseInt(hex.replace('#',''),16);
  const r = Math.max(0, Math.min(255, (num>>16) + percent));
  const g = Math.max(0, Math.min(255, ((num>>8)&0xFF) + percent));
  const b = Math.max(0, Math.min(255, (num&0xFF) + percent));
  return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ============ FUEL EFFICIENCY ============
function calcFuelEfficiency(fuelLogs) {
  const byVehicle = {};
  fuelLogs.filter(f => f.fullTank).forEach(f => {
    (byVehicle[f.vehicle] = byVehicle[f.vehicle] || []).push(f);
  });
  let totalKm = 0, totalLiters = 0;
  Object.values(byVehicle).forEach(logs => {
    logs.sort((a,b) => a.odometer - b.odometer);
    for (let i = 1; i < logs.length; i++) {
      const km = logs[i].odometer - logs[i-1].odometer;
      const L = logs[i].liters;
      if (km > 0 && L > 0) { totalKm += km; totalLiters += L; }
    }
  });
  if (totalLiters === 0 || totalKm === 0) return null;
  return ((totalLiters / totalKm) * 100).toFixed(1) + ' L/100km';
}

// ============ ADD FORM ============
let currentTab = 'expense';

document.querySelectorAll('.tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.getElementById('form-tx').classList.toggle('hidden', currentTab === 'fuel' || currentTab === 'payment');
    document.getElementById('form-fuel').classList.toggle('hidden', currentTab !== 'fuel');
    document.getElementById('form-payment').classList.toggle('hidden', currentTab !== 'payment');
    if (currentTab === 'expense' || currentTab === 'income') {
      document.getElementById('tx-type').value = currentTab;
      populateCategories();
    }
  });
});

function populateAddForm() {
  const today = new Date().toISOString().split('T')[0];
  ['tx-date','fuel-date','pay-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
  populateCategories();
  populateSourceOptions('tx-source','tx-source-id');
  populateSourceOptions('fuel-source','fuel-source-id');
  populatePayOptions();
}

function populateCategories() {
  const type = document.getElementById('tx-type').value;
  const parents = state.categories.filter(c => c.type === type && !c.parentId);
  document.getElementById('tx-category').innerHTML =
    parents.map(c => `<option value="${escapeHtml(c.name)}">${c.icon} ${c.name}</option>`).join('');
  updateSubcategories();
}

function updateSubcategories() {
  const parentName = document.getElementById('tx-category').value;
  const parent = state.categories.find(c => c.name === parentName && !c.parentId);
  const subs = parent ? state.categories.filter(c => c.parentId === parent.id) : [];
  document.getElementById('tx-subcategory').innerHTML =
    '<option value="">—</option>' +
    subs.map(s => `<option value="${escapeHtml(s.name)}">${s.name}</option>`).join('');
}

document.getElementById('tx-category').addEventListener('change', updateSubcategories);
document.getElementById('tx-source').addEventListener('change', () => populateSourceOptions('tx-source','tx-source-id'));
document.getElementById('fuel-source').addEventListener('change', () => populateSourceOptions('fuel-source','fuel-source-id'));

function populateSourceOptions(typeId, idId) {
  const type = document.getElementById(typeId).value;
  const uid = state.currentUserId;
  if (type === 'account') {
    const accs = state.accounts.filter(a => !uid || a.owner === uid);
    document.getElementById(idId).innerHTML =
      accs.map(a => `<option value="${a.id}">${a.name} ($${a.balance.toFixed(2)})</option>`).join('')
      || '<option value="">No accounts</option>';
  } else {
    const cards = state.cards.filter(c => !uid || c.owner === uid);
    document.getElementById(idId).innerHTML =
      cards.map(c => `<option value="${c.id}">${c.name} •${c.last4}</option>`).join('')
      || '<option value="">No cards</option>';
  }
}

function populatePayOptions() {
  document.getElementById('pay-card').innerHTML =
    state.cards.map(c => `<option value="${c.id}">${c.name} ($${c.balance.toFixed(2)} owed)</option>`).join('')
    || '<option value="">No cards</option>';
  document.getElementById('pay-account').innerHTML =
    state.accounts.map(a => `<option value="${a.id}">${a.name} ($${a.balance.toFixed(2)})</option>`).join('')
    || '<option value="">No accounts</option>';
}

['fuel-liters','fuel-ppl'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const l = parseFloat(document.getElementById('fuel-liters').value) || 0;
    const p = parseFloat(document.getElementById('fuel-ppl').value) || 0;
    document.getElementById('fuel-total').value = (l * p).toFixed(2);
  });
});

document.getElementById('form-tx').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('tx-amount').value);
  if (!amount || amount <= 0) return alert('Enter valid amount');

  const type = document.getElementById('tx-type').value;
  const sourceType = document.getElementById('tx-source').value;
  const sourceId = document.getElementById('tx-source-id').value;

  const tx = {
    id: Date.now().toString(),
    date: document.getElementById('tx-date').value,
    type: type,
    amount: amount,
    category: document.getElementById('tx-category').value,
    subcategory: document.getElementById('tx-subcategory').value,
    product: document.getElementById('tx-product').value,
    note: document.getElementById('tx-note').value,
    accountId: sourceType === 'account' ? sourceId : '',
    cardId: sourceType === 'card' ? sourceId : '',
    userId: state.currentUserId,
    fuelId: '',
    createdAt: new Date().toISOString()
  };

  const btn = document.getElementById('btn-save-tx');
  btn.disabled = true; btn.innerText = 'Saving...';
  const res = await api('addTx', { data: tx });
  btn.disabled = false; btn.innerText = 'Save';

  if (!res.success) return alert('Save failed: ' + (res.error || 'unknown'));

  await fetchAll();
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-product').value = '';
  document.getElementById('tx-note').value = '';
  switchView('dashboard');
});

document.getElementById('form-fuel').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sourceType = document.getElementById('fuel-source').value;
  const sourceId = document.getElementById('fuel-source-id').value;

  const fuel = {
    id: Date.now().toString(),
    date: document.getElementById('fuel-date').value,
    vehicle: document.getElementById('fuel-vehicle').value,
    odometer: parseFloat(document.getElementById('fuel-odo').value),
    liters: parseFloat(document.getElementById('fuel-liters').value),
    pricePerLiter: parseFloat(document.getElementById('fuel-ppl').value),
    total: parseFloat(document.getElementById('fuel-total').value),
    fullTank: document.getElementById('fuel-full').checked,
    cardId: sourceType === 'card' ? sourceId : '',
    accountId: sourceType === 'account' ? sourceId : '',
    userId: state.currentUserId,
    note: ''
  };

  const res = await api('addFuel', { data: fuel });
  if (!res.success) return alert('Save failed: ' + res.error);

  await fetchAll();
  e.target.reset();
  document.getElementById('fuel-date').value = new Date().toISOString().split('T')[0];
  switchView('dashboard');
});

document.getElementById('form-payment').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payment = {
    id: Date.now().toString(),
    date: document.getElementById('pay-date').value,
    cardId: document.getElementById('pay-card').value,
    accountId: document.getElementById('pay-account').value,
    amount: parseFloat(document.getElementById('pay-amount').value),
    note: document.getElementById('pay-note').value
  };

  const res = await api('addPayment', { data: payment });
  if (!res.success) return alert('Save failed: ' + res.error);

  await fetchAll();
  e.target.reset();
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  switchView('dashboard');
});

// ============ ACCOUNTS ============
function renderAccounts() {
  document.getElementById('accounts-list').innerHTML = state.accounts.length
    ? state.accounts.map(a => `
        <div class="item">
          <div class="item-icon">🏦</div>
          <div class="item-info">
            <div class="item-title">${a.name}</div>
            <div class="item-sub">${a.type.toUpperCase()} • ${getUserName(a.owner)}</div>
          </div>
          <div class="item-amt">$${a.balance.toFixed(2)}</div>
        </div>
      `).join('')
    : '<div class="empty">No accounts</div>';

  document.getElementById('cards-list').innerHTML = state.cards.length
    ? state.cards.map(c => `
        <div class="item">
          <div class="item-icon">💳</div>
          <div class="item-info">
            <div class="item-title">${c.name} •${c.last4}</div>
            <div class="item-sub">${getUserName(c.owner)} • Limit $${c.limit.toFixed(0)}</div>
          </div>
          <div class="item-amt expense">$${c.balance.toFixed(2)}</div>
        </div>
      `).join('')
    : '<div class="empty">No cards</div>';
}

function getUserName(uid) {
  const u = state.users.find(x => x.id === uid);
  return u ? u.name : '—';
}

document.getElementById('btn-add-account').addEventListener('click', async () => {
  const name = prompt('Account name:'); if (!name) return;
  const type = prompt('Type (cash/bank/savings/wallet):', 'bank') || 'bank';
  const balance = parseFloat(prompt('Current balance:', '0') || '0');
  const owner = state.currentUserId || (state.users[0]?.id || '');
  await api('addAccount', { data: {
    id: Date.now().toString(), name, type,
    owner, balance, currency: 'USD'
  }});
  await fetchAll(); renderAccounts();
});

document.getElementById('btn-add-card').addEventListener('click', async () => {
  const name = prompt('Card name:'); if (!name) return;
  const last4 = prompt('Last 4 digits:', '0000') || '0000';
  const limit = parseFloat(prompt('Credit limit:', '5000') || '5000');
  const dueDay = parseInt(prompt('Due day of month (1-28):', '15') || '15');
  const owner = state.currentUserId || (state.users[0]?.id || '');
  const color = prompt('Color hex:', '#1c1c1e') || '#1c1c1e';
  await api('addCard', { data: {
    id: Date.now().toString(), name, last4, owner,
    limit, balance: 0, dueDay, color
  }});
  await fetchAll(); renderAccounts();
});

// ============ ANALYTICS ============
let analyticsPeriod = 30;
document.querySelectorAll('.tab[data-period]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-period]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    analyticsPeriod = parseInt(tab.dataset.period);
    renderAnalytics();
  });
});

function renderAnalytics() {
  const cutoff = new Date(Date.now() - analyticsPeriod*86400000).toISOString().split('T')[0];
  const uid = state.currentUserId;
  const txs = state.transactions
    .filter(t => t.date >= cutoff)
    .filter(t => !uid || t.userId === uid);
  const expenses = txs.filter(t => t.type === 'expense');

  const catTotals = {};
  expenses.forEach(t => {
    const k = t.category || 'Other';
    catTotals[k] = (catTotals[k] || 0) + t.amount;
  });
  const sorted = Object.entries(catTotals).sort((a,b) => b[1]-a[1]);
  const maxCat = sorted[0]?.[1] || 1;
  document.getElementById('chart-cats').innerHTML = sorted.length
    ? sorted.map(([name, amt]) => `
        <div class="bar-row">
          <div class="bar-label"><span>${getCategoryIcon(name)} ${name}</span><b>$${amt.toFixed(2)}</b></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(amt/maxCat)*100}%"></div></div>
        </div>
      `).join('')
    : '<div class="empty">No expenses</div>';

  const prodTotals = {};
  expenses.filter(t => t.product).forEach(t => {
    prodTotals[t.product] = (prodTotals[t.product] || 0) + t.amount;
  });
  const topProds = Object.entries(prodTotals).sort((a,b) => b[1]-a[1]).slice(0, 10);
  document.getElementById('chart-products').innerHTML = topProds.length
    ? topProds.map(([p, amt], i) => `
        <div class="item">
          <div class="item-icon">${i+1}</div>
          <div class="item-info"><div class="item-title">${escapeHtml(p)}</div></div>
          <div class="item-amt expense">$${amt.toFixed(2)}</div>
        </div>
      `).join('')
    : '<div class="empty">No products tracked</div>';

  const fuelLogs = state.fuel.filter(f => f.date >= cutoff);
  const eff = calcFuelEfficiency(fuelLogs);
  document.getElementById('chart-fuel').innerHTML = fuelLogs.length
    ? fuelLogs.slice(0, 10).map(f => `
        <div class="item">
          <div class="item-icon">⛽</div>
          <div class="item-info">
            <div class="item-title">${escapeHtml(f.vehicle)} • ${f.liters}L</div>
            <div class="item-sub">${f.odometer} km • $${f.pricePerLiter.toFixed(2)}/L</div>
          </div>
          <div class="item-amt expense">$${f.total.toFixed(2)}</div>
        </div>
      `).join('') + (eff ? `<div class="hint">Overall: ${eff}</div>` : '')
    : '<div class="empty">No fuel logs</div>';
}

// ============ SETTINGS ============
function renderSettings() {
  document.getElementById('sheet-link').href = SHEET_URL;
  document.getElementById('info-count').innerText =
    `${state.transactions.length} transactions, ${state.accounts.length} accounts, ${state.cards.length} cards`;

  document.getElementById('btn-export').onclick = () => {
    let csv = 'Date,Type,Amount,Category,Subcategory,Product,Note,User,Account,Card\n';
    state.transactions.forEach(t => {
      csv += `${t.date},${t.type},${t.amount},"${t.category}","${t.subcategory}","${(t.product||'').replace(/"/g,'""')}","${(t.note||'').replace(/"/g,'""')}","${getUserName(t.userId)}","${t.accountId}","${t.cardId}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('btn-sync').onclick = async () => {
    await fetchAll();
    renderSettings();
    alert('Synced from Google Sheets');
  };
}

// ============ USER SWITCHER ============
function renderUserSwitcher() {
  const sel = document.getElementById('user-switcher');
  if (state.users.length === 0) {
    sel.innerHTML = '<option>Loading...</option>';
    return;
  }
  sel.innerHTML = '<option value="">👥 Both</option>' +
    state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  sel.value = state.currentUserId || '';
}

document.getElementById('user-switcher').addEventListener('change', (e) => {
  state.currentUserId = e.target.value;
  sessionStorage.setItem('currentUser', state.currentUserId);
  renderDashboard();
});

// ============ INIT ============
async function init() {
  await fetchAll();
  renderUserSwitcher();
  renderDashboard();
  setInterval(fetchAll, 60000);
}

init();