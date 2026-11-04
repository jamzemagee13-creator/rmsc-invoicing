# RMSC Invoicing

Invoices, quotes, customers and vehicle history for **RM Service Centre**.
It works on a phone or a computer, installs to the home screen like a normal app, and keeps working with no signal.

## What it does

- **Invoices and quotes**: labour, parts, flat-rate and callout lines; VAT at 0%, 5% or 20%; a tick-list of work carried out; notes.
- **Turn a quote into an invoice** with one tap.
- **Paid / overdue tracking**: record full or part payments (cash, card, transfer…). Unpaid invoices past their due date show as **Overdue**.
- **Vehicle history**: type a reg and it shows previous visits, mileage and the owner, and can fill in the details for you.
- **Customers**: call, text or email from the app, and see what each customer owes.
- **Send / share PDF**: on a phone this opens the share menu (WhatsApp, text, email…). On a computer it downloads the PDF. Print also works.
- **Price list**: save common parts and jobs with their prices and add them with one tap.
- **Backup / restore** to a file (save it to OneDrive, Google Drive or email), plus a CSV export for Excel or an accountant.
- Optional automatic emails through EmailJS (see Settings → Email).

## Putting it online with GitHub Pages (free)

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Click **New repository**, name it, for example `rmsc-invoicing`, and choose **Public**. (Free GitHub Pages needs a public repo. Only the app's code goes there; no customer data ever does.)
3. Click **uploading an existing file**, then drag in **everything inside this folder** (`index.html`, `sw.js`, `manifest.webmanifest`, `migrate-old-data.html`, `README.md`, and the `css`, `js` and `icons` folders). Click **Commit changes**.
4. In the **repository** (not your account settings), click the **Settings** tab at the top right of the repo, then **Pages** in the left menu. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. After a minute or two the app is live at `https://YOUR-USERNAME.github.io/rmsc-invoicing/`.

### Installing it on a phone

- **Android (Chrome):** open the link, then tap **Install** on the banner, or use the ⋮ menu → **Install app**.
- **iPhone (Safari):** open the link, tap the **Share** button, then **Add to Home Screen**.

### Updating the app later

Upload the changed files to the same repository. When the phone is online it picks up the new version and shows **"A new version is ready – Update"**.
If you change files, also change the `VERSION` line at the top of `sw.js` (for example `rmsc-v2.0.1`) so the offline copy is refreshed.

## Where the data lives (important)

All invoices and customers are saved **on the device itself** (in the browser's storage). That means:

- The phone and the computer each have their **own** copy. They don't sync automatically yet.
- Clearing the browser's data or uninstalling the app **deletes the invoices on that device**.
- **Back up regularly:** Settings → Backup → **Save backup**. On a phone, pick **OneDrive** (or Drive or email) in the share menu.
- To move everything to another device: save a backup on the old one, then use **Restore backup** on the new one.

The Home screen shows a reminder if there's been no backup for 2 weeks.

## Moving data from the old single-file app

If the new app is opened in the same browser where the old `RMSC Invoicing.html` was used, it may pick the data up by itself. Otherwise:

1. Copy `migrate-old-data.html` into the same folder as the old `RMSC Invoicing.html`.
2. Open it in the same browser the old app was used in, then tap **Save backup file**.
3. In the new app, go to **Settings → Backup → Restore backup** and choose that file.

## Possible next steps

- **Automatic sync between phone and computer**, for example through a OneDrive account using Microsoft's free sign-in. All the app's data is already kept as one bundle, which makes this straightforward to add.
- Reminders for MOT or service due dates, using the mileage and dates already recorded.
- Photos of the job attached to an invoice.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app page |
| `css/app.css` | Look and layout |
| `js/app.js` | All the app logic |
| `js/logo.js` | The default logo (you can change it in Settings) |
| `sw.js` | Makes it work offline |
| `manifest.webmanifest`, `icons/` | Lets it install as an app |
| `migrate-old-data.html` | One-off helper to move data from the old app |
