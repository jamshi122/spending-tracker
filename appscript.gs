/**
 * Jamshi Solution – Spending Tracker
 * Google Apps Script backend (optimized & robust)
 *
 * SETUP:
 * 1. Create a new Google Sheet
 * 2. Extensions → Apps Script → paste this whole file
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL into app.js → BACKEND_URL
 * 5. Copy the Sheet URL into app.js → SHEET_URL
 */

const SHEETS = {
  TX: 'Transactions', ACC: 'Accounts', CARD: 'CreditCards',
  PAY: 'CardPayments', FUEL: 'FuelLog', CAT: 'Categories', USER: 'Users', BUDGET: 'Budgets'
};

const HEADERS = {
  TX: ['id','date','type','amount','category','subcategory','product',
       'note','accountId','cardId','userId','fuelId','createdAt','receiptUrl'],
  ACC: ['id','name','type','owner','balance','currency'],
  CARD: ['id','name','last4','owner','limit','balance','dueDay','color'],
  PAY: ['id','date','cardId','accountId','amount','note','userId'],
  FUEL: ['id','date','cardId','accountId','userId','vehicle',
         'odometer','liters','pricePerLiter','total','fullTank','note','receiptUrl'],
  CAT: ['id','name','parentId','type','icon','color','sortOrder'],
  USER: ['id','name','color','role'],          // role: admin | user
  BUDGET: ['id','category','amount','period','userId']
};

// ---------- Sheet helpers ----------
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else {
    // Ensure new columns exist (migration)
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers.forEach((h, i) => {
      if (existing[i] !== h) {
        // simple append missing columns at the end
        if (existing.indexOf(h) === -1) {
          sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
        }
      }
    });
  }
  return sheet;
}

function setupAllSheets() {
  Object.keys(SHEETS).forEach(k => getOrCreateSheet(SHEETS[k], HEADERS[k]));
  seedCategories();
}

function ensureSetup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_V3') === '1') return;
  setupAllSheets();
  props.setProperty('SETUP_V3', '1');
}

// ---------- Seed categories (rich set for Qatar) ----------
function seedCategories() {
  const sheet = getOrCreateSheet(SHEETS.CAT, HEADERS.CAT);
  if (sheet.getLastRow() > 1) return;

  const data = [
    // EXPENSE
    ['Fuel','', 'expense','⛽'],
    ['Petrol','Fuel','expense','⛽'],
    ['Diesel','Fuel','expense','🛢️'],
    ['Premium Fuel','Fuel','expense','🌟'],
    ['Car Wash','Fuel','expense','🚿'],

    ['Food & Dining','', 'expense','🍔'],
    ['Groceries','Food & Dining','expense','🛒'],
    ['Restaurants','Food & Dining','expense','🍽️'],
    ['Coffee','Food & Dining','expense','☕'],
    ['Delivery','Food & Dining','expense','🛵'],
    ['Bakery','Food & Dining','expense','🥖'],
    ['Snacks','Food & Dining','expense','🍿'],
    ['Water','Food & Dining','expense','💧'],

    ['Transportation','', 'expense','🚗'],
    ['Public Transit','Transportation','expense','🚇'],
    ['Taxi / Uber / Careem','Transportation','expense','🚕'],
    ['Parking','Transportation','expense','🅿️'],
    ['Car Maintenance','Transportation','expense','🔧'],
    ['Car Insurance','Transportation','expense','🛡️'],
    ['Car Registration','Transportation','expense','📋'],
    ['Traffic Fines','Transportation','expense','🚨'],
    ['Salik / Tolls','Transportation','expense','🛣️'],

    ['Housing','', 'expense','🏠'],
    ['Rent','Housing','expense','🔑'],
    ['Electricity (Kahramaa)','Housing','expense','⚡'],
    ['Water (Kahramaa)','Housing','expense','💧'],
    ['Internet','Housing','expense','📶'],
    ['Phone Bill','Housing','expense','📞'],
    ['Maintenance','Housing','expense','🔨'],
    ['Home Goods','Housing','expense','🛋️'],
    ['Furniture','Housing','expense','🪑'],

    ['Shopping','', 'expense','🛍️'],
    ['Clothing','Shopping','expense','👕'],
    ['Electronics','Shopping','expense','💻'],
    ['Personal Care','Shopping','expense','💄'],
    ['Books','Shopping','expense','📖'],
    ['Gifts','Shopping','expense','🎁'],
    ['Sports Equipment','Shopping','expense','⚽'],

    ['Entertainment','', 'expense','🎬'],
    ['Movies','Entertainment','expense','🎥'],
    ['Streaming','Entertainment','expense','📺'],
    ['Games','Entertainment','expense','🎮'],
    ['Events','Entertainment','expense','🎟️'],
    ['Hobbies','Entertainment','expense','🎨'],
    ['Malls / Outings','Entertainment','expense','🏬'],

    ['Health','', 'expense','💊'],
    ['Doctor','Health','expense','👨‍⚕️'],
    ['Hospital','Health','expense','🏥'],
    ['Pharmacy','Health','expense','💊'],
    ['Dental','Health','expense','🦷'],
    ['Health Insurance','Health','expense','🛡️'],
    ['Gym / Fitness','Health','expense','💪'],

    ['Education','', 'expense','📚'],
    ['Tuition','Education','expense','🎓'],
    ['Books & Supplies','Education','expense','📖'],
    ['Courses','Education','expense','💻'],
    ['School Fees','Education','expense','🏫'],

    ['Kids','', 'expense','👶'],
    ['Kids Clothing','Kids','expense','👕'],
    ['Toys','Kids','expense','🧸'],
    ['Kids Activities','Kids','expense','🎨'],
    ['Babysitter','Kids','expense','👩‍🍼'],
    ['Diapers / Formula','Kids','expense','🍼'],

    ['Travel','', 'expense','✈️'],
    ['Flights','Travel','expense','✈️'],
    ['Hotels','Travel','expense','🏨'],
    ['Visa / Passport','Travel','expense','🛂'],
    ['Travel Activities','Travel','expense','🎢'],
    ['Baggage','Travel','expense','🧳'],

    ['Bills & Subscriptions','', 'expense','📄'],
    ['Electricity Bill','Bills & Subscriptions','expense','⚡'],
    ['Water Bill','Bills & Subscriptions','expense','💧'],
    ['Gas','Bills & Subscriptions','expense','🔥'],
    ['Subscriptions','Bills & Subscriptions','expense','📱'],
    ['Insurance','Bills & Subscriptions','expense','🛡️'],
    ['Government Fees','Bills & Subscriptions','expense','🏛️'],

    ['Domestic Help','', 'expense','🧹'],
    ['Maid','Domestic Help','expense','🧹'],
    ['Driver','Domestic Help','expense','🚗'],
    ['Cook','Domestic Help','expense','👨‍🍳'],
    ['Gardener','Domestic Help','expense','🌿'],

    ['Charity','', 'expense','❤️'],
    ['Sadaqah','Charity','expense','🤲'],
    ['Zakat','Charity','expense','🕌'],
    ['Donations','Charity','expense','🎁'],

    ['Personal Care','', 'expense','💄'],
    ['Haircut','Personal Care','expense','💇'],
    ['Spa / Massage','Personal Care','expense','💆'],
    ['Cosmetics','Personal Care','expense','💅'],

    ['Other','', 'expense','📌'],
    ['Miscellaneous','Other','expense','❓'],
    ['Emergency','Other','expense','🚨'],
    ['Bank Fees','Other','expense','🏦'],

    // INCOME
    ['Salary','', 'income','💼'],
    ['Base Salary','Salary','income','💵'],
    ['Bonus','Salary','income','🎁'],
    ['Overtime','Salary','income','⏰'],
    ['End of Service','Salary','income','🏁'],

    ['Business','', 'income','🏢'],
    ['Sales','Business','income','💰'],
    ['Consulting','Business','income','💼'],
    ['Freelance','Business','income','💻'],

    ['Investments','', 'income','📈'],
    ['Dividends','Investments','income','📊'],
    ['Interest','Investments','income','💹'],
    ['Capital Gains','Investments','income','📈'],
    ['Stocks','Investments','income','📉'],

    ['Rental Income','', 'income','🏘️'],
    ['Property Rent','Rental Income','income','🏠'],

    ['Gifts','', 'income','🎁'],
    ['Cash Gift','Gifts','income','💵'],
    ['Inheritance','Gifts','income','📜'],

    ['Refunds & Cashback','', 'income','↩️'],
    ['Refund','Refunds & Cashback','income','↩️'],
    ['Cashback','Refunds & Cashback','income','💳'],

    ['Other Income','', 'income','💵']
  ];

  const idByName = {};
  data.forEach((c, i) => {
    const id = Utilities.getUuid();
    idByName[c[0]] = id;
    sheet.appendRow([id, c[0], '', c[2], c[3], '#007AFF', i]);
  });
  data.forEach((c, i) => {
    if (c[1]) {
      const parentId = idByName[c[1]];
      if (parentId) sheet.getRange(i + 2, 3).setValue(parentId);
    }
  });
}

// ---------- API entry points ----------
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    ensureSetup();

    if (action === 'addTx')           return addTx(body.data);
    if (action === 'updateTx')        return updateTx(body.id, body.data);
    if (action === 'deleteTx')        return deleteTx(body.id);
    if (action === 'addCard')         return addRow(SHEETS.CARD, body.data, HEADERS.CARD);
    if (action === 'addAccount')      return addRow(SHEETS.ACC, body.data, HEADERS.ACC);
    if (action === 'addPayment')      return addPayment(body.data);
    if (action === 'addFuel')         return addFuelTx(body.data);
    if (action === 'addUser')         return addRow(SHEETS.USER, body.data, HEADERS.USER);
    if (action === 'addCategory')     return addRow(SHEETS.CAT, body.data, HEADERS.CAT);
    if (action === 'deleteCategory')  return deleteRow(SHEETS.CAT, body.id);
    if (action === 'saveBudget')      return saveBudget(body.data);
    if (action === 'deleteBudget')    return deleteRow(SHEETS.BUDGET, body.id);
    if (action === 'rebuildBalances') return rebuildBalances();
    if (action === 'uploadReceipt')   return uploadReceipt(body.data);
    if (action === 'resetCategories') {
      const s = getOrCreateSheet(SHEETS.CAT, HEADERS.CAT);
      if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, HEADERS.CAT.length).clearContent();
      seedCategories();
      return json({ success: true });
    }
    return json({ success: false, error: 'unknown action' });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  try {
    ensureSetup();
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const result = {};
    Object.keys(SHEETS).forEach(k => {
      const sheet = getOrCreateSheet(SHEETS[k], HEADERS[k]);
      const data = sheet.getDataRange().getValues();
      if (data.length < 1) { result[k] = []; return; }
      const headers = data[0];
      result[k] = data.slice(1).map(row => {
        const o = {};
        headers.forEach((h, i) => {
          o[h] = (row[i] instanceof Date)
            ? Utilities.formatDate(row[i], tz, 'yyyy-MM-dd')
            : row[i];
        });
        return o;
      });
    });
    return json({ success: true, data: result });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  }
}

// ---------- Receipt upload to Drive ----------
function getReceiptsFolder() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('RECEIPTS_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  // Create once
  const folder = DriveApp.createFolder('Jamshi_Receipts_' + SpreadsheetApp.getActiveSpreadsheet().getId().slice(-6));
  props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

function uploadReceipt(data) {
  if (!data || !data.base64) return json({ success: false, error: 'no file data' });
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(data.base64), data.mimeType || 'application/octet-stream', data.name || 'receipt.jpg');
    const folder = getReceiptsFolder();
    const file = folder.createFile(blob);
    // Make viewable by link so family can open it
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return json({ success: true, url: file.getUrl(), fileId: file.getId() });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  }
}

// ---------- Helpers ----------
function addRow(sheetName, data, headers) {
  const sheet = getOrCreateSheet(sheetName, headers);
  if (data.id !== undefined && sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    if (ids.some(r => String(r[0]) === String(data.id))) return json({ success: true, duplicate: true });
  }
  sheet.appendRow(headers.map(h => data[h] !== undefined ? data[h] : ''));
  return json({ success: true });
}

function deleteRow(sheetName, id) {
  return deleteRowSilent(sheetName, id) ? json({ success: true }) : json({ success: false, error: 'not found' });
}

function adjustBalance(type, id, delta) {
  if (!id) return;
  const key = type === 'card' ? SHEETS.CARD : SHEETS.ACC;
  const col = type === 'card' ? 6 : 5; // balance column
  const sheet = getOrCreateSheet(key, HEADERS[type === 'card' ? 'CARD' : 'ACC']);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const newBal = parseFloat(rows[i][col - 1] || 0) + delta;
      sheet.getRange(i + 1, col).setValue(newBal);
      return;
    }
  }
}

function addTx(data) {
  const sheet = getOrCreateSheet(SHEETS.TX, HEADERS.TX);
  sheet.appendRow([
    data.id, data.date, data.type, data.amount,
    data.category, data.subcategory || '', data.product || '',
    data.note || '', data.accountId || '', data.cardId || '',
    data.userId || '', data.fuelId || '', new Date().toISOString(),
    data.receiptUrl || ''
  ]);
  const amt = parseFloat(data.amount);
  if (data.type === 'expense') {
    if (data.cardId) adjustBalance('card', data.cardId, amt);
    else if (data.accountId) adjustBalance('acc', data.accountId, -amt);
  } else if (data.type === 'income') {
    if (data.accountId) adjustBalance('acc', data.accountId, amt);
  }
  return json({ success: true });
}

function addFuelTx(data) {
  const fuelId = data.id || Utilities.getUuid();
  const fuelSheet = getOrCreateSheet(SHEETS.FUEL, HEADERS.FUEL);
  fuelSheet.appendRow([
    fuelId, data.date, data.cardId || '', data.accountId || '',
    data.userId || '', data.vehicle, data.odometer, data.liters,
    data.pricePerLiter, data.total, data.fullTank ? 'true' : 'false',
    data.note || '', data.receiptUrl || ''
  ]);
  const txSheet = getOrCreateSheet(SHEETS.TX, HEADERS.TX);
  txSheet.appendRow([
    Utilities.getUuid(), data.date, 'expense', data.total,
    'Fuel', data.vehicle, `⛽ ${data.liters}L @ QR ${data.pricePerLiter}`,
    data.note || '', data.accountId || '', data.cardId || '',
    data.userId || '', fuelId, new Date().toISOString(),
    data.receiptUrl || ''
  ]);
  const amt = parseFloat(data.total);
  if (data.cardId) adjustBalance('card', data.cardId, amt);
  else if (data.accountId) adjustBalance('acc', data.accountId, -amt);
  return json({ success: true, id: fuelId });
}

function addPayment(data) {
  const paySheet = getOrCreateSheet(SHEETS.PAY, HEADERS.PAY);
  paySheet.appendRow([
    data.id, data.date, data.cardId, data.accountId,
    data.amount, data.note || '', data.userId || ''
  ]);
  adjustBalance('card', data.cardId, -parseFloat(data.amount));
  if (data.accountId) adjustBalance('acc', data.accountId, -parseFloat(data.amount));
  return json({ success: true });
}

function rebuildBalances() {
  const cardSheet = getOrCreateSheet(SHEETS.CARD, HEADERS.CARD);
  const accSheet  = getOrCreateSheet(SHEETS.ACC, HEADERS.ACC);
  const txSheet   = getOrCreateSheet(SHEETS.TX, HEADERS.TX);
  const paySheet  = getOrCreateSheet(SHEETS.PAY, HEADERS.PAY);

  // reset
  const cards = cardSheet.getDataRange().getValues();
  for (let i = 1; i < cards.length; i++) cardSheet.getRange(i + 1, 6).setValue(0);
  const accs = accSheet.getDataRange().getValues();
  for (let i = 1; i < accs.length; i++) accSheet.getRange(i + 1, 5).setValue(0);

  // apply txs
  txSheet.getDataRange().getValues().slice(1).forEach(t => {
    const amt = parseFloat(t[3] || 0);
    if (t[2] === 'expense') {
      if (t[9]) adjustBalance('card', t[9], amt);
      else if (t[8]) adjustBalance('acc', t[8], -amt);
    } else if (t[2] === 'income' && t[8]) {
      adjustBalance('acc', t[8], amt);
    }
  });
  // apply payments
  paySheet.getDataRange().getValues().slice(1).forEach(p => {
    adjustBalance('card', p[2], -parseFloat(p[4] || 0));
    if (p[3]) adjustBalance('acc', p[3], -parseFloat(p[4] || 0));
  });
  return json({ success: true });
}

function applyTxEffect(type, amount, accountId, cardId, mult) {
  const amt = (parseFloat(amount) || 0) * mult;
  if (type === 'expense') {
    if (cardId) adjustBalance('card', cardId, amt);
    else if (accountId) adjustBalance('acc', accountId, -amt);
  } else if (type === 'income' && accountId) {
    adjustBalance('acc', accountId, amt);
  }
}

function updateTx(id, d) {
  const sheet = getOrCreateSheet(SHEETS.TX, HEADERS.TX);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(id)) continue;
    const old = rows[i];
    applyTxEffect(old[2], old[3], old[8], old[9], -1);

    // Keep original userId and fuelId; allow receiptUrl update
    const row = [
      old[0],
      d.date || old[1],
      d.type || old[2],
      d.amount,
      d.category,
      d.subcategory || '',
      d.product || '',
      d.note || '',
      d.accountId || '',
      d.cardId || '',
      old[10], // userId stays
      old[11], // fuelId stays
      old[12], // createdAt
      d.receiptUrl !== undefined ? d.receiptUrl : (old[13] || '')
    ];
    sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
    applyTxEffect(row[2], row[3], row[8], row[9], 1);
    return json({ success: true });
  }
  return json({ success: false, error: 'not found' });
}

function deleteTx(id) {
  const sheet = getOrCreateSheet(SHEETS.TX, HEADERS.TX);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(id)) continue;
    const old = rows[i];
    applyTxEffect(old[2], old[3], old[8], old[9], -1);
    sheet.deleteRow(i + 1);
    if (old[11]) deleteRowSilent(SHEETS.FUEL, old[11]);
    return json({ success: true });
  }
  return json({ success: false, error: 'not found' });
}

function deleteRowSilent(sheetName, id) {
  const key = Object.keys(SHEETS).find(k => SHEETS[k] === sheetName);
  const sheet = getOrCreateSheet(sheetName, HEADERS[key]);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function saveBudget(d) {
  const sheet = getOrCreateSheet(SHEETS.BUDGET, HEADERS.BUDGET);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(d.category) && String(rows[i][4] || '') === String(d.userId || '')) {
      sheet.getRange(i + 1, 3).setValue(parseFloat(d.amount) || 0);
      return json({ success: true });
    }
  }
  sheet.appendRow([
    d.id || Utilities.getUuid(),
    d.category,
    parseFloat(d.amount) || 0,
    d.period || 'monthly',
    d.userId || ''
  ]);
  return json({ success: true });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Manual helper: run from editor to reset categories
function resetCategories() {
  const s = getOrCreateSheet(SHEETS.CAT, HEADERS.CAT);
  if (s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow(), HEADERS.CAT.length).clearContent();
  }
  seedCategories();
  SpreadsheetApp.getActive().toast('✅ Categories reset to defaults!');
}
