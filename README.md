# ARS Store — Gemini AI Pro storefront starter

A responsive Node.js storefront inspired by the supplied screenshots. It includes:

- Bengali-first responsive product page and mobile sticky checkout bar
- Google sign-in using OAuth 2.0
- Binance Pay Create Order API integration (v3)
- Signed Binance Pay webhook verification before an order can become `paid`
- SQLite persistence for users, orders and sessions
- Private admin page for viewing orders and marking **paid** orders as fulfilled
- No collection or storage of Google passwords

This is a **starter project**, not a deployed/live store. Real Google login and Binance Pay require credentials from your own accounts and a publicly reachable HTTPS domain.

## Requirements

- Node.js 20 or newer
- A Google OAuth Web application client
- A Binance Pay merchant account with API access
- HTTPS and a persistent disk for production hosting

## Run locally

```bash
npm install
cp .env.example .env
```

Generate strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put one generated value in `SESSION_SECRET` and another in `ADMIN_TOKEN`. Edit `.env`, then run:

```bash
npm start
```

Open `http://localhost:3000`.

The product page is visible before credentials are configured, but Google login and payment will not work until you set them up.

## Deploy from GitHub to Railway

The repository includes `Dockerfile`, `railway.json`, and `/health` for Railway deployment. The app listens on Railway's `PORT` environment variable.

### 1. Push the project to GitHub

1. Extract the ZIP and create a new empty repository on GitHub.
2. Upload the project files to the repository root (including `Dockerfile` and `railway.json`).
3. Do **not** upload `.env`, API keys, Google client secrets, or a local SQLite database. `.gitignore` and `.dockerignore` exclude these.

You can also use Git locally:

```bash
git init
git add .
git commit -m "Prepare ARS Store for Railway"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

### 2. Create the Railway service

1. Sign in at [Railway](https://railway.com/).
2. Choose **New Project → Deploy from GitHub repo** and select the repository.
3. Railway should detect the included Dockerfile and build the app.
4. In the service settings, create a public domain under **Networking → Public Networking → Generate Domain**.
5. Open **Variables** and add the variables listed below.

### 3. Add a persistent volume

SQLite data must not live only in a disposable container filesystem. In Railway, add a Volume to this service and mount it at exactly:

```text
/data
```

Set `DB_PATH=/data/ars-store.sqlite` in Railway Variables. Without the volume, database contents can be lost when the service is redeployed or recreated.

### 4. Configure Railway Variables

Set these in Railway's service **Variables** panel. Generate long random values for the secrets.

```text
NODE_ENV=production
APP_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
DB_PATH=/data/ars-store.sqlite
SESSION_SECRET=YOUR_LONG_RANDOM_SECRET
ADMIN_TOKEN=ANOTHER_LONG_RANDOM_SECRET
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
PRODUCT_PRICE_BDT=350
PRODUCT_DURATION_MONTHS=18
SUPPORT_WHATSAPP_URL=https://wa.me/YOUR_FULL_INTERNATIONAL_NUMBER
BINANCE_PAY_API_KEY=your-binance-pay-api-key-or-certificate-sn
BINANCE_PAY_SECRET_KEY=your-binance-pay-secret
BINANCE_PAY_BASE_URL=https://bpay.binanceapi.com
```

Also configure **one** Binance amount mode after checking what your merchant account supports:

- Fiat mode: `BINANCE_PAY_FIAT_AMOUNT=350` and `BINANCE_PAY_FIAT_CURRENCY=BDT`, only if BDT is supported for your merchant account.
- Crypto mode: leave both fiat variables unset/empty and set `BINANCE_PAY_ORDER_AMOUNT` and `BINANCE_PAY_ORDER_CURRENCY` to the exact supported crypto amount/currency. Do not guess the conversion rate.

After changing `APP_URL` or Variables, redeploy the service if Railway does not automatically redeploy it.

### 5. Set the Google OAuth redirect URI

In Google Cloud Console, add this exact authorized redirect URI, replacing the example domain with your Railway public domain:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/auth/google/callback
```

The `APP_URL` origin must match the public Railway domain exactly, without a trailing path. The app's Google login will not work until these values match.

### 6. Configure Binance Pay webhook

Configure the merchant-side notification/webhook URL as:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/binance/webhook
```

The app creates Binance Pay orders server-side and uses a signed webhook to confirm payment. A successful redirect to the return page is not, by itself, proof of payment. Run a full test payment before taking real orders.

### 7. Check the deployment

- Visit `https://YOUR-RAILWAY-DOMAIN.up.railway.app/` for the storefront.
- Visit `https://YOUR-RAILWAY-DOMAIN.up.railway.app/health`; a healthy service returns `{"status":"ok"}`.
- Visit `/admin` and enter the `ADMIN_TOKEN` value to view orders.
- Check Railway **Deployments → Logs** if the build or start fails.

Never commit `.env` or paste secrets into GitHub issues, screenshots, or public logs.

## Google sign-in

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project and configure the OAuth consent screen.
3. Create an OAuth client with application type **Web application**.
4. Add this authorized redirect URI for local testing:

   `http://localhost:3000/auth/google/callback`

5. Put the client ID and client secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. For production, add the production callback URL in Google Cloud Console and set `APP_URL` to the exact public HTTPS origin.

The server requests only `openid`, `email`, and `profile`. It does not store Google access tokens or ask the customer for their Google password.

Official guide: https://developers.google.com/identity/protocols/oauth2/web-server

## Binance Pay setup

1. Apply for and configure your own Binance Pay merchant/API access.
2. Put the merchant API identity key and secret in:
   - `BINANCE_PAY_API_KEY`
   - `BINANCE_PAY_SECRET_KEY`
3. Set `APP_URL` to your public HTTPS URL. Binance must be able to reach:

   `https://YOUR-DOMAIN/api/binance/webhook`

4. The app creates orders through `POST /binancepay/openapi/v3/order`, redirects the customer to Binance's hosted `checkoutUrl`, and verifies the signed webhook before marking an order as paid.
5. Test the full flow with the merchant's supported test procedure before accepting real payments.

Official docs:
- Create order v3: https://developers.binance.com/en/docs/products/binance-pay-merchant/api-order-create-v3
- API signing rules: https://developers.binance.com/en/docs/products/binance-pay-merchant/api-common

### Currency configuration matters

The product page defaults to **৳350 BDT**. Binance Pay's supported fiat currencies depend on your merchant setup. `.env.example` shows BDT fiat mode as an example, but **do not assume BDT is supported for your account**.

- If BDT is supported, configure `BINANCE_PAY_FIAT_AMOUNT=350` and `BINANCE_PAY_FIAT_CURRENCY=BDT`.
- If not, clear both fiat settings and set `BINANCE_PAY_ORDER_AMOUNT` and `BINANCE_PAY_ORDER_CURRENCY` to the actual supported crypto amount/currency you intend to charge.
- Do not guess an exchange rate. Make sure the amount charged in Binance matches the price and terms shown to customers. In crypto mode, the checkout modal displays the configured crypto amount.

The merchant profile may also need API permissions/IP allowlisting. Keep all keys server-side and never add them to `public/app.js`.

## Product details and support

Edit these variables in `.env`:

- `PRODUCT_PRICE_BDT=350`
- `PRODUCT_DURATION_MONTHS=18`
- `SUPPORT_WHATSAPP_URL=https://wa.me/COUNTRYCODEPHONENUMBER`

Use a real WhatsApp support link. Do not leave a placeholder phone number in a live site.

Product feature availability and subscription terms can change by country and plan. Edit the page copy to match the **authorized product you can actually supply**. Do not promise storage, video features, a duration, or a replacement guarantee unless your supplier/plan explicitly supports it. ARS Store is not represented as an official Google website or Google partner.

## Admin orders

Open `/admin`, enter the `ADMIN_TOKEN` value from `.env`, and load orders.

- Orders only become `paid` after a valid signed Binance webhook.
- The admin UI only enables fulfillment for `paid` orders.
- Fulfillment is manual. The starter does not create Google subscriptions or automatically deliver accounts.
- Use the admin token only over HTTPS. Rotate it if exposed.

## Production checklist

- Use HTTPS and set `NODE_ENV=production`.
- Use a strong, unique `SESSION_SECRET` and `ADMIN_TOKEN`.
- Set the correct production `APP_URL` and Google redirect URI.
- Store `.env` outside version control; never commit credentials.
- Use a persistent disk for the SQLite database and back it up.
- Confirm Binance Pay currency support, payment notifications and refund procedures.
- Add your business identity, terms, privacy notice, refund policy and support contact.
- Confirm that you have the right to resell/activate the digital subscription under the relevant supplier/platform terms.
- Have a qualified adult/business owner handle merchant onboarding, tax and legal obligations where required.

## Important limitations

- This is a starter, not a complete audited commerce platform.
- No automated subscription activation is included.
- A customer returning from Binance is **not** treated as proof of payment. The server relies on the signed webhook.
- The example's BDT setting may need changing based on Binance merchant support.
- Add monitoring, backups, refund handling and additional operational controls before production use.
