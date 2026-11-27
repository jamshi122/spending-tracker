/* Jamshi Solution – Spending Tracker | secure frontend */
'use strict';

const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxhJXudubUWPaHt62mcnx1yl0JpAWJOBv4dszwo6caBJPUiB-dTHzgdTXFCrhvAZC5m/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1syWFz8Gx_0yRmREAFBqyrSDCsladhzS5_-RmcIzvJbY/edit?gid=1251417057#gid=1251417057';
const GOOGLE_CLIENT_ID = '686310480898-0aqo8gm4l53djgml96l5hirpq8vl4o90.apps.googleusercontent.com';
const CURRENCY = 'QR';

const state = {
  accessToken: null, tokenExpiry: 0, tokenClient: null, user: null,
  transactions: [], accounts: [], cards: [], payments: [], fuel: [],
  categories: [], users: [], budgets: [], version: null, busy: false,
  editId: null, receipt: null
};

const $ = id => document.getElementById(id);
const num = v => Number.parseFloat(v) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => `${CURRENCY} ${num(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function toast(message, kind='info') {
  const el = $('toast'); if (!el) return;
  el.textContent = message; el.className = `toast show ${kind}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className='toast', 3200);
}
function setStatus(ok) { $('status').classList.toggle('offline', !ok); $('status').title = ok ? 'Connected' : 'Offline'; }
function setBusy(on, label='Working…') { state.busy=on; $('busy-label').textContent=label; $('busy').classList.toggle('hidden',!on); }
function isAdmin() { return state.user?.role === 'admin'; }
function userName(id) { return state.users.find(u=>String(u.id)===String(id))?.name || '—'; }
function canEdit(tx) { return isAdmin() || String(tx.userId)===String(state.user?.id); }

function showGate(message='Sign in with an approved Google account to continue.') {
  $('login-gate').classList.remove('hidden'); $('app-shell').classList.add('hidden');
  $('login-message').textContent=message;
}
function showApp() { $('login-gate').classList.add('hidden'); $('app-shell').classList.remove('hidden'); }

function initGoogleIdentity() {
  if (!window.google?.accounts?.oauth2) { $('login-message').textContent='Google sign-in is loading. Refresh this page in a moment.'; return; }
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'openid email profile',
    callback: async response => {
      if (response.error || !response.access_token) { showGate('Google sign-in was not completed. Please try again.'); return; }
      state.accessToken=response.access_token;
      state.tokenExpiry=Date.now()+(Number(response.expires_in||3600)-60)*1000;
      await loadData(true);
    }
  });
}
function signIn() {
  if (!state.tokenClient) initGoogleIdentity();
  if (!state.tokenClient) { toast('Google sign-in is not ready. Refresh the page.','error'); return; }
  state.tokenClient.requestAccessToken({prompt:'consent'});
}
function ensureToken() {
  if (state.accessToken && Date.now()<state.tokenExpiry) return true;
  state.accessToken=null; showGate('Your sign-in session expired. Please sign in again.'); return false;
}

async function api(action, payload={}) {
  if (!ensureToken()) throw new Error('Please sign in again.');
  const response = await fetch(BACKEND_URL, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,accessToken:state.accessToken,...payload})
  });
  const result=await response.json();
  if (result.authRequired) { state.accessToken=null; showGate(result.error||'Please sign in again.'); throw new Error(result.error||'Authentication required.'); }
  if (!result.success) throw new Error(result.error||'Request failed.');
  setStatus(true); return result;
}
function normalizeTx(x) { return {...x,id:String(x.id),amount:num(x.amount),userId:String(x.userId||''),accountId:String(x.accountId||''),cardId:String(x.cardId||''),isPrivate:x.isPrivate===true||String(x.isPrivate)==='true'||String(x.isPrivate)==='1'}; }
function normalizeAccount(x) { return {...x,id:String(x.id),balance:num(x.balance)}; }
function normalizeCard(x) { return {...x,id:String(x.id),balance:num(x.balance),limit:num(x.limit)}; }

async function loadData(force=false) {
  try {
    setBusy(true,'Syncing your spending data…');
    const r=await api('getData',{version:force?null:state.version});
    if (r.unchanged) { state.user=r.user; showApp(); renderAll(); return; }
    const d=r.data||{};
    state.user=r.user; state.version=r.version;
    state.transactions=(d.TX||[]).map(normalizeTx);
    state.accounts=(d.ACC||[]).map(normalizeAccount);
    state.cards=(d.CARD||[]).map(normalizeCard);
    state.payments=d.PAY||[]; state.fuel=d.FUEL||[]; state.categories=d.CAT||[];
    state.users=d.USER||[]; state.budgets=d.BUDGET||[];
    showApp(); renderAll();
  } catch(e) { setStatus(false); if(state.accessToken) toast(e.message,'error'); }
  finally { setBusy(false); }
}

function renderAll() { $('user-label').textContent=`${state.user?.name||''}${isAdmin()?' · Admin':''}`; $('admin-only').classList.toggle('hidden',!isAdmin()); document.querySelectorAll('.admin-action').forEach(el=>el.classList.toggle('hidden',!isAdmin())); renderDashboard(); renderHistory(); renderAccounts(); renderSelects(); renderBudgets(); renderAdmin(); }
function last30() { const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-30); return state.transactions.filter(t=>new Date(t.date)>=cutoff); }
function renderDashboard() {
  const cash=state.accounts.reduce((s,a)=>s+num(a.balance),0), debt=state.cards.reduce((s,c)=>s+Math.max(0,num(c.balance)),0);
  const net=cash-debt, recent=last30();
  const income=recent.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), expense=recent.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  $('net-worth').textContent=money(net); $('cash-total').textContent=money(cash); $('debt-total').textContent=money(debt);
  $('income-total').textContent=money(income); $('expense-total').textContent=money(expense); $('saved-total').textContent=money(income-expense);
  $('dashboard-cards').innerHTML=state.cards.length?state.cards.map(c=>`<article class="credit-card" style="--card-color:${esc(c.color||'#334155')}"><div class="card-top"><span>${esc(c.name)}</span><span>•••• ${esc(c.last4||'')}</span></div><div class="card-balance">${money(Math.max(0,num(c.balance)))}</div><small>Outstanding balance · ${esc(c.owner||'')}</small><div class="card-limit">Limit ${money(c.limit)} · Available ${money(Math.max(0,num(c.limit)-num(c.balance)))}</div></article>`).join(''):'<p class="empty">No credit cards added yet.</p>';
  const groups={}; recent.filter(t=>t.type==='expense').forEach(t=>groups[t.category||'Other']=(groups[t.category||'Other']||0)+t.amount);
  const top=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,5);
  $('category-summary').innerHTML=top.length?top.map(([k,v])=>`<div class="summary-row"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join(''):'<p class="empty">No expenses in the last 30 days.</p>';
  $('recent-list').innerHTML=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8).map(txRow).join('')||'<p class="empty">No transactions yet.</p>';
}
function txRow(t) { return `<div class="tx-row"><div class="tx-icon">${t.type==='income'?'↗':'↘'}</div><div class="tx-main"><b>${esc(t.category||t.type)}</b><small>${esc(t.date)} · ${esc(t.product||t.note||'')}</small></div><strong class="${t.type}">${t.type==='income'?'+':'−'}${money(t.amount)}</strong><button class="small-btn" data-view-tx="${esc(t.id)}" aria-label="View transaction">•••</button></div>`; }
function renderHistory() {
  const q=($('search').value||'').toLowerCase(), type=$('history-type').value;
  const rows=state.transactions.filter(t=>(type==='all'||t.type===type)&&(!q||[t.category,t.subcategory,t.product,t.note,t.date].join(' ').toLowerCase().includes(q))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  $('history-list').innerHTML=rows.map(txRow).join('')||'<p class="empty">No matching transactions.</p>';
}
function renderAccounts() {
  $('accounts-list').innerHTML=state.accounts.map(a=>`<div class="account-row"><div><b>${esc(a.name)}</b><small>${esc(a.type||'Account')} · ${esc(a.owner||'')}</small></div><strong>${money(a.balance)}</strong></div>`).join('')||'<p class="empty">No accounts.</p>';
  $('cards-list').innerHTML=state.cards.map(c=>`<div class="account-row"><div><b>${esc(c.name)} ·•••• ${esc(c.last4||'')}</b><small>Limit ${money(c.limit)} · ${esc(c.owner||'')}</small></div><strong>${money(c.balance)}</strong></div>`).join('')||'<p class="empty">No credit cards.</p>';
}
function renderSelects() {
  const cats=state.categories; const expense=cats.filter(c=>!c.type||c.type==='expense');
  $('tx-category').innerHTML=expense.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('tx-account').innerHTML=state.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('');
  $('tx-card').innerHTML=state.cards.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} (•••• ${esc(c.last4||'')})</option>`).join('');
  $('budget-category').innerHTML=expense.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('payment-card').innerHTML=state.cards.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('payment-account').innerHTML=state.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
}
function renderBudgets() {
  $('budget-list').innerHTML=state.budgets.map(b=>`<div class="summary-row"><span>${esc(b.category)} · ${esc(b.period||'monthly')}</span><b>${money(b.amount)}</b></div>`).join('')||'<p class="empty">No budgets set.</p>';
}
function renderAdmin() {
  if(!isAdmin()) return;
  $('users-list').innerHTML=state.users.map(u=>`<div class="summary-row"><span>${esc(u.name)} <small>${esc(u.role)}</small></span><b>${esc(u.id)}</b></div>`).join('');
  $('categories-list').innerHTML=state.categories.map(c=>`<div class="summary-row"><span>${esc(c.icon||'•')} ${esc(c.name)}</span><small>${esc(c.type||'expense')}</small></div>`).join('');
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
  $('page-title').textContent=({dashboard:'Dashboard',history:'Transactions',add:'Add Transaction',accounts:'Accounts & Cards',settings:'Settings'})[name]||'Spending Tracker';
}
function sourceFields() { const card=$('tx-method').value==='card'; $('tx-account-wrap').classList.toggle('hidden',card); $('tx-card-wrap').classList.toggle('hidden',!card); $('fuel-extra').classList.toggle('hidden',$('tx-category').value.toLowerCase()!=='fuel'); }
async function uploadSelectedReceipt() { const file=$('tx-receipt').files?.[0]; if(!file) return ''; if(file.size>8*1024*1024) throw new Error('Receipt image must be smaller than 8 MB.'); const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);}); const up=await api('uploadReceipt',{data:{base64,mimeType:file.type||'application/octet-stream',name:file.name}}); return up.url||''; }
function resetTxForm() { $('tx-form').reset(); $('tx-date').value=today(); $('tx-edit-id').value=''; state.editId=null; $('tx-method').value='account'; sourceFields(); $('tx-form-title').textContent='New transaction'; }

async function saveTransaction(ev) {
  ev.preventDefault(); if(state.busy) return;
  const amount=num($('tx-amount').value), type=$('tx-type').value, method=$('tx-method').value;
  if(amount<=0) return toast('Enter an amount greater than zero.','error');
  const data={date:$('tx-date').value,type,amount,category:$('tx-category').value,subcategory:$('tx-subcategory').value,product:$('tx-product').value.trim(),note:$('tx-note').value.trim(),accountId:method==='account'?$('tx-account').value:'',cardId:method==='card'?$('tx-card').value:'',isPrivate:$('tx-private').checked};
  if((method==='account'&&!data.accountId)||(method==='card'&&!data.cardId)) return toast('Select an account or card.','error');
  try {
    setBusy(true,'Saving transaction…');
    const id=$('tx-edit-id').value, receiptUrl=await uploadSelectedReceipt();
    if(receiptUrl) data.receiptUrl=receiptUrl;
    if(id) await api('updateTx',{id,data});
    else if(type==='expense' && data.category.toLowerCase()==='fuel') {
      const fuelData={id:uid(),date:data.date,total:amount,vehicle:$('fuel-vehicle').value.trim(),odometer:num($('fuel-odometer').value),liters:num($('fuel-liters').value),pricePerLiter:num($('fuel-price').value),fullTank:$('fuel-full').checked,accountId:data.accountId,cardId:data.cardId,note:data.note,receiptUrl};
      await api('addFuel',{data:fuelData});
    } else await api('addTx',{data:{...data,id:uid()}});
    resetTxForm(); await loadData(true); switchView('dashboard'); toast(id?'Transaction updated.':'Transaction saved.','success');
  } catch(e){toast(e.message,'error');} finally{setBusy(false);}
}
async function openTransaction(id) {
  const tx=state.transactions.find(t=>t.id===id); if(!tx) return;
  const choices=[]; if(canEdit(tx)) choices.push('Edit'); if(canEdit(tx)) choices.push('Delete');
  const action=prompt(`${tx.date} · ${tx.category}\n${money(tx.amount)}\n${tx.note||tx.product||''}\n\nType EDIT or DELETE, or Cancel.`);
  if(!action) return;
  if(action.toLowerCase()==='delete'&&canEdit(tx)&&confirm('Delete this transaction permanently?')) {
    try{await api('deleteTx',{id});await loadData(true);toast('Transaction deleted.','success');}catch(e){toast(e.message,'error');}
  } else if(action.toLowerCase()==='edit'&&canEdit(tx)) {
    $('tx-edit-id').value=tx.id;$('tx-date').value=tx.date;$('tx-type').value=tx.type;$('tx-amount').value=tx.amount;$('tx-category').value=tx.category;$('tx-subcategory').value=tx.subcategory||'';$('tx-product').value=tx.product||'';$('tx-note').value=tx.note||'';$('tx-private').checked=tx.isPrivate;$('tx-method').value=tx.cardId?'card':'account';sourceFields();if(tx.cardId)$('tx-card').value=tx.cardId;else $('tx-account').value=tx.accountId;$('tx-form-title').textContent='Edit transaction';switchView('add');
  }
}

async function savePayment(ev) {
  ev.preventDefault(); const data={id:uid(),date:$('payment-date').value,cardId:$('payment-card').value,accountId:$('payment-account').value,amount:num($('payment-amount').value),note:$('payment-note').value};
  if(!data.cardId||!data.accountId||data.amount<=0) return toast('Complete all payment details.','error');
  try{setBusy(true,'Recording card payment…');await api('addPayment',{data});$('payment-form').reset();await loadData(true);toast('Payment recorded.','success');}catch(e){toast(e.message,'error');}finally{setBusy(false);}
}
async function addAccount() {
  if(!isAdmin()) return toast('Administrator access required.','error');
  const name=prompt('Account name (e.g. Cash, Bank):'); if(!name) return;
  const balance=Number(prompt('Current opening balance (QR):','0')); if(!Number.isFinite(balance)) return toast('Invalid balance.','error');
  try{await api('addAccount',{data:{id:uid(),name,type:'bank',owner:state.user.name,balance,currency:'QAR'}});await loadData(true);toast('Account added.','success');}catch(e){toast(e.message,'error');}
}
async function addCard() {
  if(!isAdmin()) return toast('Administrator access required.','error');
  const name=prompt('Credit card name:'); if(!name) return;
  const last4=(prompt('Last 4 digits (optional):')||'').slice(-4), limit=Number(prompt('Credit limit (QR):','0'));
  const balance=Number(prompt('Current card balance. Use a negative value for amount owed:','0'));
  if(!Number.isFinite(limit)||!Number.isFinite(balance)) return toast('Invalid card values.','error');
  try{await api('addCard',{data:{id:uid(),name,last4,owner:state.user.name,limit,balance,dueDay:15,color:'#334155'}});await loadData(true);toast('Credit card added.','success');}catch(e){toast(e.message,'error');}
}
async function saveBudget() {
  const data={category:$('budget-category').value,amount:num($('budget-amount').value),period:'monthly'};
  if(!data.category||data.amount<=0) return toast('Enter a valid budget.','error');
  try{await api('saveBudget',{data});await loadData(true);$('budget-amount').value='';toast('Budget saved.','success');}catch(e){toast(e.message,'error');}
}
async function addUser() {
  const name=prompt('New user name:'); if(!name) return;
  const email=prompt('Google account email to authorize:'); if(!email) return;
  const role=(prompt('Role: admin or user','user')||'user').toLowerCase();
  try{await api('addUser',{data:{name,email,role}});await loadData(true);toast('User added. Add them as an OAuth test user in Google Cloud if not already added.','success');}catch(e){toast(e.message,'error');}
}
async function addCategory() {
  const name=prompt('Category name:'); if(!name) return;
  const type=(prompt('Type: expense or income','expense')||'expense').toLowerCase();
  try{await api('addCategory',{data:{id:uid(),name,type,icon:'•',parentId:'',color:'#64748b',sortOrder:state.categories.length+1}});await loadData(true);toast('Category added.','success');}catch(e){toast(e.message,'error');}
}
function exportCsv() {
  const cols=['date','type','amount','category','subcategory','product','note','accountId','cardId','userId','isPrivate'];
  const lines=[cols.join(','),...state.transactions.map(t=>cols.map(k=>'"'+String(t[k]??'').replace(/"/g,'""')+'"').join(','))];
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jamshi-transactions.csv';a.click();URL.revokeObjectURL(url);
}
function signOut() { state.accessToken=null;state.user=null;state.version=null;showGate('You have signed out. Sign in to continue.'); }

function bindEvents() {
  $('google-signin').addEventListener('click',signIn);
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.nav)));
  $('tx-form').addEventListener('submit',saveTransaction); $('payment-form').addEventListener('submit',savePayment);
  $('tx-method').addEventListener('change',sourceFields); $('tx-category').addEventListener('change',sourceFields);
  $('search').addEventListener('input',renderHistory); $('history-type').addEventListener('change',renderHistory);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-view-tx]');if(b)openTransaction(b.dataset.viewTx);});
  $('btn-new').addEventListener('click',()=>{resetTxForm();switchView('add');});
  $('btn-payment-tab').addEventListener('click',()=>{$('payment-form').classList.toggle('hidden');$('tx-form').classList.toggle('hidden');});
  $('btn-add-account').addEventListener('click',addAccount); $('btn-add-card').addEventListener('click',addCard);
  $('btn-save-budget').addEventListener('click',saveBudget); $('btn-add-user').addEventListener('click',addUser); $('btn-add-category').addEventListener('click',addCategory);
  $('btn-export').addEventListener('click',exportCsv); $('btn-sync').addEventListener('click',()=>loadData(true)); $('btn-logout').addEventListener('click',signOut);
  $('btn-sheet').addEventListener('click',()=>window.open(SHEET_URL,'_blank','noopener'));
  $('toggle-dark').addEventListener('change',e=>{document.body.classList.toggle('dark',e.target.checked);localStorage.setItem('jamshi-dark',e.target.checked?'1':'0');});
  $('btn-print').addEventListener('click',()=>window.print());
  $('tx-date').value=today(); $('payment-date').value=today();
  if(localStorage.getItem('jamshi-dark')==='1'){$('toggle-dark').checked=true;document.body.classList.add('dark');}
}

document.addEventListener('DOMContentLoaded',()=>{
  bindEvents(); showGate();
  if(window.google?.accounts?.oauth2) initGoogleIdentity();
  else window.addEventListener('load',initGoogleIdentity,{once:true});
});


/* ===== Jamshi Solution – v2 upgrade layer (overrides earlier functions above) ===== */
'use strict';
const UX = {
  icons: {food:'🍽️',grocer:'🛒',fuel:'⛽',transport:'🚗',car:'🚗',bill:'🧾',rent:'🏠',shop:'🛍️',health:'💊',medic:'💊',entertain:'🎬',educat:'🎓',travel:'✈️',family:'👨‍👩‍👧',gift:'🎁',salary:'💼',overtime:'⏱️',bonus:'🎉',mobile:'📱',internet:'🌐',income:'💰',other:'🏷️'},
  subs: {food:['Restaurant','Coffee','Takeaway'],grocer:['Supermarket','Vegetables','Meat'],fuel:['Petrol','Diesel','Car wash'],transport:['Taxi','Metro','Parking','Maintenance'],bill:['Electricity','Water','Mobile','Internet'],shop:['Clothes','Electronics','Home'],health:['Doctor','Pharmacy'],entertain:['Movies','Games','Outing'],salary:['Basic','Allowance']},
  exp: ['Food','Groceries','Fuel','Transport','Bills','Shopping','Health','Entertainment','Family','Other'],
  inc: ['Salary','Overtime','Bonus','Other income']
};
UX.icons = { voucher: '🎟️', loan: '🤝', ...UX.icons };
const UXS = { catOpen: true, subOpen: true, restored: false };

function catIcon(name) {
  const c = state.categories.find(x => x.name === name);
  if (c && c.icon && c.icon !== '•') return c.icon;
  const n = String(name || '').toLowerCase();
  const k = Object.keys(UX.icons).find(k => n.includes(k));
  return UX.icons[k] || '🏷️';
}
function subsFor(name) {
  const n = String(name || '').toLowerCase(), c = state.categories.find(x => x.name === name && !x.parentId) || state.categories.find(x => x.name === name);
  const own = c ? state.categories.filter(x => x.parentId && (String(x.parentId) === String(c.id) || x.parentId === c.name)).map(x => x.name) : [];
  const k = Object.keys(UX.subs).find(k => n.includes(k));
  return own.length ? own : (UX.subs[k] || []);
}

/* ---------- Add form: pickers that collapse after choosing ---------- */
function uxChips() {
  const sel = $('tx-category'); let box = $('cat-chips');
  if (!box) { box = document.createElement('div'); box.id = 'cat-chips'; box.className = 'chips'; sel.insertAdjacentElement('beforebegin', box); }
  const cur = sel.value;
  if (cur && !UXS.catOpen) {
    box.innerHTML = `<button type="button" class="chip on" data-cat="${esc(cur)}"><span>${catIcon(cur)}</span>${esc(cur)}</button><button type="button" class="chip ghost" data-change="1">Change</button>`;
  } else {
    box.innerHTML = [...sel.options].filter(o => o.value).map(o => `<button type="button" class="chip ${o.value === cur ? 'on' : ''}" data-cat="${esc(o.value)}"><span>${catIcon(o.value)}</span>${esc(o.value)}</button>`).join('');
  }
}
function uxSubs() {
  const inp = $('tx-subcategory'); let box = $('sub-chips');
  if (!box) { box = document.createElement('div'); box.id = 'sub-chips'; box.className = 'chips'; inp.insertAdjacentElement('beforebegin', box); }
  const cat = $('tx-category').value, list = subsFor(cat), cur = inp.value;
  if (!cat || !list.length) { box.innerHTML = ''; return; }
  if (cur && !UXS.subOpen) box.innerHTML = `<button type="button" class="chip on" data-subclear="1">${esc(cur)} ✕</button>`;
  else box.innerHTML = list.map(s => `<button type="button" class="chip ${cur === s ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('');
}
function uxForm() {
  const sel = $('tx-category'), cur = sel.value, type = $('tx-type').value;
  let names = state.categories.filter(c => !c.parentId && (c.type || 'expense') === type).map(c => c.name);
  if (!names.length) names = type === 'income' ? UX.inc : UX.exp;
  sel.removeAttribute('required');
  sel.innerHTML = '<option value="">Select category</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = names.includes(cur) ? cur : '';
  if (!sel.value) UXS.catOpen = true;
  sourceFields(); uxChips(); uxSubs();
}
function uxRestoreLast() {
  try {
    const L = JSON.parse(localStorage.getItem('jamshi-last') || 'null'); if (!L) return;
    if (L.method && L.method !== 'voucher') $('tx-method').value = L.method;
    if (L.acc && [...$('tx-account').options].some(o => o.value === L.acc)) $('tx-account').value = L.acc;
    if (L.card && [...$('tx-card').options].some(o => o.value === L.card)) $('tx-card').value = L.card;
    sourceFields();
  } catch (e) {}
}
function resetTxForm() {
  $('tx-form').reset(); $('tx-date').value = today(); $('tx-edit-id').value = ''; state.editId = null;
  $('tx-form-title').textContent = 'New transaction';
  UXS.catOpen = true; UXS.subOpen = true; if ($('ux-more')) $('ux-more').open = false;
  uxForm(); uxRestoreLast();
}
function renderSelects() {
  const ids = ['tx-account', 'tx-card', 'budget-category', 'payment-card', 'payment-account'], keep = ids.map(i => [i, $(i).value]);
  const parents = state.categories.filter(c => !c.parentId && (!c.type || c.type === 'expense'));
  const accOpts = state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  uxRebuildTxAccount();
  $('tx-card').innerHTML = state.cards.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (•••• ${esc(c.last4 || '')})</option>`).join('');
  $('budget-category').innerHTML = parents.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('payment-card').innerHTML = state.cards.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('payment-account').innerHTML = accOpts;
  keep.forEach(([i, v]) => { if (v && [...$(i).options].some(o => o.value === v)) $(i).value = v; });
}
function renderAll() {
  $('user-label').textContent = `${state.user?.name || ''}${isAdmin() ? ' · Admin' : ''}`;
  $('admin-only').classList.toggle('hidden', !isAdmin());
  document.querySelectorAll('.admin-action').forEach(el => el.classList.toggle('hidden', !isAdmin()));
  renderDashboard(); renderHistory(); renderAccounts(); renderLoans(); renderPayments(); renderInstallments(); renderVouchers(); uxMethodOptions(); renderUpcoming(); uxHeroInst(); renderSelects(); renderBudgets(); renderAdmin(); uxSettingsUI(); uxForm();
  if (!UXS.restored && state.accounts.length) { uxRestoreLast(); UXS.restored = true; }
}

/* ---------- Rows & dashboard ---------- */
function txRow(t) {
  const inc = t.type === 'income';
  return `<div class="tx-row" data-view-tx="${esc(t.id)}"><div class="tx-icon">${catIcon(t.category)}</div><div class="tx-main"><b>${esc(t.category || t.type)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}</b><small>${esc(String(t.date).slice(0, 10))} · ${esc(t.product || t.note || '')}${t.receiptUrl ? ' · 📎' : ''}${isVoucherPay(t) ? ' · not counted as expense' : (!t.cardId && uxIsVoucherAccId(t.accountId) ? ' · 🎟️ voucher' : '')}</small></div><strong class="${t.type}">${inc ? '+' : '−'}${money(t.amount)}</strong></div>`;
}
function renderDashboard() {
  const cash = uxCash();
  const debt = state.cards.reduce((s, c) => s + Math.max(0, num(c.balance)), 0);
  const P = uxPeriod(UXM.offset), recent = state.transactions.filter(t => inPeriod(t, P) && !isLoanTx(t) && !isVoucherPay(t));
  const LS = uxLoans(), loanOwe = LS.owe.reduce((s, p) => s + Math.max(0, p.total), 0), loanLent = LS.lent.reduce((s, p) => s + Math.max(0, p.total), 0);
  const income = recent.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = recent.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  $('net-worth').textContent = money(cash + uxVoucherTotal() - debt - loanOwe + loanLent - uxInstRemaining());
  let ls = $('loan-stat'); if (!ls) { ls = document.createElement('span'); ls.id = 'loan-stat'; document.querySelector('.hero-stats').appendChild(ls); }
  ls.innerHTML = `Loans (net) <b>${loanLent - loanOwe < 0 ? '−' : ''}${money(Math.abs(loanLent - loanOwe))}</b>`; $('cash-total').textContent = money(cash); $('debt-total').textContent = money(debt);
  $('income-total').textContent = money(income); $('expense-total').textContent = money(expense); $('saved-total').textContent = money(income - expense);
  $('dashboard-cards').innerHTML = state.cards.length ? state.cards.map(c => {
    const owed = Math.max(0, num(c.balance)), lim = num(c.limit), avail = Math.max(0, lim - owed);
    const pct = lim > 0 ? Math.min(100, owed / lim * 100) : 0;
    const ow = userName(c.owner), owner = ow === '—' ? (c.owner || '') : ow;
    return `<article class="credit-card" style="--card-color:${esc(c.color || '#334155')}"><div class="card-top"><span>💳 ${esc(c.name)}</span><span>•••• ${esc(c.last4 || '')}</span></div><div class="card-balance ${owed > 0 ? 'liability' : ''}">${owed > 0 ? '−' : ''}${money(owed)}</div><small>You owe · ${esc(owner)}</small><div class="bar"><i style="width:${pct}%"></i></div><div class="card-limit">Available ${money(avail)} of ${money(lim)}${uxDue(c)}</div>${owed > 0 ? `<button class="card-pay" type="button" data-pay="${esc(c.id)}">💳 Pay card</button>` : ''}</article>`;
  }).join('') : '<p class="empty">No credit cards added yet.</p>';
  const groups = {}; recent.filter(t => t.type === 'expense').forEach(t => { const k = t.category || 'Other'; groups[k] = (groups[k] || 0) + t.amount; });
  const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const month = {};
  state.transactions.filter(t => t.type === 'expense' && !isLoanTx(t) && !isVoucherPay(t) && inPeriod(t, P)).forEach(t => { month[t.category] = (month[t.category] || 0) + t.amount; });
  const rows = top.map(([k, v]) => `<div class="summary-row"><span>${catIcon(k)} ${esc(k)}</span><b>${money(v)}</b></div>`).join('');
  const buds = state.budgets.filter(b => !String(b.category).startsWith('__')).map(b => {
    const sp = month[b.category] || 0, amt = num(b.amount), pct = amt > 0 ? Math.min(100, sp / amt * 100) : 0;
    return `<div class="bud"><div class="summary-row"><span>${catIcon(b.category)} ${esc(b.category)} budget</span><b>${money(sp)} / ${money(amt)}</b></div><div class="bar ${sp > amt ? 'over' : ''}"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  $('category-summary').innerHTML = (rows || '<p class="empty">No expenses in the last 30 days.</p>') + (buds ? '<h3 class="mini-title">Budgets this period</h3>' + buds : '');
  uxDashPeriodUI(P);
  $('recent-list').innerHTML = state.transactions.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map(txRow).join('') || '<p class="empty">No transactions yet.</p>';
}

/* ---------- Fast saving: update the screen first, sync in background ---------- */
function uxApply(type, amount, accId, cardId, mult) {
  const a = num(amount) * mult;
  const acc = id => state.accounts.find(x => x.id === String(id)), card = id => state.cards.find(x => x.id === String(id));
  if (type === 'expense') {
    if (cardId) { const c = card(cardId); if (c) c.balance = num(c.balance) + a; }
    else if (accId) { const x = acc(accId); if (x) x.balance = num(x.balance) - a; }
  } else if (type === 'income' && accId) { const x = acc(accId); if (x) x.balance = num(x.balance) + a; }
}
async function uxSync() {
  try {
    const r = await api('getData', { version: null }), d = r.data || {};
    state.user = r.user; state.version = r.version;
    state.transactions = (d.TX || []).map(normalizeTx); state.accounts = (d.ACC || []).map(normalizeAccount); state.cards = (d.CARD || []).map(normalizeCard);
    state.payments = d.PAY || []; state.fuel = d.FUEL || []; state.categories = d.CAT || []; state.users = d.USER || []; state.budgets = d.BUDGET || [];
    renderAll();
  } catch (e) { setStatus(false); }
}
async function uxUpload(file) {
  let blob = file, name = file.name || 'receipt.jpg';
  try {
    if (String(file.type).startsWith('image/')) {
      const bmp = await createImageBitmap(file), s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.72));
      if (b) { blob = b; name = name.replace(/\.\w+$/, '') + '.jpg'; }
    }
  } catch (e) { blob = file; }
  if (blob.size > 8 * 1024 * 1024) throw new Error('Receipt image must be smaller than 8 MB.');
  const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const up = await api('uploadReceipt', { data: { base64, mimeType: blob.type || 'application/octet-stream', name } });
  return up.url || '';
}
async function saveTransaction(ev) {
  ev.preventDefault();
  const amount = num($('tx-amount').value), type = $('tx-type').value, method = $('tx-method').value;
  if (amount <= 0) return toast('Enter an amount greater than zero.', 'error');
  const data = { date: $('tx-date').value, type, amount, category: $('tx-category').value, subcategory: $('tx-subcategory').value, product: $('tx-product').value.trim(), note: $('tx-note').value.trim(), accountId: (method === 'account' || method === 'voucher') ? $('tx-account').value : '', cardId: method === 'card' ? $('tx-card').value : '', isPrivate: $('tx-private').checked };
  if (!data.category) return toast('Choose a category.', 'error');
  if (((method === 'account' || method === 'voucher') && !data.accountId) || (method === 'card' && !data.cardId)) return toast('Select an account or card.', 'error');
  if (method === 'voucher' && type === 'expense') { const va = state.accounts.find(a => a.id === data.accountId); if (va && amount > num(va.balance) + 0.005) return toast('Not enough voucher balance (' + money(va.balance) + ' left).', 'error'); }
  const editId = $('tx-edit-id').value, file = $('tx-receipt').files?.[0] || null;
  const isFuel = !editId && type === 'expense' && data.category.toLowerCase() === 'fuel';
  const fuel = isFuel ? { vehicle: $('fuel-vehicle').value.trim(), odometer: num($('fuel-odometer').value), liters: num($('fuel-liters').value), pricePerLiter: num($('fuel-price').value), fullTank: $('fuel-full').checked } : null;
  try { localStorage.setItem('jamshi-last', JSON.stringify({ method, acc: $('tx-account').value, card: $('tx-card').value })); } catch (e) {}
  const txId = editId || uid();
  if (editId) {
    const old = state.transactions.find(t => t.id === editId);
    if (old) { uxApply(old.type, old.amount, old.accountId, old.cardId, -1); Object.assign(old, normalizeTx({ ...old, ...data })); }
  } else state.transactions.unshift(normalizeTx({ ...data, id: txId, userId: state.user?.id }));
  uxApply(type, amount, data.accountId, data.cardId, 1);
  resetTxForm(); renderAll(); switchView('dashboard'); toast('Saved ✓', 'success');
  try {
    if (editId) await api('updateTx', { id: editId, data });
    else if (isFuel) {
      let url = '';
      if (file) { try { url = await uxUpload(file); } catch (e) { toast('Receipt upload failed – saved without it.', 'error'); } }
      await api('addFuel', { data: { id: uid(), date: data.date, total: amount, ...fuel, accountId: data.accountId, cardId: data.cardId, note: data.note, receiptUrl: url } });
    } else await api('addTx', { data: { ...data, id: txId } });
    if (file && !isFuel) {
      try { const url = await uxUpload(file); await api('updateTx', { id: txId, data: { ...data, receiptUrl: url } }); }
      catch (e) { toast('Saved, but receipt failed: ' + e.message, 'error'); }
    }
  } catch (e) { toast('Not saved: ' + e.message, 'error'); }
  uxSync();
}
async function savePayment(ev) {
  ev.preventDefault();
  const data = { id: uid(), date: $('payment-date').value, cardId: $('payment-card').value, accountId: $('payment-account').value, amount: num($('payment-amount').value), note: $('payment-note').value };
  if (!data.cardId || !data.accountId || data.amount <= 0) return toast('Complete all payment details.', 'error');
  const c = state.cards.find(x => x.id === String(data.cardId)), a = state.accounts.find(x => x.id === String(data.accountId));
  if (c) c.balance = num(c.balance) - data.amount; if (a) a.balance = num(a.balance) - data.amount;
  $('payment-form').reset(); $('payment-date').value = today(); renderAll(); toast('Payment recorded ✓', 'success');
  try { await api('addPayment', { data }); } catch (e) { toast('Payment not saved: ' + e.message, 'error'); }
  uxSync();
}

/* ---------- Bottom sheet ---------- */
function openTransaction(id) {
  const tx = state.transactions.find(t => t.id === id); if (!tx) return;
  let s = $('sheet'); if (!s) { s = document.createElement('div'); s.id = 'sheet'; document.body.appendChild(s); }
  const can = canEdit(tx), inc = tx.type === 'income';
  s.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-box"><div class="sheet-ic">${catIcon(tx.category)}</div><h3>${esc(tx.category)}${tx.subcategory ? ' · ' + esc(tx.subcategory) : ''}</h3><div class="sheet-amt ${tx.type}">${inc ? '+' : '−'}${money(tx.amount)}</div><p>${esc(String(tx.date).slice(0, 10))}<br>${esc(tx.product || tx.note || '')}</p><div class="sheet-btns">${tx.receiptUrl ? '<button data-act="receipt">📎 Receipt</button>' : ''}${can ? '<button data-act="edit">✏️ Edit</button><button class="del" data-act="delete">🗑️ Delete</button>' : ''}<button data-close>Close</button></div></div>`;
  s.className = 'open';
  const close = () => { s.className = ''; };
  s.onclick = async e => {
    if (e.target.closest('[data-close]')) return close();
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'receipt') return void window.open(tx.receiptUrl, '_blank', 'noopener');
    if (a === 'delete') {
      if (!confirm('Delete this transaction permanently?')) return;
      close(); uxApply(tx.type, tx.amount, tx.accountId, tx.cardId, -1);
      state.transactions = state.transactions.filter(t => t.id !== id); renderAll(); toast('Deleted ✓', 'success');
      try { await api('deleteTx', { id }); } catch (err) { toast('Not deleted: ' + err.message, 'error'); }
      uxSync();
    }
    if (a === 'edit') {
      close(); $('tx-edit-id').value = tx.id; $('tx-type').value = tx.type; uxForm();
      const sel = $('tx-category');
      if (![...sel.options].some(o => o.value === tx.category)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(tx.category)}">${esc(tx.category)}</option>`);
      sel.value = tx.category;
      $('tx-date').value = String(tx.date).slice(0, 10); $('tx-amount').value = tx.amount;
      $('tx-subcategory').value = tx.subcategory || ''; $('tx-product').value = tx.product || ''; $('tx-note').value = tx.note || '';
      $('tx-private').checked = tx.isPrivate; const vAcc = !tx.cardId && uxIsVoucherAccId(tx.accountId); uxMethodOptions(vAcc); $('tx-method').value = tx.cardId ? 'card' : (vAcc ? 'voucher' : 'account'); sourceFields();
      if (tx.cardId) $('tx-card').value = tx.cardId; else $('tx-account').value = tx.accountId;
      $('ux-more').open = !!(tx.product || tx.note || tx.receiptUrl || tx.isPrivate);
      UXS.catOpen = false; UXS.subOpen = !tx.subcategory; uxChips(); uxSubs();
      $('tx-form-title').textContent = 'Edit transaction'; switchView('add');
    }
  };
}
async function addCard() {
  if (!isAdmin()) return toast('Administrator access required.', 'error');
  const name = prompt('Credit card name:'); if (!name) return;
  const last4 = (prompt('Last 4 digits (optional):') || '').slice(-4), limit = Number(prompt('Credit limit (QR):', '0'));
  const balance = Number(prompt('Amount currently OWED on the card (QR, positive number):', '0'));
  if (!Number.isFinite(limit) || !Number.isFinite(balance)) return toast('Invalid card values.', 'error');
  try { await api('addCard', { data: { id: uid(), name, last4, owner: state.user.id || state.user.name, limit, balance: Math.abs(balance), dueDay: 15, color: '#334155' } }); await loadData(true); toast('Credit card added.', 'success'); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Wiring ---------- */
document.addEventListener('click', e => {
  const c = e.target.closest('[data-cat]');
  if (c) {
    if (!UXS.catOpen && c.dataset.cat === $('tx-category').value) { UXS.catOpen = true; uxChips(); return; }
    $('tx-category').value = c.dataset.cat; $('tx-subcategory').value = ''; UXS.catOpen = false; UXS.subOpen = true;
    sourceFields(); uxChips(); uxSubs(); return;
  }
  if (e.target.closest('[data-change]')) { UXS.catOpen = true; uxChips(); return; }
  const s = e.target.closest('[data-sub]');
  if (s) { $('tx-subcategory').value = s.dataset.sub; UXS.subOpen = false; uxSubs(); return; }
  if (e.target.closest('[data-subclear]')) { $('tx-subcategory').value = ''; UXS.subOpen = true; uxSubs(); }
});
(function arrangeForm() {
  const form = $('tx-form'), amountField = $('tx-amount').closest('.field');
  form.insertBefore(amountField, form.firstChild);
  $('tx-amount').setAttribute('inputmode', 'decimal');
  const det = document.createElement('details'); det.className = 'more'; det.id = 'ux-more';
  det.innerHTML = '<summary>➕ More details (product, note, receipt, private)</summary>';
  ['tx-product', 'tx-note', 'tx-receipt'].forEach(i => det.appendChild($(i).closest('.field')));
  det.appendChild($('tx-private').closest('label'));
  $('fuel-extra').after(det);
})();
$('tx-type').addEventListener('change', () => { UXS.catOpen = true; $('tx-subcategory').value = ''; uxForm(); });
$('tx-subcategory').addEventListener('input', () => { UXS.subOpen = true; uxSubs(); });

/* ---------- Update app button (refreshes cached files, then reloads) ---------- */
async function uxUpdateApp() {
  toast('Updating app…');
  try {
    const files = ['./', ...[...document.querySelectorAll('link[rel=stylesheet][href],script[src]')].map(e => e.getAttribute('href') || e.getAttribute('src')).filter(u => u && !/^https?:/.test(u))];
    await Promise.all(files.map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
  } catch (e) {}
  location.reload();
}
$('btn-update').addEventListener('click', uxUpdateApp);

/* ---------- Stay signed in (no forced consent screen, remember session) ---------- */
const AUTH_KEY = 'jamshi-auth';
function uxSaveAuth() { try { localStorage.setItem(AUTH_KEY, JSON.stringify({ t: state.accessToken, e: state.tokenExpiry })); } catch (e) {} }
function initGoogleIdentity() {
  if (!window.google?.accounts?.oauth2) { $('login-message').textContent = 'Google sign-in is loading. Refresh this page in a moment.'; return; }
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'openid email profile',
    callback: async r => {
      if (r.error || !r.access_token) { showGate('Google sign-in was not completed. Please try again.'); return; }
      state.accessToken = r.access_token;
      state.tokenExpiry = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
      uxSaveAuth(); await loadData(true);
    }
  });
}
function signIn() {
  if (!state.tokenClient) initGoogleIdentity();
  if (!state.tokenClient) { toast('Google sign-in is not ready. Refresh the page.', 'error'); return; }
  state.tokenClient.requestAccessToken({ prompt: '' });
}
function signOut() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  state.accessToken = null; state.user = null; state.version = null; showGate('You have signed out. Sign in to continue.');
}
document.addEventListener('DOMContentLoaded', () => {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (a && a.t && a.e > Date.now()) { state.accessToken = a.t; state.tokenExpiry = a.e; showApp(); loadData(true); }
  } catch (e) {}
});


/* ---------- Loans: borrowed & lent money (stored as normal transactions, so it syncs & updates balances) ---------- */
function isLoanTx(t) { return /^Loan (Borrowed|Repayment|Given|Received Back)$/.test(t.category); }
function daysBetween(a, b) { return Math.max(0, (new Date(String(b).slice(0, 10)) - new Date(String(a).slice(0, 10))) / 864e5); }
function uxLoans() {
  const people = {}, res = { owe: [], lent: [] };
  state.transactions.filter(isLoanTx).forEach(t => {
    const dir = (t.category === 'Loan Borrowed' || t.category === 'Loan Repayment') ? 'borrow' : 'lend', name = t.subcategory || 'Unknown', k = dir + '|' + name;
    (people[k] = people[k] || { dir, name, ev: [] }).ev.push(t);
  });
  Object.values(people).forEach(p => {
    const ev = p.ev.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const lots = []; let principal = 0, repaid = 0, interest = 0, over = 0;
    ev.forEach(t => {
      if (t.category === 'Loan Borrowed' || t.category === 'Loan Given') {
        const m = /([\d.]+)\s*%/.exec(t.product || '');
        lots.push({ rem: t.amount, rate: m ? parseFloat(m[1]) : 0, date: t.date }); principal += t.amount;
      } else {
        repaid += t.amount; let a = t.amount;
        while (a > 0 && lots.length) {
          const l = lots[0], pay = Math.min(a, l.rem);
          interest += pay * l.rate / 100 * daysBetween(l.date, t.date) / 365; l.rem -= pay; a -= pay;
          if (l.rem <= 0.005) lots.shift();
        }
        over += a;
      }
    });
    lots.forEach(l => { interest += l.rem * l.rate / 100 * daysBetween(l.date, today()) / 365; });
    p.principal = principal; p.repaid = repaid; p.interest = interest;
    p.outstanding = lots.reduce((s, l) => s + l.rem, 0); p.total = p.outstanding + interest - over; p.ev = ev.reverse();
    (p.dir === 'borrow' ? res.owe : res.lent).push(p);
  });
  return res;
}
function uxSheet(html, handler) {
  let s = $('sheet'); if (!s) { s = document.createElement('div'); s.id = 'sheet'; document.body.appendChild(s); }
  s.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-box">${html}</div>`; s.className = 'open';
  const close = () => { s.className = ''; };
  s.onclick = e => { if (e.target.closest('[data-close]')) return close(); if (handler) handler(e, close); };
}
function renderLoans() {
  let box = $('loans-box');
  if (!box) {
    box = document.createElement('div'); box.id = 'loans-box'; $('view-accounts').appendChild(box);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-loan]'); if (b) return uxLoanForm(b.dataset.loan);
      const p = e.target.closest('[data-person]'); if (p) uxLoanDetail(p.dataset.person);
    });
  }
  const L = uxLoans(), sum = a => a.reduce((s, p) => s + Math.max(0, p.total), 0);
  const rows = [...L.owe, ...L.lent].sort((a, b) => b.total - a.total).map(p => {
    const b = p.dir === 'borrow', settled = p.total < 0.005;
    return `<div class="account-row" data-person="${esc(p.dir + '|' + p.name)}"><div><b>${b ? '⬇️' : '⬆️'} ${esc(p.name)}</b><small>${b ? 'Borrowed' : 'Lent'} ${money(p.principal)} · ${b ? 'Repaid' : 'Received'} ${money(p.repaid)}${p.interest > 0.005 ? ' · Interest ' + money(p.interest) : ''}</small></div><strong class="${settled ? '' : (b ? 'neg' : 'pos')}">${settled ? '✅ Settled' : money(p.total)}</strong></div>`;
  }).join('');
  box.innerHTML = `<div class="section-heading"><h2>🤝 Loans</h2></div><div class="loan-sum"><div><small>You owe</small><b class="neg">${money(sum(L.owe))}</b></div><div><small>Owed to you</small><b class="pos">${money(sum(L.lent))}</b></div></div><div class="loan-btns"><button class="secondary" data-loan="borrow">＋ Borrowed money</button><button class="secondary" data-loan="lend">＋ Lent money</button></div><section class="panel">${rows || '<p class="empty">No loans yet. Tap a button above to add one.</p>'}</section>`;
}
function uxLoanDetail(key) {
  const L = uxLoans(), p = [...L.owe, ...L.lent].find(x => x.dir + '|' + x.name === key); if (!p) return;
  const b = p.dir === 'borrow';
  const hist = p.ev.map(t => { const start = t.category === 'Loan Borrowed' || t.category === 'Loan Given'; return `<div class="lh"><span>${start ? (b ? 'Borrowed' : 'Lent') : (b ? 'Repaid' : 'Received back')}<small>${esc(String(t.date).slice(0, 10))}${t.product ? ' · ' + esc(t.product) : ''}${t.note ? ' · ' + esc(t.note) : ''}</small></span><b>${money(t.amount)}</b></div>`; }).join('');
  uxSheet(`<div class="sheet-ic">${b ? '⬇️' : '⬆️'}</div><h3>${esc(p.name)}</h3><div class="sheet-amt ${b ? 'expense' : 'income'}">${money(Math.max(0, p.total))}</div><p>${b ? 'You owe' : 'Owes you'} · principal left ${money(p.outstanding)}${p.interest > 0.005 ? ' + interest ' + money(p.interest) + ' (estimate)' : ''}</p><div class="sheet-btns"><button data-do="${b ? 'repay' : 'recv'}">${b ? '💸 Repay' : '💰 Received back'}</button><button data-do="${b ? 'borrow' : 'lend'}">${b ? '＋ Borrow more' : '＋ Lend more'}</button><button data-close>Close</button></div><h4 class="mini-title">History</h4>${hist}`,
    (e, close) => { const d = e.target.closest('[data-do]')?.dataset.do; if (d) { close(); uxLoanForm(d, p.name); } });
}
function uxLoanForm(mode, name = '') {
  if (!state.accounts.length) return toast('Add a cash/bank account first.', 'error');
  const M = { borrow: ['Borrowed money', 'income', 'Loan Borrowed'], repay: ['Repay loan', 'expense', 'Loan Repayment'], lend: ['Lent money', 'expense', 'Loan Given'], recv: ['Money received back', 'income', 'Loan Received Back'] }[mode];
  const dir = (mode === 'borrow' || mode === 'repay') ? 'borrow' : 'lend', withRate = mode === 'borrow' || mode === 'lend';
  const L = uxLoans(), names = (dir === 'borrow' ? L.owe : L.lent).map(p => `<option value="${esc(p.name)}">`).join('');
  uxSheet(`<h3>${M[0]}</h3><div class="lf"><label>Person</label><input id="lf-name" list="lf-names" value="${esc(name)}" placeholder="Name"><datalist id="lf-names">${names}</datalist></div><div class="lf"><label>Amount (QR)</label><input id="lf-amt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></div><div class="lf"><label>Date</label><input id="lf-date" type="date" value="${today()}"></div><div class="lf"><label>${M[1] === 'income' ? 'Money goes into' : 'Paid from'}</label><select id="lf-acc">${uxCashAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('')}</select></div>${withRate ? '<div class="lf"><label>Interest % per year (optional)</label><input id="lf-rate" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"></div>' : ''}<div class="lf"><label>Note (optional)</label><input id="lf-note"></div><div class="sheet-btns"><button data-save="1" class="save-btn">Save</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      if (!e.target.closest('[data-save]')) return;
      const nm = $('lf-name').value.trim(), amt = num($('lf-amt').value), acc = $('lf-acc').value, rate = withRate ? num($('lf-rate').value) : 0;
      if (!nm) return toast("Enter the person's name.", 'error');
      if (amt <= 0) return toast('Enter an amount greater than zero.', 'error');
      const data = { date: $('lf-date').value || today(), type: M[1], amount: amt, category: M[2], subcategory: nm, product: rate > 0 ? rate + '% p.a.' : '', note: $('lf-note').value.trim(), accountId: acc, cardId: '', isPrivate: false };
      close(); const id = uid();
      state.transactions.unshift(normalizeTx({ ...data, id, userId: state.user?.id })); uxApply(data.type, amt, acc, '', 1);
      renderAll(); toast('Saved ✓', 'success');
      try { await api('addTx', { data: { ...data, id } }); } catch (err) { toast('Not saved: ' + err.message, 'error'); }
      uxSync();
    });
}

/* ===== Big built-in category catalog (emoji) + add your own + full History ===== */
const UXRAW = {
  expense: [
    'Food & Dining 🍔|Groceries 🛒;Restaurants 🍽️;Fast Food 🍟;Coffee ☕;Tea 🍵;Delivery 🛵;Bakery 🥖;Snacks 🍿;Juice & Drinks 🧃;Water 💧;Fruits 🍎;Vegetables 🥦;Meat & Fish 🥩;Dairy & Eggs 🥛;Rice & Grains 🌾;Sweets & Dessert 🍰;Office Lunch 🍱',
    'Fuel ⛽|Petrol ⛽;Diesel 🛢️;Premium Fuel 🌟;Car Wash 🚿',
    'Transportation 🚗|Public Transit 🚇;Taxi / Uber / Careem 🚕;Parking 🅿️;Car Maintenance 🔧;Car Insurance 🛡️;Car Registration 📋;Traffic Fines 🚨;Tolls 🛣️;Tyres 🛞;Oil Change 🛢️;Car Battery 🔋;Car Accessories 🚘',
    'Housing 🏠|Rent 🔑;Electricity ⚡;Water 💧;Internet 📶;Phone Bill 📞;Maintenance 🔨;Home Goods 🛋️;Furniture 🪑;Cleaning Supplies 🧽;Gas Cylinder 🔥;AC Service ❄️;Plumbing 🚰;Electrician 💡;Laundry 🧺;Security Deposit 🔐',
    'Shopping 🛍️|Clothing 👕;Shoes 👟;Electronics 💻;Mobile & Gadgets 📱;Accessories ⌚;Books 📖;Gifts 🎁;Sports Equipment ⚽;Online Shopping 📦;Perfume 🌸;Bags 👜;Stationery ✏️;Kitchenware 🍳;Jewellery 💍',
    'Entertainment 🎬|Movies 🎥;Streaming 📺;Games 🎮;Events 🎟️;Hobbies 🎨;Malls / Outings 🏬;Music 🎵;Theme Park 🎢;Cafe & Shisha 💨;Bowling 🎳;Camping 🏕️',
    'Health 💊|Doctor 👨‍⚕️;Hospital 🏥;Pharmacy 💊;Dental 🦷;Health Insurance 🛡️;Gym / Fitness 💪;Eye Care 👓;Lab Tests 🧪;Vitamins 🍊;Physiotherapy 🦴;Mental Health 🧠;Medical Equipment 🩺',
    'Education 📚|Tuition 🎓;Books & Supplies 📖;Courses 💻;School Fees 🏫;School Uniform 👔;School Transport 🚌;Exam Fees 📝;Online Learning 🖥️;Language Classes 🗣️',
    'Kids 👶|Kids Clothing 👕;Toys 🧸;Kids Activities 🎨;Babysitter 👩‍🍼;Diapers / Formula 🍼;Pocket Money 🪙;Kids Medical 🩹;Birthday Party 🎂;School Bag 🎒',
    'Travel ✈️|Flights ✈️;Hotels 🏨;Visa / Passport 🛂;Travel Activities 🎢;Baggage 🧳;Travel Insurance 🛡️;Airport Transfer 🚖;Food while Travelling 🥘;Souvenirs 🛍️;Excess Baggage ⚖️',
    'Bills & Subscriptions 📄|Electricity Bill ⚡;Water Bill 💧;Gas 🔥;Subscriptions 📱;Insurance 🛡️;Government Fees 🏛️;Mobile Recharge 📲;Internet Bill 📶;TV / Cable 📡;Cloud & Apps ☁️;Bank Charges 🏦;Annual Fees 🗓️',
    'Family & Remittance 👪|Money Transfer Home 🌍;Exchange Fees 💱;Parents Support 👵;Spouse 💞;Siblings 👫;Relatives Help 🤝;Wedding Contribution 💒;Home Country Expenses 🏡',
    'Domestic Help 🧹|Maid 🧹;Driver 🚗;Cook 👨‍🍳;Gardener 🌿;Nanny 👩‍🍼;Part-time Cleaner 🧼',
    'Charity ❤️|Sadaqah 🤲;Zakat 🕌;Donations 🎁;Masjid Contribution 🕋;Orphan Support 🧒;Eid Gifts 🌙',
    'Personal Care 💄|Haircut 💇;Spa / Massage 💆;Cosmetics 💅;Skincare 🧴;Salon 💈;Toiletries 🧼;Perfume & Oud 🪔',
    'Pets 🐾|Pet Food 🦴;Vet 🩺;Pet Grooming 🛁;Pet Supplies 🐕',
    'Home Improvement 🛠️|Paint 🎨;Tools 🔧;Renovation 🏗️;Decor 🖼️;Curtains 🪟;Appliances 📺;Garden 🌱;Lighting 💡',
    'Work & Business 💼|Office Supplies 📎;Work Tools 🧰;Work Uniform 🦺;Licences & Fees 📜;Business Travel 🧳;Client Meals 🍽️;Software 💻;Advertising 📢;Professional Courses 🎓',
    'Insurance & Legal ⚖️|Life Insurance 🛡️;Home Insurance 🏠;Legal Fees ⚖️;Attestation / Notary 📜;Translation 🌐;Residence Permit 🪪;Medical Card 🩺',
    'Savings & Investments 💰|Emergency Fund 🚨;Gold 🥇;Stocks 📈;Mutual Funds 📊;Fixed Deposit 🏦;Crypto ₿;Retirement 🌴;Chit / Society ⭕',
    'Loans & EMI 🏦|Personal Loan 💳;Car Loan 🚗;Home Loan 🏠;Credit Card Payment 💳;Education Loan 🎓;Interest & Charges 🧾',
    'Festivals & Events 🎉|Eid 🌙;Birthday 🎂;Wedding 💒;Anniversary 💞;Ramadan 🕌;Party 🥳;Gifts Given 🎁',
    'Technology 💻|Mobile 📱;Laptop 💻;Headphones & Accessories 🎧;Repairs 🔧;Apps & Software 🧩;Network Devices 📡',
    'Sports & Hobbies ⚽|Football ⚽;Cricket 🏏;Gym Equipment 🏋️;Swimming 🏊;Fishing 🎣;Photography 📷;Cycling 🚴;Desert Trips 🏜️',
    'Fines & Penalties 🚨|Traffic Fine 🚦;Late Fee ⏰;Visa / Residency Fine 🛂;Other Fine 📃',
    'Other 📌|Miscellaneous ❓;Emergency 🚨;Bank Fees 🏦;Lost / Stolen 😞;Tips 💵;Unknown 🔍'
  ],
  income: [
    'Salary 💼|Base Salary 💵;Bonus 🎁;Overtime ⏰;End of Service 🏁;Allowance 🍱;Commission 🤝;Leave Salary 🏖️;Ticket Allowance ✈️;Housing Allowance 🏠;Incentive 🏆',
    'Business 🏢|Sales 💰;Consulting 💼;Freelance 💻;Side Hustle 🧩;Online Selling 📦;Services 🛠️',
    'Investments 📈|Dividends 📊;Interest 💹;Capital Gains 📈;Stocks 📉;Mutual Fund Returns 📊;Gold Profit 🥇;Crypto Profit ₿;Fixed Deposit Interest 🏦',
    'Rental Income 🏘️|Property Rent 🏠;Room Rent 🛏️;Car Rent 🚗;Parking Rent 🅿️',
    'Gifts 🎁|Cash Gift 💵;Eid Gift 🌙;Inheritance 📜;Wedding Gift 💒;Family Support 👪',
    'Refunds & Cashback ↩️|Refund ↩️;Cashback 💳;Reward Points 🎯;Deposit Returned 🔐;Insurance Claim 🛡️;Fee Refund 🧾',
    'Other Income 💵|Selling Items 🏷️;Prize / Lottery 🏆;Part-time Job ⏱️;Tips Received 🪙;Government Benefit 🏛️;Money Received 📥'
  ]
};
const UXP = {};
(function () {
  const sp = x => { const i = x.lastIndexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; };
  Object.keys(UXRAW).forEach(t => { UXP[t] = UXRAW[t].map(s => { const [h, subs] = s.split('|'); const [name, icon] = sp(h); return { name, icon, subs: (subs || '').split(';').filter(Boolean).map(x => { const [n, i] = sp(x); return { name: n, icon: i }; }) }; }); });
})();
const lc = x => String(x || '').toLowerCase().trim();
function uxLocal() { try { return JSON.parse(localStorage.getItem('jamshi-cats') || '[]'); } catch (e) { return []; } }
function uxLocalAdd(c) { const a = uxLocal(); a.push(c); try { localStorage.setItem('jamshi-cats', JSON.stringify(a)); } catch (e) {} }
function uxCatList(type) {
  const out = [], seen = new Set(), add = (name, icon) => { if (!name || seen.has(lc(name))) return; seen.add(lc(name)); out.push({ name, icon: icon || '' }); };
  state.categories.filter(c => !c.parentId && (c.type || 'expense') === type).forEach(c => add(c.name, c.icon && c.icon !== '•' ? c.icon : ''));
  uxLocal().filter(c => !c.parent && c.type === type).forEach(c => add(c.name, c.icon));
  (UXP[type] || []).forEach(c => add(c.name, c.icon));
  return out;
}
function catIcon(name) {
  const n = lc(name);
  const c = state.categories.find(x => lc(x.name) === n && x.icon && x.icon !== '•'); if (c) return c.icon;
  const l = uxLocal().find(x => lc(x.name) === n && x.icon); if (l) return l.icon;
  for (const t of Object.keys(UXP)) { const k = UXP[t].find(x => lc(x.name) === n); if (k) return k.icon; }
  const key = Object.keys(UX.icons).find(k => n.includes(k)); return UX.icons[key] || '🏷️';
}
function subsFor(name) {
  const n = lc(name), out = [], seen = new Set(), add = (s, i) => { if (!s || seen.has(lc(s))) return; seen.add(lc(s)); out.push({ name: s, icon: i || '' }); };
  const ids = new Set(state.categories.filter(c => lc(c.name) === n && !c.parentId).map(p => String(p.id)));
  state.categories.filter(x => x.parentId && (ids.has(String(x.parentId)) || lc(x.parentId) === n)).forEach(x => add(x.name, x.icon && x.icon !== '•' ? x.icon : ''));
  uxLocal().filter(x => lc(x.parent) === n).forEach(x => add(x.name, x.icon));
  Object.keys(UXP).forEach(t => UXP[t].filter(c => lc(c.name) === n).forEach(c => c.subs.forEach(s => add(s.name, s.icon))));
  return out;
}
function uxChips() {
  const sel = $('tx-category'); let box = $('cat-chips');
  if (!box) { box = document.createElement('div'); box.id = 'cat-chips'; box.className = 'chips'; sel.insertAdjacentElement('beforebegin', box); }
  const cur = sel.value;
  if (cur && !UXS.catOpen) box.innerHTML = `<button type="button" class="chip on" data-cat="${esc(cur)}"><span>${catIcon(cur)}</span>${esc(cur)}</button><button type="button" class="chip ghost" data-change="1">Change</button>`;
  else box.innerHTML = [...sel.options].filter(o => o.value).map(o => `<button type="button" class="chip ${o.value === cur ? 'on' : ''}" data-cat="${esc(o.value)}"><span>${catIcon(o.value)}</span>${esc(o.value)}</button>`).join('') + '<button type="button" class="chip ghost" data-newcat="1">＋ New category</button>';
}
function uxSubs() {
  const inp = $('tx-subcategory'); let box = $('sub-chips');
  if (!box) { box = document.createElement('div'); box.id = 'sub-chips'; box.className = 'chips'; inp.insertAdjacentElement('beforebegin', box); }
  const cat = $('tx-category').value, list = subsFor(cat), cur = inp.value;
  if (!cat) { box.innerHTML = ''; return; }
  if (cur && !UXS.subOpen) box.innerHTML = `<button type="button" class="chip on" data-subclear="1">${esc(cur)} ✕</button>`;
  else box.innerHTML = list.map(s => `<button type="button" class="chip ${cur === s.name ? 'on' : ''}" data-sub="${esc(s.name)}">${s.icon ? '<span>' + s.icon + '</span>' : ''}${esc(s.name)}</button>`).join('') + '<button type="button" class="chip ghost" data-newsub="1">＋ New sub</button>';
}
function uxForm() {
  const sel = $('tx-category'), cur = sel.value, type = $('tx-type').value, names = uxCatList(type).map(c => c.name);
  sel.removeAttribute('required');
  sel.innerHTML = '<option value="">Select category</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = names.includes(cur) ? cur : '';
  if (!sel.value) UXS.catOpen = true;
  sourceFields(); uxChips(); uxSubs();
}
function renderSelects() {
  const ids = ['tx-account', 'tx-card', 'budget-category', 'payment-card', 'payment-account'], keep = ids.map(i => [i, $(i).value]);
  uxRebuildTxAccount();
  $('tx-card').innerHTML = state.cards.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (•••• ${esc(c.last4 || '')})</option>`).join('');
  $('budget-category').innerHTML = uxCatList('expense').map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('payment-card').innerHTML = state.cards.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('payment-account').innerHTML = state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  keep.forEach(([i, v]) => { if (v && [...$(i).options].some(o => o.value === v)) $(i).value = v; });
}

/* ----- Add category / subcategory with emoji ----- */
const UX_EMOJI = '🍔 🍕 🍟 🌮 🍣 🍜 🥗 🍎 🥦 🥩 🍞 ☕ 🍵 🥤 🍰 🛒 ⛽ 🚗 🚕 🚌 🚇 ✈️ 🏨 🏠 🔑 💡 💧 🔥 📶 📞 📱 💻 🎮 🎬 🎵 📚 🎓 🏫 👶 🧸 🐾 💊 🏥 🦷 💪 ⚽ 🏏 🛍️ 👕 👟 💄 💇 🎁 🎉 💍 🕌 🤲 ❤️ 💼 💰 💵 💳 🏦 📈 🛡️ 🧾 🔧 🧹 🌿 🚿 🅿️ 🎟️ 🧳 🌍 📦 📌'.split(' ');
function uxCatForm(type, parent) {
  const opts = t => '<option value="">— None (new main category) —</option>' + uxCatList(t).map(c => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('');
  uxSheet(`<h3>${parent ? 'New subcategory' : 'New category'}</h3><div class="lf"><label>Type</label><select id="cf-type"><option value="expense">Expense</option><option value="income">Income</option></select></div><div class="lf"><label>Main category (empty = create a main category)</label><select id="cf-parent">${opts(type)}</select></div><div class="lf"><label>Name</label><input id="cf-name" placeholder="e.g. Pharmacy"></div><div class="lf"><label>Emoji (tap one or type your own)</label><input id="cf-icon" maxlength="6" placeholder="🙂"><div class="emojis">${UX_EMOJI.map(e => `<button type="button" data-emo="${e}">${e}</button>`).join('')}</div></div><div class="sheet-btns"><button data-save="1" class="save-btn">Save</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      const emo = e.target.closest('[data-emo]'); if (emo) { $('cf-icon').value = emo.dataset.emo; return; }
      if (!e.target.closest('[data-save]')) return;
      const t = $('cf-type').value, par = $('cf-parent').value, name = $('cf-name').value.trim(), icon = $('cf-icon').value.trim() || '📌';
      if (!name) return toast('Enter a name.', 'error');
      if (par ? subsFor(par).some(s => lc(s.name) === lc(name)) : uxCatList(t).some(c => lc(c.name) === lc(name))) return toast('That name already exists.', 'error');
      close();
      const pc = state.categories.find(c => lc(c.name) === lc(par) && !c.parentId);
      const row = { id: uid(), name, type: t, icon, parentId: par ? (pc ? pc.id : par) : '', color: '#64748b', sortOrder: state.categories.length + 1 };
      state.categories.push(row); renderAll();
      if ($('view-add').classList.contains('active')) {
        if (par) { $('tx-subcategory').value = name; UXS.subOpen = false; uxSubs(); }
        else if ($('tx-type').value === t) { $('tx-category').value = name; $('tx-subcategory').value = ''; UXS.catOpen = false; UXS.subOpen = true; sourceFields(); uxChips(); uxSubs(); }
      }
      toast('Added ✓', 'success');
      try { await api('addCategory', { data: row }); uxSync(); }
      catch (err) { uxLocalAdd({ name, icon, type: t, parent: par }); toast('Saved on this phone only (' + err.message + ')', 'error'); }
    });
  $('cf-type').value = type; $('cf-parent').innerHTML = opts(type); $('cf-parent').value = parent || '';
  $('cf-type').onchange = () => { $('cf-parent').innerHTML = opts($('cf-type').value); };
}
function addCategory() { uxCatForm($('tx-type') ? $('tx-type').value : 'expense', ''); }
document.addEventListener('click', e => {
  if (e.target.closest('[data-newcat]')) return uxCatForm($('tx-type').value, '');
  if (e.target.closest('[data-newsub]')) return uxCatForm($('tx-type').value, $('tx-category').value);
  if (e.target.closest('[data-more]')) { HS.limit += 60; renderHistory(); }
});

/* ----- History: everything, grouped by day, filters, show-more ----- */
const HS = { limit: 60 };
function uxMonth(m) { return new Date(m + '-01T00:00:00').toLocaleString('en', { month: 'short', year: 'numeric' }); }
function uxDay(d) {
  const t = today(), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (d === t) return 'Today'; if (d === y) return 'Yesterday';
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function uxHistInit() {
  if ($('history-month')) return;
  document.querySelector('#view-history .filters').insertAdjacentHTML('beforeend', '<select id="history-month"></select><select id="history-cat"></select>');
  ['history-month', 'history-cat', 'history-type'].forEach(i => $(i).addEventListener('change', () => { HS.limit = 60; renderHistory(); }));
  $('search').addEventListener('input', () => { HS.limit = 60; });
}
function renderHistory() {
  uxHistInit();
  const q = lc($('search').value || ''), type = $('history-type').value, mSel = $('history-month'), cSel = $('history-cat'), mCur = mSel.value, cCur = cSel.value;
  const SD = uxStartDay(), months = [...new Set([...state.transactions.map(t => String(t.date).slice(0, 10)).filter(Boolean), today()].map(d => uxPeriodOfDate(d, SD).start))].sort().reverse();
  const cats = [...new Set(state.transactions.map(t => t.category).filter(Boolean))].sort();
  mSel.innerHTML = '<option value="">All time</option>' + months.map((m, i) => `<option value="${m}">${uxPeriodLabel(uxPeriodOfDate(m, SD))}${m === uxPeriod(0).start ? ' (current)' : ''}</option>`).join('');
  cSel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${catIcon(c)} ${esc(c)}</option>`).join('');
  mSel.value = months.includes(mCur) ? mCur : ''; cSel.value = cats.includes(cCur) ? cCur : '';
  const rows = state.transactions.slice().reverse().filter(t => (type === 'all' || t.type === type) && (!mSel.value || inPeriod(t, uxPeriodOfDate(mSel.value, SD))) && (!cSel.value || t.category === cSel.value) && (!q || [t.category, t.subcategory, t.product, t.note, t.date].join(' ').toLowerCase().includes(q))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const sum = ty => rows.filter(t => t.type === ty && !isLoanTx(t)).reduce((s, t) => s + t.amount, 0);
  let html = `<div class="hist-sum"><span>${rows.length} transactions</span><span class="pos">+${money(sum('income'))}</span><span class="neg">−${money(sum('expense'))}</span></div>`, last = '';
  rows.slice(0, HS.limit).forEach(t => { const d = String(t.date).slice(0, 10); if (d !== last) { html += `<div class="day-head">${uxDay(d)}</div>`; last = d; } html += txRow(t); });
  if (rows.length > HS.limit) html += `<button class="secondary wide" data-more="1">Show more (${rows.length - HS.limit} left)</button>`;
  $('history-list').innerHTML = rows.length ? html : '<p class="empty">No matching transactions.</p>';
}

uxForm();


/* ===== Custom month start day (e.g. salary on the 25th) ===== */
const UXM = { offset: 0 };
function uxDim(y, m) { return new Date(y, m + 1, 0).getDate(); }
function uxIso(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function uxAddDays(ds, n) { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function uxStartDay() {
  const b = state.budgets.find(x => x.category === '__monthstart' && String(x.userId || '') === String(state.user?.id || ''));
  if (b && num(b.amount) >= 1) return Math.min(31, Math.round(num(b.amount)));
  let l = 1; try { l = parseInt(localStorage.getItem('jamshi-startday'), 10); } catch (e) {}
  return l >= 1 && l <= 31 ? l : 1;
}
function uxPeriodOfDate(ds, D) {
  let y = +ds.slice(0, 4), m = +ds.slice(5, 7) - 1; const d = +ds.slice(8, 10);
  if (d < Math.min(D, uxDim(y, m))) { m--; if (m < 0) { m = 11; y--; } }
  const start = uxIso(y, m, Math.min(D, uxDim(y, m)));
  let ny = y, nm = m + 1; if (nm > 11) { nm = 0; ny++; }
  return { start, end: uxAddDays(uxIso(ny, nm, Math.min(D, uxDim(ny, nm))), -1) };
}
function uxPeriod(offset) {
  const D = uxStartDay(); let p = uxPeriodOfDate(today(), D);
  for (let i = 0; i < Math.abs(offset || 0); i++) p = uxPeriodOfDate(uxAddDays(p.start, -1), D);
  return p;
}
function inPeriod(t, P) { const d = String(t.date).slice(0, 10); return d >= P.start && d <= P.end; }
function uxPeriodLabel(P) {
  const f = (ds, y) => new Date(ds + 'T00:00:00').toLocaleDateString('en', y ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
  return f(P.start) + ' – ' + f(P.end, true);
}
function uxDue(c) {
  if (num(c.balance) <= 0) return '';
  const D = parseInt(c.dueDay, 10); if (!(D >= 1 && D <= 31)) return '';
  const t = today(); let y = +t.slice(0, 4), m = +t.slice(5, 7) - 1; const d = +t.slice(8, 10), cm = m;
  let due = Math.min(D, uxDim(y, m));
  if (d > due) { m++; if (m > 11) { m = 0; y++; } due = Math.min(D, uxDim(y, m)); }
  const days = Math.round((new Date(y, m, due) - new Date(y, cm, d)) / 864e5);
  return ' · Due ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days');
}
function uxDashPeriodUI(P) {
  let bar = $('period-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'period-bar'; bar.className = 'period-bar'; document.querySelector('#view-dashboard .metric-grid').insertAdjacentElement('beforebegin', bar); }
  bar.innerHTML = `<button data-per="-1" aria-label="Previous period">‹</button><button class="per-label" data-perset="1">📅 ${uxPeriodLabel(P)}<small>${UXM.offset === 0 ? 'Current period' : 'Past period'} · month starts on day ${uxStartDay()}</small></button><button data-per="1" aria-label="Next period" ${UXM.offset >= 0 ? 'disabled' : ''}>›</button><button data-report="1" data-from="${P.start}" data-to="${P.end}" aria-label="Report">📄</button>`;
  [['income-total', 'Income'], ['expense-total', 'Spent'], ['saved-total', 'Net saved']].forEach(([id, t]) => { const el = $(id).previousElementSibling; if (el) el.textContent = t; });
  const h = $('category-summary').previousElementSibling?.querySelector('span'); if (h) h.textContent = 'This period';
}
function renderBudgets() {
  $('budget-list').innerHTML = state.budgets.filter(b => !String(b.category).startsWith('__')).map(b => `<div class="summary-row"><span>${catIcon(b.category)} ${esc(b.category)} · per period</span><b>${money(b.amount)}</b></div>`).join('') || '<p class="empty">No budgets set.</p>';
}
function uxStartDayForm() {
  uxSheet(`<h3>📅 Month starts on day</h3><p>Your month runs from this day to the day before the next one. Example: 25 gives 25 Oct – 24 Nov.</p><div class="lf"><label>Day of month (1–31)</label><input id="sd-day" type="number" inputmode="numeric" min="1" max="31" value="${uxStartDay()}"></div><div class="sheet-btns"><button data-save="1" class="save-btn">Save</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      if (!e.target.closest('[data-save]')) return;
      const d = Math.round(num($('sd-day').value)); if (d < 1 || d > 31) return toast('Enter a day from 1 to 31.', 'error');
      close(); UXM.offset = 0; HS.limit = 60;
      try { localStorage.setItem('jamshi-startday', String(d)); } catch (err) {}
      const uid_ = String(state.user?.id || ''), row = state.budgets.find(x => x.category === '__monthstart' && String(x.userId || '') === uid_);
      if (row) row.amount = d; else state.budgets.push({ id: uid(), category: '__monthstart', amount: d, period: 'monthly', userId: uid_ });
      renderAll(); toast('Saved ✓', 'success');
      try { await api('saveBudget', { data: { category: '__monthstart', amount: d, period: 'monthly' } }); } catch (err) { toast('Saved on this phone only: ' + err.message, 'error'); }
      uxSync();
    });
}
document.addEventListener('click', e => {
  const p = e.target.closest('[data-per]');
  if (p && !p.disabled) { UXM.offset = Math.min(0, UXM.offset + (+p.dataset.per === -1 ? -1 : 1)); renderDashboard(); return; }
  if (e.target.closest('[data-perset]') || e.target.closest('#btn-monthstart')) uxStartDayForm();
});



/* ===== Professional Settings page ===== */
function uxSettingsUI() {
  const u = state.user || {};
  $('set-name').textContent = u.name || '—'; $('set-role').textContent = u.role === 'admin' ? 'Administrator' : 'Member';
  const av = $('set-avatar'); av.textContent = (u.name || '?').trim().charAt(0).toUpperCase(); av.style.background = u.color || '#1769e0';
  const d = uxStartDay(), sfx = (d % 10 === 1 && d !== 11) ? 'st' : (d % 10 === 2 && d !== 12) ? 'nd' : (d % 10 === 3 && d !== 13) ? 'rd' : 'th';
  $('set-startday').textContent = d + sfx;
  const off = $('status').classList.contains('offline'), c = $('set-conn'); c.textContent = off ? '● Offline' : '● Connected'; c.classList.toggle('off', off);
}
function renderAdmin() {
  const box = $('categories-list'), open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.k));
  let mainN = 0, subN = 0;
  const tree = ['expense', 'income'].map(t => {
    const rows = uxCatList(t).map(c => {
      const subs = subsFor(c.name); mainN++; subN += subs.length;
      return `<details class="cat-item" data-k="${t}|${esc(c.name)}"><summary><span class="ci">${catIcon(c.name)}</span><b>${esc(c.name)}</b><small>${subs.length}</small></summary><div class="sub-list">${subs.map(s => `<span class="sub-pill">${s.icon ? s.icon + ' ' : ''}${esc(s.name)}</span>`).join('') || '<em>No subcategories yet</em>'}<button type="button" class="mini-add" data-addsub="${esc(c.name)}" data-addtype="${t}">＋ Add sub</button></div></details>`;
    }).join('');
    return `<h4 class="cat-type">${t === 'expense' ? '💸 Expense' : '💰 Income'}</h4>${rows}`;
  }).join('');
  box.innerHTML = `<details class="set-fold" data-k="all"><summary><span class="ico">📂</span><span class="lbl">Browse categories<small>${mainN} main · ${subN} subcategories</small></span><i>›</i></summary><div class="tree">${tree}</div></details>`;
  box.querySelectorAll('details').forEach(d => { if (open.has(d.dataset.k)) d.open = true; });
  if (!isAdmin()) return;
  $('users-list').innerHTML = state.users.map(u => `<div class="user-row"><div class="avatar sm" style="background:${esc(u.color || '#007aff')}">${esc((u.name || '?').charAt(0).toUpperCase())}</div><div class="u-main"><b>${esc(u.name)}</b><small>${esc(u.email || 'No email yet')}</small></div><span class="badge ${u.role === 'admin' ? 'adm' : ''}">${esc(u.role || 'user')}</span></div>`).join('') || '<p class="empty">No users yet.</p>';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-addsub]');
  if (b) uxCatForm(b.dataset.addtype || 'expense', b.dataset.addsub);
});


/* ===== Printable report (any date range) ===== */
const RP = { from: '', to: '', subs: true, list: false, title: '' };
const rpFmt = ds => new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const rpSigned = v => (v < 0 ? '−' : '') + money(Math.abs(v));
function uxReportData(from, to) {
  const rows = state.transactions.filter(t => { const d = String(t.date).slice(0, 10); return d >= from && d <= to; });
  const core = rows.filter(t => !isLoanTx(t) && !isVoucherPay(t));
  const agg = type => {
    const cats = {};
    core.filter(t => t.type === type).forEach(t => {
      const c = String(t.category || '').trim() || 'Uncategorised', o = cats[c] = cats[c] || { name: c, total: 0, count: 0, subs: {} };
      o.total += t.amount; o.count++;
      const sn = String(t.subcategory || '').trim();
      if (sn) { const so = o.subs[sn] = o.subs[sn] || { name: sn, total: 0, count: 0 }; so.total += t.amount; so.count++; }
    });
    return Object.values(cats).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  };
  const inc = agg('income'), exp = agg('expense'), sum = l => l.reduce((s, c) => s + c.total, 0);
  const loan = { borrowed: 0, repaid: 0, lent: 0, back: 0 };
  rows.filter(isLoanTx).forEach(t => { if (t.category === 'Loan Borrowed') loan.borrowed += t.amount; else if (t.category === 'Loan Repayment') loan.repaid += t.amount; else if (t.category === 'Loan Given') loan.lent += t.amount; else loan.back += t.amount; });
  const pays = uxPayItems().filter(p => p.date >= from && p.date <= to), payTotal = pays.reduce((s, p) => s + p.amount, 0);
  const cardMap = {}; state.cards.forEach(c => { cardMap[c.id] = { card: c, spent: 0, paid: 0 }; });
  rows.filter(t => t.type === 'expense' && t.cardId && cardMap[t.cardId]).forEach(t => { cardMap[t.cardId].spent += t.amount; });
  pays.forEach(p => { if (cardMap[p.cardId]) cardMap[p.cardId].paid += p.amount; });
  const cards = Object.values(cardMap).filter(x => x.spent > 0 || x.paid > 0), cardSpent = cards.reduce((s, x) => s + x.spent, 0);
  const plansAll = uxPlans(), vouchers = state.accounts.filter(uxIsVoucherAcc).map(a => { const spent = rows.filter(t => t.type === 'expense' && t.accountId === a.id).reduce((s, t) => s + t.amount, 0), plan = plansAll.find(p => p.accId === a.id), paidIn = plan ? plan.txs.filter(t => String(t.date).slice(0, 10) >= from && String(t.date).slice(0, 10) <= to).reduce((s, t) => s + t.amount, 0) : 0; return { acc: a, spent, plan, paidIn }; }).filter(v => v.spent > 0 || v.paidIn > 0);
  return { rows, core, inc, exp, income: sum(inc), expense: sum(exp), loan, pays, payTotal, cards, cardSpent, vouchers };
}
function rpCatTable(list, total, type) {
  const body = list.map(c => {
    const pct = total > 0 ? c.total / total * 100 : 0;
    let h = `<tr class="rp-cat"><td><span class="rp-ic">${catIcon(c.name)}</span>${esc(c.name)}<div class="rp-bar2"><i class="${type}" style="width:${pct.toFixed(1)}%"></i></div></td><td class="n">${c.count}</td><td class="n">${money(c.total)}</td><td class="n">${pct.toFixed(1)}%</td></tr>`;
    if (RP.subs) {
      const subs = Object.values(c.subs).sort((a, b) => b.total - a.total), rest = c.total - subs.reduce((s, x) => s + x.total, 0), restN = c.count - subs.reduce((s, x) => s + x.count, 0);
      const r = subs.map(x => [x.name, x.count, x.total]); if (subs.length && rest > 0.005) r.push(['No subcategory', restN, rest]);
      h += r.map(x => `<tr class="rp-sub"><td>${esc(x[0])}</td><td class="n">${x[1]}</td><td class="n">${money(x[2])}</td><td class="n">${(c.total > 0 ? x[2] / c.total * 100 : 0).toFixed(0)}%</td></tr>`).join('');
    }
    return h;
  }).join('');
  return `<table class="rp-t"><thead><tr><th>Category</th><th class="n">Txns</th><th class="n">Amount</th><th class="n">Share</th></tr></thead><tbody>${body}<tr class="rp-total"><td>Total</td><td class="n">${list.reduce((s, c) => s + c.count, 0)}</td><td class="n">${money(total)}</td><td class="n">100%</td></tr></tbody></table>`;
}
function uxReportHTML(from, to) {
  const D = uxReportData(from, to), days = Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 864e5) + 1;
  const net = D.income - D.expense, rate = D.income > 0 ? (net / D.income * 100).toFixed(1) + '%' : '—';
  const L = uxLoans(), loanNet = L.lent.reduce((s, p) => s + Math.max(0, p.total), 0) - L.owe.reduce((s, p) => s + Math.max(0, p.total), 0);
  const cash = uxCash(), debt = state.cards.reduce((s, c) => s + Math.max(0, num(c.balance)), 0);
  const SD = uxStartDay(), per = uxPeriodOfDate(from, SD), isPeriod = per.start === from && per.end === to;
  let h = `<div class="rp-head"><div><h1>Spending Report</h1><small>${rpFmt(from)} – ${rpFmt(to)} · ${days} day${days > 1 ? 's' : ''}</small><small>Prepared for ${esc(state.user?.name || '')}</small></div><div class="rp-logo">JS</div></div>`;
  h += `<div class="rp-kpis"><div class="rp-kpi in"><small>Total income</small><b>${money(D.income)}</b></div><div class="rp-kpi out"><small>Total expenses</small><b>${money(D.expense)}</b></div><div class="rp-kpi"><small>Net saved</small><b class="${net < 0 ? 'neg-t' : 'pos-t'}">${rpSigned(net)}</b></div><div class="rp-kpi"><small>Savings rate</small><b>${rate}</b></div><div class="rp-kpi"><small>Avg daily spending</small><b>${money(D.expense / days)}</b></div><div class="rp-kpi"><small>Transactions</small><b>${D.core.length}</b></div><div class="rp-kpi"><small>Card payments</small><b style="color:#1769e0">${money(D.payTotal)}</b></div><div class="rp-kpi"><small>Spent on cards</small><b>${money(D.cardSpent)}</b></div></div>`;
  if (!D.rows.length && !D.pays.length) return h + '<p class="rp-note">No transactions in this date range.</p>';
  if (D.inc.length) h += `<h2 class="rp-sec">💰 Income summary</h2>${rpCatTable(D.inc, D.income, 'income')}`;
  if (D.exp.length) h += `<h2 class="rp-sec">💸 Expense summary</h2>${rpCatTable(D.exp, D.expense, 'expense')}`;
  if (D.core.some(t => !String(t.category || '').trim())) h += '<p class="rp-note">“Uncategorised” holds transactions saved without a category, so totals still match.</p>';
  const lo = D.loan;
  h += uxCardSectionHTML(D);
  h += uxVoucherSectionHTML(D);
  if (lo.borrowed + lo.repaid + lo.lent + lo.back > 0) h += `<h2 class="rp-sec">🤝 Loan activity <small>(not counted in income or expenses)</small></h2><table class="rp-t"><tbody>${lo.borrowed ? `<tr><td>Money borrowed</td><td class="n">${money(lo.borrowed)}</td></tr>` : ''}${lo.repaid ? `<tr><td>Loan repayments made</td><td class="n">${money(lo.repaid)}</td></tr>` : ''}${lo.lent ? `<tr><td>Money lent to others</td><td class="n">${money(lo.lent)}</td></tr>` : ''}${lo.back ? `<tr><td>Money received back</td><td class="n">${money(lo.back)}</td></tr>` : ''}</tbody></table>`;
  const spent = {}; D.exp.forEach(c => { spent[lc(c.name)] = c.total; });
  const buds = state.budgets.filter(b => !String(b.category).startsWith('__') && (spent[lc(b.category)] || 0) > 0);
  if (isPeriod && buds.length) {
    h += `<h2 class="rp-sec">🎯 Budget vs actual</h2><table class="rp-t"><thead><tr><th>Category</th><th class="n">Budget</th><th class="n">Spent</th><th class="n">Left</th></tr></thead><tbody>${buds.map(b => { const sp = spent[lc(b.category)] || 0, left = num(b.amount) - sp; return `<tr><td>${catIcon(b.category)} ${esc(b.category)}</td><td class="n">${money(b.amount)}</td><td class="n">${money(sp)}</td><td class="n ${left < 0 ? 'neg-t' : 'pos-t'}">${rpSigned(left)}</td></tr>`; }).join('')}</tbody></table>`;
  }
  h += `<h2 class="rp-sec">📌 Position today <small>(${rpFmt(today())})</small></h2><table class="rp-t"><tbody><tr><td>Cash &amp; bank</td><td class="n">${money(cash)}</td></tr>${uxVoucherTotal() > 0.005 ? `<tr><td>Voucher balance</td><td class="n">${money(uxVoucherTotal())}</td></tr>` : ''}<tr><td>Credit card debt</td><td class="n">${money(debt)}</td></tr><tr><td>Loans (net)</td><td class="n">${rpSigned(loanNet)}</td></tr>${uxInstRemaining() > 0.005 ? `<tr><td>Installments remaining</td><td class="n">${money(uxInstRemaining())}</td></tr>` : ''}<tr class="rp-total"><td>Net worth</td><td class="n">${rpSigned(cash + uxVoucherTotal() - debt + loanNet - uxInstRemaining())}</td></tr></tbody></table>`;
  if (RP.list) {
    const items = D.rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    h += `<h2 class="rp-sec">🧾 All transactions (${items.length})</h2><table class="rp-t"><thead><tr><th>Date</th><th>Category</th><th>Details</th><th class="n">Amount</th></tr></thead><tbody>${items.map(t => `<tr><td>${esc(String(t.date).slice(5, 10))}</td><td>${esc(t.category || '—')}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}</td><td>${esc(t.product || t.note || '')}</td><td class="n ${t.type === 'income' ? 'pos-t' : 'neg-t'}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</td></tr>`).join('')}</tbody></table>`;
  }
  return h + `<div class="rp-foot"><span>Jamshi Solution · Spending Tracker</span><span>Generated ${rpFmt(today())}</span></div>`;
}
function uxReportRender() {
  if (RP.from > RP.to) { const t = RP.from; RP.from = RP.to; RP.to = t; }
  $('rp-from').value = RP.from; $('rp-to').value = RP.to;
  $('rp-paper').innerHTML = uxReportHTML(RP.from, RP.to);
  document.title = 'Spending Report ' + RP.from + ' to ' + RP.to;
}
function uxReportOpen(from, to) {
  let o = $('report-overlay');
  if (!o) {
    o = document.createElement('div'); o.id = 'report-overlay';
    o.innerHTML = `<div class="rp-bar"><button type="button" data-rp="close">✕ Close</button><b>Report</b><span class="rp-actions"><button type="button" class="primary" data-rp="pdf">📄 Save PDF</button><button type="button" class="rp-print" data-rp="print" aria-label="Print">🖨️</button></span></div><div class="rp-controls"><div class="rp-dates"><label>From<input type="date" id="rp-from"></label><label>To<input type="date" id="rp-to"></label></div><div class="rp-chips"><button type="button" data-rp-range="period">This period</button><button type="button" data-rp-range="lastperiod">Last period</button><button type="button" data-rp-range="month">This month</button><button type="button" data-rp-range="lastmonth">Last month</button><button type="button" data-rp-range="three">Last 3 periods</button><button type="button" data-rp-range="year">This year</button></div><label class="rp-opt"><input type="checkbox" id="rp-subs" checked> Show subcategories</label><label class="rp-opt"><input type="checkbox" id="rp-list"> Include full transaction list</label><p class="rp-hint">Tap <b>Save PDF</b>, then choose <b>Save to Files</b> (or send it by WhatsApp, Mail, AirDrop or Print). The PDF supports English text; other scripts are skipped in the PDF only.</p></div><div id="rp-paper"></div>`;
    document.body.appendChild(o);
    o.addEventListener('click', e => {
      const a = e.target.closest('[data-rp]')?.dataset.rp, r = e.target.closest('[data-rp-range]')?.dataset.rpRange;
      if (a === 'close') { o.className = ''; document.body.classList.remove('rp-open'); document.title = 'Jamshi Solution – Spending Tracker'; }
      if (a === 'print') window.print();
      if (a === 'pdf') uxReportSavePDF();
      if (r) {
        const t = new Date(), y = t.getFullYear(), m = t.getMonth(), cur = uxPeriod(0);
        const mo = (yy, mm) => [uxIso(yy, mm, 1), uxIso(yy, mm, uxDim(yy, mm))];
        const R = { period: [cur.start, cur.end], lastperiod: [uxPeriod(-1).start, uxPeriod(-1).end], month: mo(y, m), lastmonth: m ? mo(y, m - 1) : mo(y - 1, 11), three: [uxPeriod(-2).start, cur.end], year: [y + '-01-01', y + '-12-31'] }[r];
        RP.from = R[0]; RP.to = R[1]; uxReportRender();
      }
    });
    o.addEventListener('change', e => {
      if (e.target.id === 'rp-from') RP.from = e.target.value || RP.from;
      if (e.target.id === 'rp-to') RP.to = e.target.value || RP.to;
      if (e.target.id === 'rp-subs') RP.subs = e.target.checked;
      if (e.target.id === 'rp-list') RP.list = e.target.checked;
      uxReportRender();
    });
  }
  const P = uxPeriod(UXM.offset || 0); RP.from = from || P.start; RP.to = to || P.end;
  o.className = 'open'; document.body.classList.add('rp-open'); o.scrollTop = 0; uxReportRender();
  const sa = (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  o.querySelector('.rp-print').style.display = sa ? 'none' : '';
  uxLoadPdfLibs().catch(() => {});
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-report]'); if (b) return uxReportOpen(b.dataset.from, b.dataset.to);
  if (e.target.closest('#btn-report')) uxReportOpen();
});


/* ===== Real PDF file (works inside the home-screen app, where window.print() does nothing) ===== */
let uxPdfPromise = null;
function uxLoadPdfLibs() {
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
  if (uxPdfPromise) return uxPdfPromise;
  const load = urls => new Promise((res, rej) => {
    let i = 0; const next = () => { if (i >= urls.length) return rej(new Error('load failed')); const sc = document.createElement('script'); sc.src = urls[i++]; sc.onload = res; sc.onerror = () => { sc.remove(); next(); }; document.head.appendChild(sc); }; next();
  });
  uxPdfPromise = load(['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'])
    .then(() => load(['https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js']))
    .catch(e => { uxPdfPromise = null; throw e; });
  return uxPdfPromise;
}
const rpPlain = s => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D\u20E3]/gu, '').replace(/[–—−]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').replace(/\s+/g, ' ').trim();
function uxReportPDFDoc() {
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' }), W = 210, M = 14, from = RP.from, to = RP.to, P = rpPlain;
  const ink = [23, 32, 51], gray = [113, 128, 150], blue = [23, 105, 224], green = [21, 148, 90], red = [220, 76, 76];
  const D = uxReportData(from, to), days = Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 864e5) + 1, net = D.income - D.expense;
  const L = uxLoans(), loanNet = L.lent.reduce((s, p) => s + Math.max(0, p.total), 0) - L.owe.reduce((s, p) => s + Math.max(0, p.total), 0);
  const cash = uxCash(), debt = state.cards.reduce((s, c) => s + Math.max(0, num(c.balance)), 0);
  const per = uxPeriodOfDate(from, uxStartDay()), isPeriod = per.start === from && per.end === to;
  doc.setFillColor(...blue); doc.roundedRect(W - M - 14, 12, 14, 14, 3, 3, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('JS', W - M - 7, 21, { align: 'center' });
  doc.setTextColor(...ink); doc.setFontSize(20); doc.text('Spending Report', M, 19);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...gray);
  doc.text(P(rpFmt(from) + ' - ' + rpFmt(to)) + '   |   ' + days + ' day' + (days > 1 ? 's' : ''), M, 25); doc.text('Prepared for ' + P(state.user?.name || ''), M, 30);
  doc.setDrawColor(...blue); doc.setLineWidth(0.8); doc.line(M, 33, W - M, 33);
  const kp = [['Total income', money(D.income), green], ['Total expenses', money(D.expense), red], ['Net saved', rpSigned(net), net < 0 ? red : green], ['Savings rate', D.income > 0 ? (net / D.income * 100).toFixed(1) + '%' : '-', ink], ['Avg daily spending', money(D.expense / days), ink], ['Transactions', String(D.core.length), ink], ['Card payments', money(D.payTotal), blue], ['Spent on cards', money(D.cardSpent), ink]];
  const bw = (W - 2 * M - 8) / 3;
  kp.forEach((x, i) => { const cx = M + (i % 3) * (bw + 4), cy = 38 + Math.floor(i / 3) * 20; doc.setDrawColor(222, 228, 238); doc.setLineWidth(0.3); doc.roundedRect(cx, cy, bw, 16, 2, 2); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray); doc.text(x[0], cx + 3, cy + 5.5); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...x[2]); doc.text(P(x[1]), cx + 3, cy + 12.5); });
  doc.setFont('helvetica', 'normal');
  let y = 38 + Math.ceil(kp.length / 3) * 20 + 4;
  if (!D.rows.length && !D.pays.length) { doc.setFontSize(10); doc.setTextColor(...gray); doc.text('No transactions in this date range.', M, y); return doc; }
  const section = t => { if (y > 250) { doc.addPage(); y = 18; } doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ink); doc.text(t, M, y); doc.setDrawColor(222, 228, 238); doc.setLineWidth(0.3); doc.line(M, y + 2, W - M, y + 2); y += 5; doc.setFont('helvetica', 'normal'); };
  const table = (head, body, cols, parse) => { doc.autoTable({ startY: y, head: [head], body, margin: { left: M, right: M, bottom: 16 }, theme: 'plain', styles: { fontSize: 9, cellPadding: 1.8, textColor: ink, lineColor: [236, 240, 246], lineWidth: { bottom: 0.2 } }, headStyles: { textColor: gray, fontSize: 8, fontStyle: 'bold', lineColor: [210, 218, 230], lineWidth: { bottom: 0.3 } }, columnStyles: cols || {}, didParseCell: d => { const c = (cols || {})[d.column.index]; if (c && c.halign && d.section === 'head') d.cell.styles.halign = c.halign; if (parse) parse(d); } }); y = doc.lastAutoTable.finalY + 9; };
  const right = { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } };
  const catRows = (list, total) => {
    const body = [];
    list.forEach(c => {
      body.push([{ content: P(c.name), styles: { fontStyle: 'bold' } }, { content: String(c.count), styles: { fontStyle: 'bold' } }, { content: P(money(c.total)), styles: { fontStyle: 'bold' } }, { content: (total > 0 ? c.total / total * 100 : 0).toFixed(1) + '%', styles: { fontStyle: 'bold' } }]);
      if (RP.subs) {
        const subs = Object.values(c.subs).sort((a, b) => b.total - a.total), rest = c.total - subs.reduce((s, x) => s + x.total, 0), restN = c.count - subs.reduce((s, x) => s + x.count, 0);
        const r = subs.map(x => [x.name, x.count, x.total]); if (subs.length && rest > 0.005) r.push(['No subcategory', restN, rest]);
        r.forEach(x => { const st = { textColor: gray, fontSize: 8 }; body.push([{ content: P(x[0]), styles: { ...st, cellPadding: { top: 1.2, bottom: 1.2, left: 8, right: 1.8 } } }, { content: String(x[1]), styles: st }, { content: P(money(x[2])), styles: st }, { content: (c.total > 0 ? x[2] / c.total * 100 : 0).toFixed(0) + '%', styles: st }]); });
      }
    });
    const ts = { fontStyle: 'bold', fillColor: [243, 246, 251] };
    body.push([{ content: 'Total', styles: ts }, { content: String(list.reduce((s, c) => s + c.count, 0)), styles: ts }, { content: P(money(total)), styles: ts }, { content: '100%', styles: ts }]);
    return body;
  };
  if (D.inc.length) { section('Income summary'); table(['Category', 'Txns', 'Amount', 'Share'], catRows(D.inc, D.income), right); }
  if (D.exp.length) { section('Expense summary'); table(['Category', 'Txns', 'Amount', 'Share'], catRows(D.exp, D.expense), right); }
  if (D.core.some(t => !String(t.category || '').trim())) { doc.setFontSize(8); doc.setTextColor(...gray); doc.text('"Uncategorised" holds transactions saved without a category, so totals still match.', M, y - 4); y += 5; }
  const lo = D.loan;
  if (D.cards.length || D.pays.length) {
    section('Credit card payments');
    if (D.cards.length) table(['Card', 'Spent on card', 'Paid', 'Owed today'], D.cards.map(x => { const owed = Math.max(0, num(x.card.balance)); return [P(x.card.name + (x.card.last4 ? ' ....' + x.card.last4 : '')), P(money(x.spent)), { content: P(money(x.paid)), styles: { textColor: green } }, { content: P(money(owed)), styles: { fontStyle: 'bold', textColor: owed > 0 ? red : green } }]; }), right);
    if (D.pays.length) {
      const tsx = { fontStyle: 'bold', fillColor: [243, 246, 251] };
      table(['Date', 'Card', 'Paid from', 'Amount'], D.pays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(p => [P(rpFmt(p.date)), P(p.cardName), P(p.accName + (p.note ? ' - ' + p.note : '')), { content: P(money(p.amount)), styles: { fontStyle: 'bold' } }]).concat([[{ content: 'Total paid', colSpan: 3, styles: tsx }, { content: P(money(D.payTotal)), styles: tsx }]]), { 3: { halign: 'right' } });
    }
    doc.setFontSize(8); doc.setTextColor(...gray); doc.text('Card payments settle spending already counted in your expenses, so they are not counted again.', M, y - 4); y += 5;
  }
  if (D.vouchers.length) {
    section('Voucher balance');
    table(['Voucher', 'Spent', 'Paid for it', 'Balance', 'To pay'], D.vouchers.map(v => [P(v.acc.name), P(money(v.spent)), P(money(v.paidIn)), { content: P(money(Math.max(0, num(v.acc.balance)))), styles: { textColor: green, fontStyle: 'bold' } }, { content: P(money(v.plan ? v.plan.remaining : 0)), styles: { textColor: v.plan && !v.plan.done ? red : ink } }]), { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } });
    doc.setFontSize(8); doc.setTextColor(...gray); doc.text('Voucher purchases are counted in the expense categories. Money paid to settle a voucher is not an expense.', M, y - 4); y += 5;
  }
  if (lo.borrowed + lo.repaid + lo.lent + lo.back > 0) { section('Loan activity (not counted in income or expenses)'); const r = []; if (lo.borrowed) r.push(['Money borrowed', money(lo.borrowed)]); if (lo.repaid) r.push(['Loan repayments made', money(lo.repaid)]); if (lo.lent) r.push(['Money lent to others', money(lo.lent)]); if (lo.back) r.push(['Money received back', money(lo.back)]); table(['Item', 'Amount'], r, { 1: { halign: 'right' } }); }
  const spent = {}; D.exp.forEach(c => { spent[lc(c.name)] = c.total; });
  const buds = state.budgets.filter(b => !String(b.category).startsWith('__') && (spent[lc(b.category)] || 0) > 0);
  if (isPeriod && buds.length) {
    section('Budget vs actual');
    table(['Category', 'Budget', 'Spent', 'Left'], buds.map(b => { const sp = spent[lc(b.category)] || 0, left = num(b.amount) - sp; return [P(b.category), P(money(b.amount)), P(money(sp)), { content: P(rpSigned(left)), styles: { textColor: left < 0 ? red : green, fontStyle: 'bold' } }]; }), right);
  }
  section('Position today (' + P(rpFmt(today())) + ')');
  table(['Item', 'Amount'], [['Cash & bank', P(money(cash))], ...(uxVoucherTotal() > 0.005 ? [['Voucher balance', P(money(uxVoucherTotal()))]] : []), ['Credit card debt', P(money(debt))], ['Loans (net)', P(rpSigned(loanNet))], ...(uxInstRemaining() > 0.005 ? [['Installments remaining', P(money(uxInstRemaining()))]] : []), [{ content: 'Net worth', styles: { fontStyle: 'bold', fillColor: [243, 246, 251] } }, { content: P(rpSigned(cash + uxVoucherTotal() - debt + loanNet - uxInstRemaining())), styles: { fontStyle: 'bold', fillColor: [243, 246, 251] } }]], { 1: { halign: 'right' } });
  if (RP.list) {
    const items = D.rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    section('All transactions (' + items.length + ')');
    table(['Date', 'Category', 'Details', 'Amount'], items.map(t => [String(t.date).slice(5, 10), P((t.category || '-') + (t.subcategory ? ' - ' + t.subcategory : '')), P(t.product || t.note || ''), { content: (t.type === 'income' ? '+' : '-') + P(money(t.amount)), styles: { textColor: t.type === 'income' ? green : red } }]), { 3: { halign: 'right' } });
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray); doc.text('Jamshi Solution - Spending Tracker', M, 289); doc.text('Generated ' + P(rpFmt(today())), W / 2, 289, { align: 'center' }); doc.text('Page ' + i + ' of ' + n, W - M, 289, { align: 'right' }); }
  return doc;
}
async function uxReportSavePDF() {
  try { await uxLoadPdfLibs(); } catch (e) { return toast('Could not load the PDF tool. Check your internet and try again.', 'error'); }
  let blob, file; const name = 'Spending Report ' + RP.from + ' to ' + RP.to + '.pdf';
  try { blob = uxReportPDFDoc().output('blob'); file = new File([blob], name, { type: 'application/pdf' }); }
  catch (e) { return toast('Could not create the PDF: ' + e.message, 'error'); }
  const share = () => navigator.share({ files: [file], title: name });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await share(); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  uxSheet(`<div class="sheet-ic">📄</div><h3>PDF ready</h3><p>${esc(name)}</p><div class="sheet-btns">${navigator.canShare ? '<button data-pdf="share">📤 Share / Save to Files</button>' : ''}<a class="pdf-link" href="${url}" download="${esc(name)}" target="_blank" rel="noopener">⬇️ Download / Open</a><button data-close>Close</button></div>`,
    async e => { if (e.target.closest('[data-pdf="share"]')) { try { await share(); } catch (err) { if (!err || err.name !== 'AbortError') toast('Sharing failed. Use Download / Open.', 'error'); } } });
}


/* ===== Credit card payment: sheet flow, Pay buttons, payment history ===== */
const uxOwner = o => { const n = userName(o); return n === '—' ? (o || '') : n; };
function renderAccounts() {
  $('accounts-list').innerHTML = state.accounts.filter(a => !uxIsVoucherAcc(a)).map(a => `<div class="account-row"><div><b>${esc(a.name)}</b><small>${esc(a.type || 'Account')} · ${esc(uxOwner(a.owner))}</small></div><strong>${money(a.balance)}</strong></div>`).join('') || '<p class="empty">No accounts.</p>';
  $('cards-list').innerHTML = state.cards.map(c => {
    const owed = Math.max(0, num(c.balance)), avail = Math.max(0, num(c.limit) - owed);
    return `<div class="account-row"><div><b>💳 ${esc(c.name)} ·•••• ${esc(c.last4 || '')}</b><small>Limit ${money(c.limit)} · Available ${money(avail)}${uxDue(c)}</small></div><div class="card-right"><strong class="${owed > 0 ? 'neg' : ''}">${owed > 0 ? '−' : ''}${money(owed)}</strong>${owed > 0 ? `<button type="button" class="pay-btn" data-pay="${esc(c.id)}">Pay</button>` : ''}</div></div>`;
  }).join('') || '<p class="empty">No credit cards.</p>';
}
const PH = { all: false };
function renderPayments() {
  let box = $('payments-box');
  if (!box) {
    box = document.createElement('div'); box.id = 'payments-box';
    const lb = $('loans-box'); if (lb) $('view-accounts').insertBefore(box, lb); else $('view-accounts').appendChild(box);
    box.addEventListener('click', e => { if (e.target.closest('[data-payall]')) { PH.all = !PH.all; renderPayments(); } });
  }
  const list = state.payments.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!list.length) { box.innerHTML = ''; return; }
  const shown = PH.all ? list : list.slice(0, 5);
  box.innerHTML = `<div class="section-heading"><h2>Card payments</h2><span>${list.length} recorded</span></div><section class="panel">${shown.map(p => { const c = state.cards.find(x => x.id === String(p.cardId)), a = state.accounts.find(x => x.id === String(p.accountId)); return `<div class="account-row"><div><b>💳 ${esc(c ? c.name : 'Card')}</b><small>${esc(String(p.date).slice(0, 10))}${a ? ' · from ' + esc(a.name) : ''}${p.note ? ' · ' + esc(p.note) : ''}</small></div><strong class="pos">${money(p.amount)}</strong></div>`; }).join('')}${list.length > 5 ? `<button type="button" class="text-button more-pay" data-payall="1">${PH.all ? 'Show less' : 'Show all ' + list.length}</button>` : ''}</section>`;
}
function uxPayForm(cardId) {
  if (!state.cards.length) return toast('No credit card added yet.', 'error');
  if (!state.accounts.length) return toast('Add a cash/bank account first.', 'error');
  const owedOf = c => Math.max(0, num(c.balance)), byId = id => state.cards.find(c => c.id === String(id));
  const pick = byId(cardId) || state.cards.find(c => owedOf(c) > 0) || state.cards[0];
  uxSheet(`<div class="sheet-ic">💳</div><h3>Pay credit card</h3><div class="lf"><label>Card</label><select id="pf-card">${state.cards.map(c => `<option value="${esc(c.id)}">${esc(c.name)} ·•••• ${esc(c.last4 || '')}</option>`).join('')}</select></div><div class="pf-owed" id="pf-owed"></div><div class="lf"><label>Amount (QR)</label><input id="pf-amt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"><div class="chips"><button type="button" class="chip" data-fill="full">Pay full amount</button><button type="button" class="chip" data-fill="half">Half</button></div></div><div class="lf"><label>Pay from</label><select id="pf-acc">${uxCashAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('')}</select></div><div class="lf"><label>Date</label><input id="pf-date" type="date" value="${today()}"></div><div class="lf"><label>Note (optional)</label><input id="pf-note"></div><div class="sheet-btns"><button data-save="1" class="save-btn">Record payment</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      const c = byId($('pf-card').value), a = state.accounts.find(x => x.id === $('pf-acc').value);
      const fill = e.target.closest('[data-fill]')?.dataset.fill;
      if (fill) { const o = owedOf(c); $('pf-amt').value = (fill === 'full' ? o : o / 2).toFixed(2); return; }
      if (!e.target.closest('[data-save]')) return;
      const amt = num($('pf-amt').value);
      if (!c || !a) return toast('Choose a card and an account.', 'error');
      if (amt <= 0) return toast('Enter an amount greater than zero.', 'error');
      if (amt > owedOf(c) + 0.005 && !confirm(`You owe ${money(owedOf(c))} on this card. Pay ${money(amt)} anyway?`)) return;
      if (amt > num(a.balance) + 0.005 && !confirm(`${a.name} has only ${money(a.balance)}. Continue?`)) return;
      const data = { id: uid(), date: $('pf-date').value || today(), cardId: c.id, accountId: a.id, amount: amt, note: $('pf-note').value.trim() };
      close();
      c.balance = num(c.balance) - amt; a.balance = num(a.balance) - amt; state.payments.unshift({ ...data, userId: state.user?.id });
      renderAll(); if ($('view-add').classList.contains('active')) switchView('accounts');
      toast(`Paid ${money(amt)} · ${c.name} now owes ${money(Math.max(0, c.balance))} ✓`, 'success');
      try { await api('addPayment', { data }); } catch (err) { toast('Payment not saved: ' + err.message, 'error'); }
      uxSync();
    });
  const refresh = () => { const c = byId($('pf-card').value); $('pf-owed').textContent = c ? (owedOf(c) > 0 ? `You owe ${money(owedOf(c))} on this card${uxDue(c)}` : 'Nothing owed on this card') : ''; };
  $('pf-card').value = pick.id; $('pf-card').onchange = refresh; refresh();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-pay]'); if (b) uxPayForm(b.dataset.pay); });


/* ===== Pay later / installment plans (stored in your sheet, no backend change) ===== */
const r2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
function uxAddMonths(ds, n) {
  let y = +ds.slice(0, 4), m = +ds.slice(5, 7) - 1 + n; const d = +ds.slice(8, 10);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return uxIso(y, m, Math.min(d, uxDim(y, m)));
}
function uxPlans() {
  const out = [];
  state.budgets.filter(b => String(b.category).startsWith('__plan|')).forEach(b => {
    let p; try { p = JSON.parse(b.period); } catch (e) { return; }
    if (!p || !p.id) return;
    const txs = state.transactions.filter(t => String(t.fuelId || '') === 'plan:' + p.id).sort((a, c) => String(a.date).localeCompare(String(c.date)));
    const paid = r2(txs.reduce((s, t) => s + t.amount, 0)), remaining = Math.max(0, r2(p.total - paid)), done = remaining < 0.005;
    const rest = r2(p.total - p.down), base = Math.floor(rest / p.n * 100) / 100, items = [];
    if (p.down > 0) items.push({ k: 0, date: p.date, amount: p.down });
    for (let i = 1; i <= p.n; i++) items.push({ k: i, date: uxAddMonths(p.start, i - 1), amount: i === p.n ? r2(rest - base * (p.n - 1)) : base });
    items.forEach((it, idx) => { it.paid = done || idx < txs.length; });
    let next = items.find(it => !it.paid);
    if (!done && !next) next = { k: p.n, date: items[items.length - 1].date, amount: remaining, extra: true };
    out.push({ ...p, rowId: b.id, txs, paid, remaining, done, items, next, count: items.length, paidCount: items.filter(i => i.paid).length });
  });
  return out;
}
function uxInstRemaining() { return uxPlans().reduce((s, p) => s + p.remaining, 0); }
function uxPlanTx(plan, k, amount, date, src) {
  const [kind, id] = String(src || '').split(':');
  return { id: uid(), date, type: 'expense', amount, category: plan.category, subcategory: plan.subcategory || '', product: plan.name + ' - ' + (k === 0 ? 'first payment' : 'installment ' + k + ' of ' + plan.n), note: 'Pay later', accountId: kind === 'acc' ? id : '', cardId: kind === 'card' ? id : '', isPrivate: false, fuelId: 'plan:' + plan.id };
}
function uxHeroInst() {
  const hs = document.querySelector('.hero-stats'); if (!hs) return;
  let el = $('inst-stat'); if (!el) { el = document.createElement('span'); el.id = 'inst-stat'; hs.appendChild(el); }
  const r = uxInstRemaining(); el.style.display = r > 0.005 ? '' : 'none'; el.innerHTML = `Pay-later due <b>${money(r)}</b>`;
}
function renderInstallments() {
  let box = $('installments-box');
  if (!box) {
    box = document.createElement('div'); box.id = 'installments-box';
    const anchor = $('payments-box') || $('loans-box'); if (anchor) $('view-accounts').insertBefore(box, anchor); else $('view-accounts').appendChild(box);
    box.addEventListener('click', e => {
      const p = e.target.closest('[data-plan]'); if (p && !e.target.closest('[data-instpay]')) return uxPlanDetail(p.dataset.plan);
      const pay = e.target.closest('[data-instpay]'); if (pay) uxInstPay(pay.dataset.instpay);
    });
  }
  const plans = uxPlans(), act = plans.filter(p => !p.done).sort((a, b) => String(a.next.date).localeCompare(String(b.next.date))), fin = plans.filter(p => p.done);
  const rem = act.reduce((s, p) => s + p.remaining, 0), nx = act[0];
  const row = p => { const od = p.next && p.next.date < today(), pct = p.total > 0 ? Math.min(100, p.paid / p.total * 100) : 0; return `<div class="account-row plan-row" data-plan="${esc(p.id)}"><div class="plan-main"><b>${catIcon(p.category)} ${esc(p.name)}</b><small>${p.paidCount} of ${p.count} paid · ${p.next ? (od ? 'Overdue since ' : 'Next ') + esc(rpFmt(p.next.date)) : ''}</small><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></div><div class="card-right"><div class="plan-amt"><strong class="${od ? 'neg' : ''}">${money(p.next ? Math.min(p.next.amount, p.remaining) : 0)}</strong><small>${money(p.remaining)} left</small></div><button type="button" class="pay-btn" data-instpay="${esc(p.id)}">Pay</button></div></div>`; };
  box.innerHTML = `<div class="section-heading"><h2>🛒 Pay later</h2><button type="button" class="text-button" data-newplan="1">＋ New plan</button></div>` +
    (act.length ? `<div class="loan-sum"><div><small>Total remaining</small><b class="neg">${money(rem)}</b></div><div><small>Next payment</small><b>${esc(rpFmt(nx.next.date))}</b></div></div>` : '') +
    `<section class="panel">${act.map(row).join('') || '<p class="empty">No pay-later plans. Tap “＋ New plan” when you buy something in installments.</p>'}${fin.length ? `<details class="done-plans"><summary>✅ Completed (${fin.length})</summary>${fin.map(p => `<div class="account-row plan-row" data-plan="${esc(p.id)}"><div><b>${catIcon(p.category)} ${esc(p.name)}</b><small>Paid ${money(p.paid)}</small></div><strong class="pos">✓</strong></div>`).join('')}</details>` : ''}</section>`;
}
function renderUpcoming() {
  let box = $('upcoming-box');
  if (!box) {
    const h = $('category-summary').previousElementSibling; if (!h) return;
    box = document.createElement('div'); box.id = 'upcoming-box'; h.parentNode.insertBefore(box, h);
    box.addEventListener('click', e => { const b = e.target.closest('[data-instpay]'); if (b) uxInstPay(b.dataset.instpay); });
  }
  const act = uxPlans().filter(p => !p.done && p.next).sort((a, b) => String(a.next.date).localeCompare(String(b.next.date))).slice(0, 4);
  if (!act.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section-heading"><h2>Upcoming installments</h2><button type="button" class="text-button" data-goto="accounts">See all</button></div><section class="panel">${act.map(p => { const od = p.next.date < today(); return `<div class="account-row"><div><b>🛒 ${esc(p.name)}</b><small class="${od ? 'neg' : ''}">${od ? 'Overdue · ' : 'Due '}${esc(rpFmt(p.next.date))} · ${p.paidCount} of ${p.count} paid</small></div><div class="card-right"><strong>${money(Math.min(p.next.amount, p.remaining))}</strong><button type="button" class="pay-btn" data-instpay="${esc(p.id)}">Pay</button></div></div>`; }).join('')}</section>`;
}
function uxPlanDetail(id) {
  const p = uxPlans().find(x => x.id === id); if (!p) return;
  const sched = p.items.map(it => { const od = !it.paid && it.date < today(); return `<div class="lh"><span>${it.k === 0 ? 'First payment' : 'Installment ' + it.k}<small>${esc(rpFmt(it.date))}${it.paid ? ' · paid' : od ? ' · overdue' : ''}</small></span><b class="${it.paid ? 'pos' : od ? 'neg' : ''}">${it.paid ? '✓ ' : ''}${money(it.amount)}</b></div>`; }).join('');
  uxSheet(`<div class="sheet-ic">${catIcon(p.category)}</div><h3>${esc(p.name)}</h3><div class="sheet-amt ${p.done ? 'income' : 'expense'}">${p.done ? 'Fully paid ✓' : money(p.remaining) + ' left'}</div><p>Total ${money(p.total)}${p.fee > 0 ? ' (incl. fee ' + money(p.fee) + ')' : ''} · paid ${money(p.paid)}<br>${p.voucher ? '🎟️ Voucher balance — spend it from the Add screen' : esc(p.category) + (p.subcategory ? ' · ' + esc(p.subcategory) : '')}</p><div class="sheet-btns">${p.done ? '' : `<button data-do="pay">💸 Pay ${money(Math.min(p.next.amount, p.remaining))}</button>`}<button class="del" data-do="del">🗑️ Delete plan</button><button data-close>Close</button></div><h4 class="mini-title">Schedule</h4>${sched}`,
    async (e, close) => {
      const d = e.target.closest('[data-do]')?.dataset.do; if (!d) return;
      if (d === 'pay') { close(); return uxInstPay(id); }
      if (d === 'del') {
        if (!confirm('Delete this plan? Payments already recorded stay in your history.')) return;
        close(); state.budgets = state.budgets.filter(b => b.id !== p.rowId); renderAll(); toast('Plan deleted ✓', 'success');
        try { await api('deleteBudget', { id: p.rowId }); } catch (err) { toast('Not deleted: ' + err.message, 'error'); }
        uxSync();
      }
    });
}
function uxInstPay(id) {
  const p = uxPlans().find(x => x.id === id); if (!p || p.done) return;
  const amt0 = Math.min(p.next.amount, p.remaining);
  const srcOpts = uxCashAccounts().map(a => `<option value="acc:${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('') + state.cards.map(c => `<option value="card:${esc(c.id)}">💳 ${esc(c.name)}</option>`).join('');
  uxSheet(`<div class="sheet-ic">🛒</div><h3>Pay ${esc(p.name)}</h3><div class="pf-owed">${p.next.extra ? 'Remaining balance' : 'Installment ' + p.next.k + ' of ' + p.n} · due ${esc(rpFmt(p.next.date))} · ${money(p.remaining)} left in total</div><div class="lf"><label>Amount (QR)</label><input id="ip-amt" type="number" inputmode="decimal" step="0.01" min="0.01" value="${amt0.toFixed(2)}"><div class="chips"><button type="button" class="chip" data-all="1">Pay everything left (${money(p.remaining)})</button></div></div><div class="lf"><label>Pay from</label><select id="ip-src">${srcOpts}</select></div><div class="lf"><label>Date</label><input id="ip-date" type="date" value="${today()}"></div><div class="sheet-btns"><button data-save="1" class="save-btn">Record payment</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      if (e.target.closest('[data-all]')) { $('ip-amt').value = p.remaining.toFixed(2); return; }
      if (!e.target.closest('[data-save]')) return;
      const amt = r2($('ip-amt').value), src = $('ip-src').value;
      if (amt <= 0) return toast('Enter an amount greater than zero.', 'error');
      if (amt > p.remaining + 0.005) return toast('That is more than the ' + money(p.remaining) + ' left.', 'error');
      if (!src) return toast('Choose where to pay from.', 'error');
      const tx = uxPlanTx(p, p.next.k, amt, $('ip-date').value || today(), src); close();
      state.transactions.unshift(normalizeTx({ ...tx, userId: state.user?.id })); uxApply('expense', amt, tx.accountId, tx.cardId, 1);
      const left = Math.max(0, r2(p.remaining - amt)); renderAll();
      toast(left < 0.005 ? p.name + ' is fully paid 🎉' : 'Paid ' + money(amt) + ' · ' + money(left) + ' left ✓', 'success');
      try { await api('addTx', { data: tx }); } catch (err) { toast('Not saved: ' + err.message, 'error'); }
      uxSync();
    });
  const pref = state.cards.find(c => String(c.id) === String(p.src?.split(':')[1])) || state.accounts.find(a => String(a.id) === String(p.src?.split(':')[1]));
  if (pref && [...$('ip-src').options].some(o => o.value === p.src)) $('ip-src').value = p.src;
}
function uxPlanForm() {
  if (!state.accounts.length && !state.cards.length) return toast('Add an account or card first.', 'error');
  const cats = uxCatList('expense').map(c => c.name), defCat = cats.find(c => lc(c) === 'shopping') || cats[0];
  const srcOpts = uxCashAccounts().map(a => `<option value="acc:${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('') + state.cards.map(c => `<option value="card:${esc(c.id)}">💳 ${esc(c.name)}</option>`).join('');
  uxSheet(`<h3>🛒 New pay-later plan</h3><div class="lf"><label>What did you buy?</label><input id="pl-name" placeholder="e.g. iPhone or Shopping vouchers"></div><label class="vchk"><input type="checkbox" id="pl-voucher"> 🎟️ This is a voucher / prepaid balance (I will spend it later)</label><div class="lf pl-item"><label>Category</label><select id="pl-cat">${cats.map(c => `<option value="${esc(c)}">${catIcon(c)} ${esc(c)}</option>`).join('')}</select></div><div class="lf pl-item"><label>Subcategory</label><select id="pl-sub"></select></div><div class="lf"><label>Price (QR)</label><input id="pl-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="5000"></div><div class="lf pl-item"><label>Extra fee / interest (optional)</label><input id="pl-fee" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"></div><div class="lf"><label>Installments after the first payment</label><div class="chips">${[4, 6, 8, 12].map(n => `<button type="button" class="chip ${n === 4 ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}<input id="pl-n" class="n-input" type="number" inputmode="numeric" min="1" max="60" value="4"></div></div><div class="lf"><label>Pay now (first payment)</label><input id="pl-down" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"><div class="chips"><button type="button" class="chip" data-equal="1">Equal share</button></div></div><div class="lf"><label>Next installment due</label><input id="pl-start" type="date" value="${uxAddMonths(today(), 1)}"></div><div class="lf"><label>Pay from</label><select id="pl-src">${srcOpts}</select></div><div class="pl-preview" id="pl-prev">Enter the price to see the plan.</div><div class="sheet-btns"><button data-save="1" class="save-btn">Create plan</button><button data-close>Cancel</button></div>`,
    async (e, close) => {
      const chip = e.target.closest('[data-n]'); if (chip) { $('pl-n').value = chip.dataset.n; recalc(); return; }
      if (e.target.closest('[data-equal]')) { manual = false; recalc(); return; }
      if (!e.target.closest('[data-save]')) return;
      const v = vals(), name = $('pl-name').value.trim();
      if (!name) return toast('Enter what you bought.', 'error');
      if (v.price <= 0) return toast('Enter the price.', 'error');
      if (!(v.n >= 1 && v.n <= 60)) return toast('Installments must be between 1 and 60.', 'error');
      if (v.down < 0 || v.down >= v.total) return toast('Pay-now must be less than the total of ' + money(v.total) + '.', 'error');
      if (!$('pl-src').value) return toast('Choose where to pay from.', 'error');
      const vch = $('pl-voucher').checked, plan = { v: 1, id: uid(), name, voucher: vch, category: vch ? 'Voucher Payment' : $('pl-cat').value, subcategory: vch ? name : $('pl-sub').value, price: v.price, fee: v.fee, total: v.total, down: v.down, n: v.n, start: $('pl-start').value || uxAddMonths(today(), 1), date: today(), src: $('pl-src').value };
      const row = { id: uid(), category: '__plan|' + plan.id, amount: plan.total, period: JSON.stringify(plan), userId: String(state.user?.id || '') };
      close(); let vacc = null;
      if (vch) { vacc = { id: uid(), name, type: 'voucher', owner: String(state.user?.id || ''), balance: plan.price, currency: 'QAR' }; plan.accId = vacc.id; row.period = JSON.stringify(plan); state.accounts.push(normalizeAccount(vacc)); }
      state.budgets.push(row);
      const tx = plan.down > 0 ? uxPlanTx(plan, 0, plan.down, plan.date, plan.src) : null;
      if (tx) { state.transactions.unshift(normalizeTx({ ...tx, userId: state.user?.id })); uxApply('expense', tx.amount, tx.accountId, tx.cardId, 1); }
      renderAll(); toast(vch ? 'Voucher added ✓ ' + money(plan.price) + ' to spend · ' + money(plan.total - plan.down) + ' left to pay' : 'Plan created ✓ ' + money(plan.total - plan.down) + ' left to pay', 'success');
      try { if (vacc) await api('addAccount', { data: vacc }); await api('saveBudget', { data: { id: row.id, category: row.category, amount: row.amount, period: row.period } }); if (tx) await api('addTx', { data: tx }); }
      catch (err) { toast('Not saved: ' + err.message, 'error'); }
      uxSync();
    });
  let manual = false;
  const vals = () => { const price = r2($('pl-price').value), fee = $('pl-voucher').checked ? 0 : r2($('pl-fee').value), n = Math.round(num($('pl-n').value)), total = r2(price + fee); return { price, fee, n, total, down: r2($('pl-down').value) }; };
  const subs = () => { const c = $('pl-cat').value, l = subsFor(c); $('pl-sub').innerHTML = '<option value="">— none —</option>' + l.map(s => `<option value="${esc(s.name)}">${s.icon} ${esc(s.name)}</option>`).join(''); const g = l.find(s => /gadget|mobile|electronic/i.test(s.name)); if (g && /shop|tech/i.test(c)) $('pl-sub').value = g.name; };
  const recalc = () => {
    const v = vals(); document.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n === v.n));
    if (!manual && v.n >= 1) $('pl-down').value = v.total > 0 ? r2(v.total / (v.n + 1)).toFixed(2) : '';
    const d = r2($('pl-down').value), rest = r2(v.total - d), per = v.n >= 1 ? rest / v.n : 0;
    $('pl-prev').textContent = v.total > 0 && v.n >= 1 ? `Total ${money(v.total)} · pay now ${money(d)} · then ${v.n} × ${money(per)} monthly from ${rpFmt($('pl-start').value || today())}${$('pl-voucher').checked ? ' · you get ' + money(v.price) + ' voucher balance to spend' : ''}` : 'Enter the price to see the plan.';
  };
  $('pl-cat').value = defCat; $('pl-cat').onchange = subs; subs();
  ['pl-price', 'pl-fee', 'pl-n', 'pl-start'].forEach(i => $(i).addEventListener('input', recalc));
  $('pl-down').addEventListener('input', () => { manual = true; recalc(); });
  $('pl-voucher').addEventListener('change', () => { document.querySelectorAll('#sheet .pl-item').forEach(el => { el.style.display = $('pl-voucher').checked ? 'none' : ''; }); recalc(); });
  recalc();
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-newplan]')) return uxPlanForm();
  const g = e.target.closest('[data-goto]'); if (g) switchView(g.dataset.goto);
});


/* ===== Credit card payments in History, Report and CSV ===== */
function uxPayItems() {
  return state.payments.map(p => {
    const c = state.cards.find(x => x.id === String(p.cardId)), a = state.accounts.find(x => x.id === String(p.accountId));
    return { id: String(p.id), date: String(p.date || '').slice(0, 10), cardId: String(p.cardId), accountId: String(p.accountId || ''), amount: num(p.amount), note: p.note || '', userId: p.userId, cardName: c ? c.name : 'Card', accName: a ? a.name : '-' };
  }).filter(p => p.date);
}
function uxPayRow(p) {
  return `<div class="tx-row pay-row" data-view-pay="${esc(p.id)}"><div class="tx-icon">💳</div><div class="tx-main"><b>Card payment · ${esc(p.cardName)}</b><small>${esc(p.date)} · from ${esc(p.accName)}${p.note ? ' · ' + esc(p.note) : ''}</small></div><strong class="pay">${money(p.amount)}</strong></div>`;
}
function uxPayDetail(id) {
  const p = uxPayItems().find(x => x.id === id); if (!p) return;
  const c = state.cards.find(x => x.id === p.cardId), owed = c ? Math.max(0, num(c.balance)) : 0;
  uxSheet(`<div class="sheet-ic">💳</div><h3>Card payment</h3><div class="sheet-amt" style="color:var(--blue)">${money(p.amount)}</div><p>${esc(p.cardName)}${c && c.last4 ? ' ····' + esc(c.last4) : ''}<br>${esc(rpFmt(p.date))} · paid from ${esc(p.accName)}${p.note ? '<br>' + esc(p.note) : ''}<br>Recorded by ${esc(uxOwner(p.userId) || '—')}</p><p>This card owes ${money(owed)} today. Card payments are not counted as expenses again, because the spending was already counted.</p><div class="sheet-btns"><button data-close>Close</button></div>`);
}
function uxCardSectionHTML(D) {
  if (!D.cards.length && !D.pays.length) return '';
  let h = '<h2 class="rp-sec">💳 Credit card payments</h2>';
  if (D.cards.length) h += `<table class="rp-t"><thead><tr><th>Card</th><th class="n">Spent on card</th><th class="n">Paid</th><th class="n">Owed today</th></tr></thead><tbody>${D.cards.map(x => { const owed = Math.max(0, num(x.card.balance)); return `<tr><td>💳 ${esc(x.card.name)}${x.card.last4 ? ' ····' + esc(x.card.last4) : ''}</td><td class="n">${money(x.spent)}</td><td class="n pos-t">${money(x.paid)}</td><td class="n ${owed > 0 ? 'neg-t' : 'pos-t'}">${money(owed)}</td></tr>`; }).join('')}</tbody></table>`;
  if (D.pays.length) h += `<table class="rp-t" style="margin-top:12px"><thead><tr><th>Date</th><th>Card</th><th>Paid from</th><th class="n">Amount</th></tr></thead><tbody>${D.pays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(p => `<tr><td>${esc(rpFmt(p.date))}</td><td>${esc(p.cardName)}</td><td>${esc(p.accName)}${p.note ? ' · ' + esc(p.note) : ''}</td><td class="n">${money(p.amount)}</td></tr>`).join('')}<tr class="rp-total"><td colspan="3">Total paid</td><td class="n">${money(D.payTotal)}</td></tr></tbody></table>`;
  return h + '<p class="rp-note">Card payments settle spending already counted in your expenses, so they are not counted again.</p>';
}
function renderHistory() {
  uxHistInit();
  if (!$('history-type').querySelector('[value="payment"]')) $('history-type').insertAdjacentHTML('beforeend', '<option value="payment">💳 Card payments</option>');
  const q = lc($('search').value || ''), type = $('history-type').value, mSel = $('history-month'), cSel = $('history-cat'), mCur = mSel.value, cCur = cSel.value;
  const pays = uxPayItems(), SD = uxStartDay();
  const dates = [...state.transactions.map(t => String(t.date).slice(0, 10)), ...pays.map(p => p.date), today()].filter(Boolean);
  const months = [...new Set(dates.map(d => uxPeriodOfDate(d, SD).start))].sort().reverse();
  const cats = [...new Set(state.transactions.map(t => t.category).filter(Boolean))].sort();
  mSel.innerHTML = '<option value="">All time</option>' + months.map(m => `<option value="${m}">${uxPeriodLabel(uxPeriodOfDate(m, SD))}${m === uxPeriod(0).start ? ' (current)' : ''}</option>`).join('');
  cSel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${catIcon(c)} ${esc(c)}</option>`).join('');
  mSel.value = months.includes(mCur) ? mCur : ''; cSel.value = cats.includes(cCur) ? cCur : '';
  const inRange = d => !mSel.value || inPeriod({ date: d }, uxPeriodOfDate(mSel.value, SD));
  const txs = type === 'payment' ? [] : state.transactions.slice().reverse().filter(t => (type === 'all' || t.type === type) && inRange(String(t.date).slice(0, 10)) && (!cSel.value || t.category === cSel.value) && (!q || [t.category, t.subcategory, t.product, t.note, t.date].join(' ').toLowerCase().includes(q)));
  const pl = (type === 'all' || type === 'payment') && !cSel.value ? pays.slice().reverse().filter(p => inRange(p.date) && (!q || [p.cardName, p.accName, p.note, p.date, 'card payment'].join(' ').toLowerCase().includes(q))) : [];
  const items = [...txs.map(t => ({ t, d: String(t.date).slice(0, 10) })), ...pl.map(p => ({ p, d: p.date }))].sort((a, b) => b.d.localeCompare(a.d));
  const sum = ty => txs.filter(t => t.type === ty && !isLoanTx(t) && !isVoucherPay(t)).reduce((s, t) => s + t.amount, 0), paid = pl.reduce((s, p) => s + p.amount, 0);
  let html = `<div class="hist-sum"><span>${items.length} entries</span>${type === 'payment' ? '' : `<span class="pos">+${money(sum('income'))}</span><span class="neg">−${money(sum('expense'))}</span>`}${paid > 0 ? `<span class="paysum">💳 ${money(paid)}</span>` : ''}</div>`, last = '';
  items.slice(0, HS.limit).forEach(it => { if (it.d !== last) { html += `<div class="day-head">${uxDay(it.d)}</div>`; last = it.d; } html += it.t ? txRow(it.t) : uxPayRow(it.p); });
  if (items.length > HS.limit) html += `<button class="secondary wide" data-more="1">Show more (${items.length - HS.limit} left)</button>`;
  $('history-list').innerHTML = items.length ? html : '<p class="empty">No matching entries.</p>';
}
function exportCsv() {
  const cols = ['date', 'type', 'amount', 'category', 'subcategory', 'product', 'note', 'accountId', 'cardId', 'userId', 'isPrivate'], q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const payRow = p => { const o = { date: p.date, type: 'card_payment', amount: p.amount, category: 'Card payment', subcategory: p.cardName, product: 'Paid from ' + p.accName, note: p.note, accountId: p.accountId, cardId: p.cardId, userId: p.userId, isPrivate: '' }; return cols.map(k => q(o[k])).join(','); };
  const lines = [cols.join(','), ...state.transactions.map(t => cols.map(k => q(t[k])).join(',')), ...uxPayItems().map(payRow)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'jamshi-transactions.csv'; a.click(); URL.revokeObjectURL(url);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-view-pay]'); if (b) uxPayDetail(b.dataset.viewPay); });


/* ===== Voucher balance (prepaid, spend later; paying it off is not an expense) ===== */
function uxIsVoucherAcc(a) { return String((a && a.type) || '').toLowerCase() === 'voucher'; }
function uxIsVoucherAccId(id) { const a = state.accounts.find(x => x.id === String(id)); return !!a && uxIsVoucherAcc(a); }
function isVoucherPay(t) { return t.category === 'Voucher Payment'; }
function uxCash() { return state.accounts.filter(a => !uxIsVoucherAcc(a)).reduce((s, a) => s + num(a.balance), 0); }
function uxVoucherTotal() { return state.accounts.filter(uxIsVoucherAcc).reduce((s, a) => s + Math.max(0, num(a.balance)), 0); }
function uxCashAccounts() { return state.accounts.filter(a => !uxIsVoucherAcc(a)); }
function uxRebuildTxAccount() {
  const sel = $('tx-account'), m = $('tx-method').value, cur = sel.value;
  const list = state.accounts.filter(a => m === 'voucher' ? uxIsVoucherAcc(a) : !uxIsVoucherAcc(a));
  sel.innerHTML = list.map(a => `<option value="${esc(a.id)}">${uxIsVoucherAcc(a) ? '🎟️ ' : ''}${esc(a.name)} (${money(a.balance)})</option>`).join('');
  if (list.some(a => a.id === cur)) sel.value = cur;
}
function sourceFields() {
  const card = $('tx-method').value === 'card';
  $('tx-account-wrap').classList.toggle('hidden', card); $('tx-card-wrap').classList.toggle('hidden', !card);
  $('fuel-extra').classList.toggle('hidden', $('tx-category').value.toLowerCase() !== 'fuel');
  uxRebuildTxAccount();
}
function uxMethodOptions(force) {
  const sel = $('tx-method'); if (!sel) return;
  const has = sel.querySelector('option[value="voucher"]'), editing = $('tx-edit-id') && $('tx-edit-id').value && sel.value === 'voucher';
  const need = force || editing || state.accounts.some(a => uxIsVoucherAcc(a) && num(a.balance) > 0.005);
  if (need && !has) sel.insertAdjacentHTML('beforeend', '<option value="voucher">🎟️ Voucher balance</option>');
  if (!need && has) { if (sel.value === 'voucher') { sel.value = 'account'; sourceFields(); } has.remove(); }
}
function uxVoucherInfo(a) {
  const spentTx = state.transactions.filter(t => t.type === 'expense' && t.accountId === a.id).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const spent = spentTx.reduce((s, t) => s + t.amount, 0), plan = uxPlans().find(p => p.accId === a.id), balance = Math.max(0, num(a.balance));
  return { a, spentTx, spent, plan, balance, face: plan ? plan.price : balance + spent };
}
function renderVouchers() {
  let box = $('vouchers-box');
  if (!box) {
    box = document.createElement('div'); box.id = 'vouchers-box';
    const anchor = $('installments-box') || $('payments-box') || $('loans-box'); if (anchor) $('view-accounts').insertBefore(box, anchor); else $('view-accounts').appendChild(box);
    box.addEventListener('click', e => { const r = e.target.closest('[data-voucher]'); if (r) uxVoucherDetail(r.dataset.voucher); });
  }
  const vs = state.accounts.filter(uxIsVoucherAcc).map(uxVoucherInfo);
  if (!vs.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section-heading"><h2>🎟️ Vouchers</h2><span>${money(vs.reduce((s, v) => s + v.balance, 0))} to spend</span></div><section class="panel">${vs.map(v => { const pct = v.face > 0 ? Math.min(100, v.spent / v.face * 100) : 0, owe = v.plan && !v.plan.done ? ' · ' + money(v.plan.remaining) + ' still to pay' : ''; return `<div class="account-row plan-row" data-voucher="${esc(v.a.id)}"><div class="plan-main"><b>🎟️ ${esc(v.a.name)}</b><small>Value ${money(v.face)} · used ${money(v.spent)}${owe}</small><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></div><div class="plan-amt"><strong class="pos">${money(v.balance)}</strong><small>available</small></div></div>`; }).join('')}</section>`;
}
function uxVoucherDetail(id) {
  const a = state.accounts.find(x => x.id === id); if (!a) return;
  const v = uxVoucherInfo(a), plan = v.plan;
  const hist = v.spentTx.slice(0, 12).map(t => `<div class="lh"><span>${catIcon(t.category)} ${esc(t.category)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}<small>${esc(String(t.date).slice(0, 10))}${t.product || t.note ? ' · ' + esc(t.product || t.note) : ''}</small></span><b class="neg">−${money(t.amount)}</b></div>`).join('') || '<p class="empty">Nothing spent from this voucher yet.</p>';
  uxSheet(`<div class="sheet-ic">🎟️</div><h3>${esc(a.name)}</h3><div class="sheet-amt income">${money(v.balance)}</div><p>available to spend<br>Value ${money(v.face)} · used ${money(v.spent)}${plan ? '<br>' + (plan.done ? 'Fully paid ✓' : money(plan.remaining) + ' still to pay (' + plan.paidCount + ' of ' + plan.count + ' paid)') : ''}</p><div class="sheet-btns"><button data-do="spend">🛍️ Spend voucher</button>${plan && !plan.done ? `<button data-do="pay">💸 Pay ${money(Math.min(plan.next.amount, plan.remaining))}</button>` : ''}<button data-close>Close</button></div><h4 class="mini-title">Spent from this voucher</h4>${hist}`,
    (e, close) => { const d = e.target.closest('[data-do]')?.dataset.do; if (d === 'spend') { close(); uxSpendVoucher(id); } if (d === 'pay') { close(); uxInstPay(plan.id); } });
}
function uxSpendVoucher(id) {
  uxMethodOptions(true); resetTxForm(); $('tx-method').value = 'voucher'; sourceFields(); $('tx-account').value = id; switchView('add');
}
function uxHeroInst() {
  const hs = document.querySelector('.hero-stats'); if (!hs) return;
  const mk = (id, html, show) => { let el = $(id); if (!el) { el = document.createElement('span'); el.id = id; hs.appendChild(el); } el.style.display = show ? '' : 'none'; el.innerHTML = html; };
  const r = uxInstRemaining(), vt = uxVoucherTotal();
  mk('inst-stat', `Pay-later due <b>${money(r)}</b>`, r > 0.005);
  mk('voucher-stat', `Vouchers <b>${money(vt)}</b>`, vt > 0.005);
}
function uxVoucherSectionHTML(D) {
  if (!D.vouchers.length) return '';
  return `<h2 class="rp-sec">🎟️ Voucher balance</h2><table class="rp-t"><thead><tr><th>Voucher</th><th class="n">Spent</th><th class="n">Paid for it</th><th class="n">Balance</th><th class="n">To pay</th></tr></thead><tbody>${D.vouchers.map(v => `<tr><td>🎟️ ${esc(v.acc.name)}</td><td class="n">${money(v.spent)}</td><td class="n">${money(v.paidIn)}</td><td class="n pos-t">${money(Math.max(0, num(v.acc.balance)))}</td><td class="n ${v.plan && !v.plan.done ? 'neg-t' : ''}">${money(v.plan ? v.plan.remaining : 0)}</td></tr>`).join('')}</tbody></table><p class="rp-note">Things bought with a voucher are counted in the expense categories above. Money paid to settle a voucher is not counted as an expense, so nothing is counted twice.</p>`;
}
