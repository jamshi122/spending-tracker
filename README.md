# Jamshi Solution – Spending Tracker (Optimized)

## What’s new / fixed

### 1. Who made the transaction
- Every transaction stores `userId` of the person who created it.
- Dashboard, History and Edit modal all show **👤 Name** of the person who logged it.

### 2. Permissions & isolation
- Users have a **role**: `admin` or `user`.
- **Admin** (Husband by default) can:
  - See everything (“Both” view)
  - Switch between users
  - See the Google Sheet link
  - Manage categories & users
- **Regular users**:
  - Only see their own transactions, accounts and cards
  - Cannot delete or edit another person’s transactions
  - Cannot switch to another profile
  - Cannot see the Google Sheet link

### 3. Attach bills / receipts
- On Add / Edit form → “📎 Attach Bill / Receipt”
- Image or PDF (max 8 MB)
- File is uploaded to a private Google Drive folder created automatically by the script
- Link is stored on the transaction and shown in History / Edit modal

### 4. Only Admin sees Google Sheet
- The “Open Sheet” button is completely hidden for non-admin users.

### 5. Saving feels slow – now with clear feedback
- Global “Saving…” overlay with spinner
- Button shows “Saving…” and is disabled to prevent double-submit
- Toast messages for success / error
- Network timeout increased to 45 s

### 6. Bonus – Receipt text → categories
- Paste receipt text (or OCR output) into the box
- Click **Suggest Categories from Text**
- Keyword matching (Food, Clothing/Dress, Fuel, Taxi, Pharmacy…) suggests category + amount
- One-click “Use” fills the form

### 7. Robustness improvements
- Login / profile gate on first open
- Admin protected by PIN (default `1234` – change in `app.js`)
- Lock on backend prevents concurrent balance corruption
- Column migration for older sheets
- Clear error handling and status indicator
- Dark mode preserved
- All existing features kept (fuel efficiency, budgets, history grouping, etc.)

---

## How to deploy

1. Open your Google Sheet → **Extensions → Apps Script**
2. Delete old code and paste the full content of `appscript.gs`
3. Save → **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web App URL into `app.js` → `BACKEND_URL`
5. Copy the Sheet URL into `app.js` → `SHEET_URL`
6. Change `ADMIN_PIN` in `app.js` to something only you know
7. Host the three files (`index.html`, `app.js`, `style.css`) anywhere (GitHub Pages, Netlify, or even open `index.html` locally)

On first load the app will automatically create:
- Husband (admin) + Wife (user)
- Two bank accounts

---

## Important security note

Google Apps Script web apps that are set to “Anyone” are **not** cryptographically secure.  
Anyone who obtains the Web App URL can call the API.  

For a family tracker this is usually acceptable.  
If you need real multi-user security later, add Google Sign-In or move to a proper backend.

---

## Files

| File          | Purpose                          |
|---------------|----------------------------------|
| `index.html`  | UI structure                     |
| `app.js`      | All frontend logic               |
| `style.css`   | Styles + dark mode               |
| `appscript.gs`| Backend (paste into Apps Script) |
| `README.md`   | This file                        |
