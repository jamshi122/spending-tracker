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
const today = () => new Date().toISOString().slice(0,10);
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
UX.icons = { loan: '🤝', ...UX.icons };
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
    if (L.method) $('tx-method').value = L.method;
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
  $('tx-account').innerHTML = state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('');
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
  renderDashboard(); renderHistory(); renderAccounts(); renderLoans(); renderSelects(); renderBudgets(); renderAdmin(); uxForm();
  if (!UXS.restored && state.accounts.length) { uxRestoreLast(); UXS.restored = true; }
}

/* ---------- Rows & dashboard ---------- */
function txRow(t) {
  const inc = t.type === 'income';
  return `<div class="tx-row" data-view-tx="${esc(t.id)}"><div class="tx-icon">${catIcon(t.category)}</div><div class="tx-main"><b>${esc(t.category || t.type)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}</b><small>${esc(String(t.date).slice(0, 10))} · ${esc(t.product || t.note || '')}${t.receiptUrl ? ' · 📎' : ''}</small></div><strong class="${t.type}">${inc ? '+' : '−'}${money(t.amount)}</strong></div>`;
}
function renderDashboard() {
  const cash = state.accounts.reduce((s, a) => s + num(a.balance), 0);
  const debt = state.cards.reduce((s, c) => s + Math.max(0, num(c.balance)), 0);
  const recent = last30().filter(t => !isLoanTx(t));
  const LS = uxLoans(), loanOwe = LS.owe.reduce((s, p) => s + Math.max(0, p.total), 0), loanLent = LS.lent.reduce((s, p) => s + Math.max(0, p.total), 0);
  const income = recent.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = recent.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  $('net-worth').textContent = money(cash - debt - loanOwe + loanLent);
  let ls = $('loan-stat'); if (!ls) { ls = document.createElement('span'); ls.id = 'loan-stat'; document.querySelector('.hero-stats').appendChild(ls); }
  ls.innerHTML = `Loans (net) <b>${loanLent - loanOwe < 0 ? '−' : ''}${money(Math.abs(loanLent - loanOwe))}</b>`; $('cash-total').textContent = money(cash); $('debt-total').textContent = money(debt);
  $('income-total').textContent = money(income); $('expense-total').textContent = money(expense); $('saved-total').textContent = money(income - expense);
  $('dashboard-cards').innerHTML = state.cards.length ? state.cards.map(c => {
    const owed = Math.max(0, num(c.balance)), lim = num(c.limit), avail = Math.max(0, lim - owed);
    const pct = lim > 0 ? Math.min(100, owed / lim * 100) : 0;
    const ow = userName(c.owner), owner = ow === '—' ? (c.owner || '') : ow;
    return `<article class="credit-card" style="--card-color:${esc(c.color || '#334155')}"><div class="card-top"><span>💳 ${esc(c.name)}</span><span>•••• ${esc(c.last4 || '')}</span></div><div class="card-balance ${owed > 0 ? 'liability' : ''}">${owed > 0 ? '−' : ''}${money(owed)}</div><small>You owe · ${esc(owner)}</small><div class="bar"><i style="width:${pct}%"></i></div><div class="card-limit">Available ${money(avail)} of ${money(lim)}</div></article>`;
  }).join('') : '<p class="empty">No credit cards added yet.</p>';
  const groups = {}; recent.filter(t => t.type === 'expense').forEach(t => { const k = t.category || 'Other'; groups[k] = (groups[k] || 0) + t.amount; });
  const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const ym = today().slice(0, 7), month = {};
  state.transactions.filter(t => t.type === 'expense' && String(t.date).startsWith(ym)).forEach(t => { month[t.category] = (month[t.category] || 0) + t.amount; });
  const rows = top.map(([k, v]) => `<div class="summary-row"><span>${catIcon(k)} ${esc(k)}</span><b>${money(v)}</b></div>`).join('');
  const buds = state.budgets.map(b => {
    const sp = month[b.category] || 0, amt = num(b.amount), pct = amt > 0 ? Math.min(100, sp / amt * 100) : 0;
    return `<div class="bud"><div class="summary-row"><span>${catIcon(b.category)} ${esc(b.category)} budget</span><b>${money(sp)} / ${money(amt)}</b></div><div class="bar ${sp > amt ? 'over' : ''}"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  $('category-summary').innerHTML = (rows || '<p class="empty">No expenses in the last 30 days.</p>') + (buds ? '<h3 class="mini-title">Budgets this month</h3>' + buds : '');
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
  const data = { date: $('tx-date').value, type, amount, category: $('tx-category').value, subcategory: $('tx-subcategory').value, product: $('tx-product').value.trim(), note: $('tx-note').value.trim(), accountId: method === 'account' ? $('tx-account').value : '', cardId: method === 'card' ? $('tx-card').value : '', isPrivate: $('tx-private').checked };
  if (!data.category) return toast('Choose a category.', 'error');
  if ((method === 'account' && !data.accountId) || (method === 'card' && !data.cardId)) return toast('Select an account or card.', 'error');
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
      $('tx-private').checked = tx.isPrivate; $('tx-method').value = tx.cardId ? 'card' : 'account'; sourceFields();
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
uxForm();

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
  uxSheet(`<h3>${M[0]}</h3><div class="lf"><label>Person</label><input id="lf-name" list="lf-names" value="${esc(name)}" placeholder="Name"><datalist id="lf-names">${names}</datalist></div><div class="lf"><label>Amount (QR)</label><input id="lf-amt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></div><div class="lf"><label>Date</label><input id="lf-date" type="date" value="${today()}"></div><div class="lf"><label>${M[1] === 'income' ? 'Money goes into' : 'Paid from'}</label><select id="lf-acc">${state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${money(a.balance)})</option>`).join('')}</select></div>${withRate ? '<div class="lf"><label>Interest % per year (optional)</label><input id="lf-rate" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"></div>' : ''}<div class="lf"><label>Note (optional)</label><input id="lf-note"></div><div class="sheet-btns"><button data-save="1" class="save-btn">Save</button><button data-close>Cancel</button></div>`,
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
