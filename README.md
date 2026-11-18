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



## Files

| File          | Purpose                          |
|---------------|----------------------------------|
| `index.html`  | UI structure                     |
| `app.js`      | All frontend logic               |
| `style.css`   | Styles + dark mode               |
| `appscript.gs`| Backend (paste into Apps Script) |
| `README.md`   | This file                        |
