/* Jamshi Solution – Spending Tracker | secure frontend */
'use strict';

const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxhJXudubUWPaHt62mcnx1yl0JpAWJOBv4dszwo6caBJPUiB-dTHzgdTXFCrhvAZC5m/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1syWFz8Gx_0yRmREAFBqyrSDCsladhzS5_-RmcIzvJbY/edit?gid=1251417057#gid=1251417057';
const GOOGLE_CLIENT_ID = '686310480898-0aqo8gm4l53djgml96l5hirpq8vl4o90.apps.googleusercontent.com';
const CURRENCY = 'QR';

const state = {
  accessToken: null, user: null,
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

function showGate(message='Sign in with your registered email and password.') {
  $('login-gate').classList.remove('hidden'); $('app-shell').classList.add('hidden');
  $('login-message').textContent=message;
}
function showApp() { $('login-gate').classList.add('hidden'); $('app-shell').classList.remove('hidden'); }

async function api(action, payload={}) {
  const response = await fetch(BACKEND_URL, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,accessToken:state.accessToken,...payload})
  });
  const result=await response.json();
  if (result.authRequired) { state.accessToken=null; showGate(result.error||'Please sign in again.'); throw new Error(result.error||'Authentication required.'); }
  if (!result.success) throw new Error(result.error||'Request failed.');
  setStatus(true); return result;
}

async function signIn(ev) {
  ev?.preventDefault();
  const email=$('login-email').value.trim().toLowerCase();
  const password=$('login-password').value;
  if(!email||!password) return toast('Enter your email and password.','error');
  try {
    setBusy(true,'Signing in…');
    const r=await api('login',{email,password});
    state.accessToken=r.sessionToken;
    if(r.mustChangePassword){ $('password-change').classList.remove('hidden'); $('login-form').classList.add('hidden'); $('request-form').classList.add('hidden'); $('login-message').textContent='For security, create a new password before continuing.'; }
    else await loadData(true);
  } catch(e){toast(e.message,'error');} finally{setBusy(false);}
}
async function submitPasswordChange(ev){
  ev.preventDefault();
  const password=$('new-password').value, confirmPassword=$('confirm-password').value;
  if(password.length<10) return toast('Use at least 10 characters for your new password.','error');
  if(password!==confirmPassword) return toast('Passwords do not match.','error');
  try{setBusy(true,'Updating password…');await api('changePassword',{newPassword:password});$('password-change').classList.add('hidden');$('login-form').classList.remove('hidden');await loadData(true);toast('Password updated.','success');}
  catch(e){toast(e.message,'error');}finally{setBusy(false);}
}
async function requestAccess(ev){
  ev.preventDefault();
  const name=$('request-name').value.trim(), email=$('request-email').value.trim().toLowerCase();
  if(!name||!email) return toast('Enter your name and email.','error');
  try{setBusy(true,'Sending access request…');await api('requestAccess',{name,email});$('request-form').reset();toast('Request sent. The administrator will review it.','success');}
  catch(e){toast(e.message,'error');}finally{setBusy(false);}
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
  $('users-list').innerHTML=state.users.map(u=>{const pending=String(u.status||'ACTIVE').toUpperCase()==='PENDING';return `<div class="summary-row"><span>${esc(u.name)} <small>${esc(u.email||'')} · ${esc(u.role||'user')} · ${esc(u.status||'ACTIVE')}</small></span><span><button class="small-btn" data-temp-user="${esc(u.id)}">${pending?'Approve & set password':'Set temporary password'}</button>${pending?` <button class="small-btn" data-reject-user="${esc(u.id)}">Reject</button>`:''}</span></div>`;}).join('');
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
  const name=prompt('User name:'); if(!name) return;
  const email=prompt('User email:'); if(!email) return;
  try{await api('addUser',{data:{name,email,role:'user'}});await loadData(true);toast('User created. Set a temporary password from the user list.','success');}
  catch(e){toast(e.message,'error');}
}
async function setTemporaryPassword(id){
  const user=state.users.find(u=>String(u.id)===String(id)); if(!user)return;
  const password=prompt(`Temporary password for ${user.name} (minimum 10 characters):`); if(!password)return;
  if(password.length<10)return toast('Use at least 10 characters.','error');
  try{await api('setTemporaryPassword',{id,password});await loadData(true);toast('Temporary password set. Share it with the user privately.','success');}
  catch(e){toast(e.message,'error');}
}
async function rejectAccessRequest(id){
  if(!confirm('Reject this access request?'))return;
  try{await api('rejectAccessRequest',{id});await loadData(true);toast('Access request rejected.','success');}
  catch(e){toast(e.message,'error');}
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
function signOut() { state.accessToken=null;state.user=null;state.version=null;$('login-password').value='';showGate('You have signed out. Sign in to continue.'); }

function bindEvents() {
  $('login-form').addEventListener('submit',signIn);
  $('password-change').addEventListener('submit',submitPasswordChange);
  $('request-form').addEventListener('submit',requestAccess);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-temp-user]');if(b)setTemporaryPassword(b.dataset.tempUser);const r=e.target.closest('[data-reject-user]');if(r)rejectAccessRequest(r.dataset.rejectUser);});
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

document.addEventListener('DOMContentLoaded',()=>{bindEvents();showGate();});
