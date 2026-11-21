/**
 * Jamshi Solution – Spending Tracker
 * SECURE MODE: every request must carry a valid Google sign-in token.
 * Only emails listed in the Users sheet (plus the script owner) are allowed.
 *
 * Existing spreadsheet data is preserved. No sheets are created, reset or cleared.
 */

const CLIENT_ID = '686310480898-0aqo8gm4l53djgml96l5hirpq8vl4o90.apps.googleusercontent.com';
const MAX_RECEIPT_BASE64 = 12000000; // about 9 MB image

const SHEETS = {
  TX: 'Transactions', ACC: 'Accounts', CARD: 'CreditCards',
  PAY: 'CardPayments', FUEL: 'FuelLog', CAT: 'Categories',
  USER: 'Users', BUDGET: 'Budgets'
};

const HEADERS = {
  TX: ['id','date','type','amount','category','subcategory','product','note','accountId','cardId','userId','fuelId','createdAt','receiptUrl','isPrivate'],
  ACC: ['id','name','type','owner','balance','currency'],
  CARD: ['id','name','last4','owner','limit','balance','dueDay','color'],
  PAY: ['id','date','cardId','accountId','amount','note','userId'],
  FUEL: ['id','date','cardId','accountId','userId','vehicle','odometer','liters','pricePerLiter','total','fullTank','note','receiptUrl'],
  CAT: ['id','name','parentId','type','icon','color','sortOrder'],
  USER: ['id','name','color','role','email'],
  BUDGET: ['id','category','amount','period','userId']
};

/* ================= API ENTRY POINTS ================= */

function doGet() {
  return json({ success: true, message: 'Jamshi Spending Tracker API is ready. Sign-in required.' });
}

function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ success: false, error: 'Empty request.' });

    const body = JSON.parse(e.postData.contents);
    const action = String(body.action || '');
    if (!action) return json({ success: false, error: 'Missing action.' });

    // Every action, including reading data, needs a verified, approved Google account.
    const user = authenticate_(body.accessToken);

    if (action === 'getData') return getData_(user, body.version);

    lock = LockService.getScriptLock();
    lock.waitLock(20000);

    let result;
    switch (action) {
      case 'addTx':           result = addTx_(user, body.data); break;
      case 'updateTx':        result = updateTx_(user, body.id, body.data); break;
      case 'deleteTx':        result = deleteTx_(user, body.id); break;
      case 'addCard':         requireAdmin_(user); result = addRow_('CARD', body.data); break;
      case 'addAccount':      requireAdmin_(user); result = addRow_('ACC', body.data); break;
      case 'addPayment':      result = addPayment_(user, body.data); break;
      case 'addFuel':         result = addFuel_(user, body.data); break;
      case 'addUser':         requireAdmin_(user); result = addUser_(body.data); break;
      case 'addCategory':     requireAdmin_(user); result = addRow_('CAT', body.data); break;
      case 'deleteCategory':  requireAdmin_(user); result = deleteRow_('CAT', body.id); break;
      case 'saveBudget':      result = saveBudget_(user, body.data); break;
      case 'deleteBudget':    result = deleteBudget_(user, body.id); break;
      case 'uploadReceipt':   result = uploadReceipt_(user, body.data); break;
      case 'rebuildBalances':
        requireAdmin_(user);
        result = { success: false, error: 'Automatic balance rebuilding is disabled to protect existing opening balances.' };
        break;
      case 'resetCategories':
        requireAdmin_(user);
        result = { success: false, error: 'Category reset is disabled to protect existing data.' };
        break;
      default:
        result = { success: false, error: 'Unknown or unsupported action.' };
    }

    if (result && result.success) bumpDataVersion_();
    return json(result || { success: false, error: 'No result returned.' });

  } catch (err) {
    if (err && err.authRequired) return json({ success: false, authRequired: true, error: err.message });
    console.error(err && err.stack ? err.stack : err);
    return json({ success: false, error: safeError_(err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignored) {} }
  }
}

/* ================= AUTHENTICATION ================= */

function authError_(message) {
  const err = new Error(message);
  err.authRequired = true;
  return err;
}

// Verifies the Google access token with Google, checks it was issued to THIS app,
// then looks the verified email up in the Users sheet.
function authenticate_(token) {
  token = String(token || '');
  if (!token) throw authError_('Please sign in with Google.');

  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  const cacheKey = 'a_' + Utilities.base64EncodeWebSafe(digest).slice(0, 40);
  let email = cache.get(cacheKey);

  if (!email) {
    let response;
    try {
      response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    } catch (err) {
      throw new Error('Could not verify your sign-in. Please try again.');
    }
    if (response.getResponseCode() !== 200) throw authError_('Your sign-in expired. Please sign in again.');
    const info = JSON.parse(response.getContentText());
    if (info.aud !== CLIENT_ID && info.azp !== CLIENT_ID) throw authError_('This sign-in was not issued for this app.');
    if (!info.email || String(info.email_verified) !== 'true') throw authError_('Your Google email could not be verified.');
    email = String(info.email).trim().toLowerCase();
    const ttl = Math.max(30, Math.min(600, Number(info.expires_in || 600) - 30));
    cache.put(cacheKey, email, ttl);
  }

  const user = findUserByEmail_(email);
  if (user) return user;

  // The script owner is always allowed (prevents locking yourself out).
  const owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (owner && owner === email) return ownerUser_(email);

  throw authError_('This Google account is not approved for this tracker.');
}

function userFromRow_(headers, row, email) {
  const col = name => headers.indexOf(name);
  return {
    id: String(row[col('id')] || 'u1'),
    name: String(row[col('name')] || 'User'),
    color: col('color') >= 0 ? String(row[col('color')] || '#007aff') : '#007aff',
    role: String(row[col('role')] || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user',
    email: email
  };
}

function findUserByEmail_(email) {
  const values = getSheet_('USER').getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0].map(h => String(h).trim().toLowerCase());
  const emailIndex = headers.indexOf('email');
  if (emailIndex < 0) return null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][emailIndex] || '').trim().toLowerCase() === email) return userFromRow_(headers, values[i], email);
  }
  return null;
}

function ownerUser_(email) {
  const values = getSheet_('USER').getDataRange().getValues();
  if (values.length > 1) {
    const headers = values[0].map(h => String(h).trim().toLowerCase());
    const roleIndex = headers.indexOf('role');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][roleIndex] || '').trim().toLowerCase() === 'admin') {
        const u = userFromRow_(headers, values[i], email);
        u.role = 'admin';
        return u;
      }
    }
  }
  return { id: 'owner', name: 'Owner', color: '#007aff', role: 'admin', email: email };
}

function requireAdmin_(user) {
  if (!user || user.role !== 'admin') throw new Error('Administrator permission required.');
}

function canAccessRecord_(user, recordUserId) {
  return user.role === 'admin' || String(recordUserId || '') === String(user.id);
}

/* ================= FAST DATA SYNC ================= */

function getData_(user, requestedVersion) {
  try {
    const version = getDataVersion_();
    if (requestedVersion !== undefined && requestedVersion !== null && String(requestedVersion) === String(version)) {
      return json({ success: true, unchanged: true, version: version, user: publicUser_(user) });
    }

    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const result = {};
    Object.keys(SHEETS).forEach(key => {
      const values = getSheet_(key).getDataRange().getValues();
      if (!values.length) { result[key] = []; return; }
      const headers = values[0].map(h => String(h).trim());
      result[key] = values.slice(1)
        .filter(row => row.some(v => v !== '' && v !== null))
        .map(row => {
          const item = {};
          headers.forEach((header, index) => {
            const value = row[index];
            item[header] = value instanceof Date ? Utilities.formatDate(value, tz, 'yyyy-MM-dd') : value;
          });
          return item;
        });
    });

    result.TX = result.TX.filter(tx => user.role === 'admin' || !isPrivate_(tx.isPrivate) || String(tx.userId || '') === String(user.id));
    result.PAY = result.PAY.filter(item => canAccessRecord_(user, item.userId));
    result.FUEL = result.FUEL.filter(item => canAccessRecord_(user, item.userId));
    result.BUDGET = result.BUDGET.filter(item => canAccessRecord_(user, item.userId));

    result.USER = user.role === 'admin'
      ? result.USER.map(item => ({ id: item.id, name: item.name, color: item.color, role: item.role, email: item.email || '' }))
      : [];

    return json({ success: true, unchanged: false, version: version, user: publicUser_(user), data: result });
  } catch (err) {
    return json({ success: false, error: safeError_(err) });
  }
}

function publicUser_(user) {
  return { id: user.id, name: user.name, color: user.color, role: user.role };
}

function getDataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '1';
}

function bumpDataVersion_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_VERSION', String(Number(props.getProperty('DATA_VERSION') || 1) + 1));
}

/* ================= SHEET HELPERS ================= */

function getSheet_(key) {
  const name = SHEETS[key];
  if (!name) throw new Error('Unknown sheet key: ' + key);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Required sheet not found: ' + name + '. No sheet was created or reset.');
  return sheet;
}

function addRow_(key, data) {
  if (!data || typeof data !== 'object') return { success: false, error: 'Invalid record.' };
  const sheet = getSheet_(key), headers = HEADERS[key], id = String(data.id || Utilities.getUuid());
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    if (ids.some(row => String(row[0]) === id)) return { success: true, duplicate: true };
  }
  sheet.appendRow(headers.map(header => header === 'id' ? id : data[header] !== undefined ? data[header] : ''));
  return { success: true };
}

function deleteRow_(key, id) {
  const sheet = getSheet_(key), values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) { sheet.deleteRow(i + 1); return { success: true }; }
  }
  return { success: false, error: 'Record not found.' };
}

function findRow_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return { rowNumber: i + 1, values: values[i], headers: values[0] };
  }
  return null;
}

/* ================= BALANCE HELPERS ================= */

function adjustBalance_(type, id, delta) {
  if (!id) return;
  const key = type === 'card' ? 'CARD' : 'ACC', sheet = getSheet_(key), values = sheet.getDataRange().getValues();
  const balanceColumn = type === 'card' ? 6 : 5;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      const oldBalance = Number(values[i][balanceColumn - 1]) || 0;
      sheet.getRange(i + 1, balanceColumn).setValue(oldBalance + delta);
      return;
    }
  }
  throw new Error('Account or credit card not found.');
}

function applyTxEffect_(type, amount, accountId, cardId, multiplier) {
  const value = (Number(amount) || 0) * multiplier;
  if (type === 'expense') {
    if (cardId) adjustBalance_('card', cardId, value);
    else if (accountId) adjustBalance_('account', accountId, -value);
  } else if (type === 'income' && accountId) adjustBalance_('account', accountId, value);
}

function isPrivate_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

/* ================= TRANSACTIONS ================= */

function addTx_(user, data) {
  if (!data || !data.id || !data.date || !data.type) return { success: false, error: 'Transaction details are incomplete.' };
  const sheet = getSheet_('TX');
  if (findRow_(sheet, data.id)) return { success: true, duplicate: true };
  const ownerId = user.role === 'admin' && data.userId ? String(data.userId) : user.id;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Enter a valid transaction amount.' };
  if (!['expense', 'income'].includes(String(data.type))) return { success: false, error: 'Invalid transaction type.' };
  sheet.appendRow([
    data.id, data.date, data.type, amount, data.category || '', data.subcategory || '', data.product || '',
    data.note || '', data.accountId || '', data.cardId || '', ownerId, data.fuelId || '', new Date().toISOString(),
    data.receiptUrl || '', isPrivate_(data.isPrivate) ? 'true' : 'false'
  ]);
  applyTxEffect_(data.type, amount, data.accountId, data.cardId, 1);
  return { success: true };
}

function updateTx_(user, id, data) {
  if (!data || typeof data !== 'object') return { success: false, error: 'Invalid transaction data.' };
  const sheet = getSheet_('TX'), found = findRow_(sheet, id);
  if (!found) return { success: false, error: 'Transaction not found.' };
  const old = found.values, h = found.headers.map(x => String(x).trim()), index = name => h.indexOf(name);
  if (!canAccessRecord_(user, old[index('userId')])) throw new Error('You cannot edit another user’s transaction.');
  applyTxEffect_(old[index('type')], old[index('amount')], old[index('accountId')], old[index('cardId')], -1);
  const updated = old.slice();
  ['date','type','amount','category','subcategory','product','note','accountId','cardId','receiptUrl'].forEach(field => {
    const i = index(field); if (i >= 0 && data[field] !== undefined) updated[i] = data[field];
  });
  const privateIndex = index('isPrivate');
  if (privateIndex >= 0 && data.isPrivate !== undefined) updated[privateIndex] = isPrivate_(data.isPrivate) ? 'true' : 'false';
  sheet.getRange(found.rowNumber, 1, 1, updated.length).setValues([updated]);
  applyTxEffect_(updated[index('type')], updated[index('amount')], updated[index('accountId')], updated[index('cardId')], 1);
  return { success: true };
}

function deleteTx_(user, id) {
  const sheet = getSheet_('TX'), found = findRow_(sheet, id);
  if (!found) return { success: false, error: 'Transaction not found.' };
  const old = found.values, h = found.headers.map(x => String(x).trim()), index = name => h.indexOf(name);
  if (!canAccessRecord_(user, old[index('userId')])) throw new Error('You cannot delete another user’s transaction.');
  applyTxEffect_(old[index('type')], old[index('amount')], old[index('accountId')], old[index('cardId')], -1);
  const fuelId = old[index('fuelId')]; sheet.deleteRow(found.rowNumber);
  if (fuelId) deleteRowById_('FUEL', fuelId);
  return { success: true };
}

function deleteRowById_(key, id) {
  const sheet = getSheet_(key), found = findRow_(sheet, id);
  if (found) sheet.deleteRow(found.rowNumber);
}

/* ================= CREDIT CARD PAYMENTS ================= */

function addPayment_(user, data) {
  if (!data || !data.cardId || !data.amount) return { success: false, error: 'Payment details are incomplete.' };
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Enter a valid payment amount.' };
  const ownerId = user.role === 'admin' && data.userId ? String(data.userId) : user.id;
  const sheet = getSheet_('PAY'), id = String(data.id || Utilities.getUuid());
  if (findRow_(sheet, id)) return { success: true, duplicate: true };
  sheet.appendRow([id, data.date || '', data.cardId, data.accountId || '', amount, data.note || '', ownerId]);
  adjustBalance_('card', data.cardId, -amount);
  if (data.accountId) adjustBalance_('account', data.accountId, -amount);
  return { success: true };
}

/* ================= FUEL RECORDS ================= */

function addFuel_(user, data) {
  if (!data || !data.date || !data.total) return { success: false, error: 'Fuel details are incomplete.' };
  const total = Number(data.total);
  if (!Number.isFinite(total) || total <= 0) return { success: false, error: 'Enter a valid fuel amount.' };
  const fuelId = String(data.id || Utilities.getUuid()), fuelSheet = getSheet_('FUEL');
  if (findRow_(fuelSheet, fuelId)) return { success: true, duplicate: true };
  fuelSheet.appendRow([
    fuelId, data.date, data.cardId || '', data.accountId || '', user.id, data.vehicle || '', data.odometer || '',
    data.liters || '', data.pricePerLiter || '', total, data.fullTank ? 'true' : 'false', data.note || '', data.receiptUrl || ''
  ]);
  getSheet_('TX').appendRow([
    Utilities.getUuid(), data.date, 'expense', total, 'Fuel', data.vehicle || '', data.liters ? '⛽ ' + data.liters + 'L' : '',
    data.note || '', data.accountId || '', data.cardId || '', user.id, fuelId, new Date().toISOString(),
    data.receiptUrl || '', isPrivate_(data.isPrivate) ? 'true' : 'false'
  ]);
  if (data.cardId) adjustBalance_('card', data.cardId, total);
  else if (data.accountId) adjustBalance_('account', data.accountId, -total);
  return { success: true, id: fuelId };
}

/* ================= USERS AND BUDGETS ================= */

function addUser_(data) {
  if (!data || !data.name || !data.email) return { success: false, error: 'Name and email are required.' };
  const sheet = getSheet_('USER'), values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim().toLowerCase()), emailIndex = headers.indexOf('email');
  if (emailIndex < 0) throw new Error('Email column is missing from the Users sheet.');
  const email = String(data.email).trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][emailIndex] || '').trim().toLowerCase() === email) return { success: false, error: 'That email is already registered.' };
  }
  const id = String(data.id || Utilities.getUuid());
  sheet.appendRow(headers.map(header => {
    if (header === 'id') return id;
    if (header === 'name') return data.name;
    if (header === 'color') return data.color || '#007aff';
    if (header === 'role') return data.role === 'admin' ? 'admin' : 'user';
    if (header === 'email') return email;
    return '';
  }));
  return { success: true };
}

function saveBudget_(user, data) {
  if (!data || !data.category) return { success: false, error: 'Budget category is required.' };
  const ownerId = user.role === 'admin' && data.userId ? String(data.userId) : user.id;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount < 0) return { success: false, error: 'Enter a valid budget amount.' };
  const sheet = getSheet_('BUDGET'), values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) === String(data.category) && String(values[i][4] || '') === ownerId) {
      sheet.getRange(i + 1, 3).setValue(amount);
      if (values[i][3] !== (data.period || 'monthly')) sheet.getRange(i + 1, 4).setValue(data.period || 'monthly');
      return { success: true };
    }
  }
  sheet.appendRow([data.id || Utilities.getUuid(), data.category, amount, data.period || 'monthly', ownerId]);
  return { success: true };
}

function deleteBudget_(user, id) {
  const sheet = getSheet_('BUDGET'), found = findRow_(sheet, id);
  if (!found) return { success: false, error: 'Budget not found.' };
  if (!canAccessRecord_(user, found.values[4])) throw new Error('You cannot delete another user’s budget.');
  sheet.deleteRow(found.rowNumber);
  return { success: true };
}

/* ================= PRIVATE RECEIPT UPLOAD ================= */

function getReceiptsFolder_() {
  const props = PropertiesService.getScriptProperties(), folderId = props.getProperty('RECEIPTS_FOLDER_ID');
  if (folderId) { try { return DriveApp.getFolderById(folderId); } catch (ignored) {} }
  const folder = DriveApp.createFolder('Jamshi_Receipts_' + SpreadsheetApp.getActiveSpreadsheet().getId().slice(-6));
  props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

function uploadReceipt_(user, data) {
  if (!data || !data.base64) return { success: false, error: 'No receipt file was supplied.' };
  if (String(data.base64).length > MAX_RECEIPT_BASE64) return { success: false, error: 'Receipt image is too large.' };
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(data.base64), data.mimeType || 'application/octet-stream', data.name || 'receipt');
    const file = getReceiptsFolder_().createFile(blob);
    // Private: only the owner and approved users can open it (no "anyone with the link").
    const values = getSheet_('USER').getDataRange().getValues(), headers = values[0].map(h => String(h).trim().toLowerCase());
    const emailIndex = headers.indexOf('email');
    if (emailIndex >= 0) {
      values.slice(1).forEach(row => {
        const email = String(row[emailIndex] || '').trim();
        if (email) { try { file.addViewer(email); } catch (ignored) {} }
      });
    }
    return { success: true, url: file.getUrl(), fileId: file.getId() };
  } catch (err) {
    return { success: false, error: safeError_(err) };
  }
}

/* ================= ONE-TIME SETUP HELPERS (run from the editor) ================= */

// Run this ONCE after pasting new code. It asks Google for every permission the script needs.
function authorizeNow() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  DriveApp.getRootFolder().getName();
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=test', { muteHttpExceptions: true });
  Session.getEffectiveUser().getEmail();
  ScriptApp.getProjectTriggers();
  console.log('Authorized OK');
}

// Optional: run ONCE to get an automatic daily copy of your sheet in Drive (keeps the last 14).
function setupDailyBackup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyBackup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create();
  dailyBackup();
}

function dailyBackup() {
  const props = PropertiesService.getScriptProperties(), ss = SpreadsheetApp.getActiveSpreadsheet();
  let folder = null, id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (ignored) {} }
  if (!folder) { folder = DriveApp.createFolder('Jamshi_Backups_' + ss.getId().slice(-6)); props.setProperty('BACKUP_FOLDER_ID', folder.getId()); }
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy('Backup ' + stamp, folder);
  const files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(14).forEach(f => f.setTrashed(true));
}

/* ================= RESPONSE HELPERS ================= */

function safeError_(err) {
  const message = err && err.message ? err.message : String(err || 'Unknown error');
  return message.substring(0, 300);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
