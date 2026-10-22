# ARS Store — bKash / Nagad via BDPayHub

This Railway-ready Node.js storefront uses email/password registration and login. Binance Pay order creation is disabled; the checkout offers only bKash and Nagad through the BDPayHub store API.

## Important status

- The code integration is prepared, but it does **not** mean live payments are already enabled.
- The BDPayHub deployment must be publicly reachable from the ARS Store server and customer browser.
- BDPayHub's current source documents Personal bKash/Nagad receipt matching through its Android companion app. It does not include active official bKash/Nagad Merchant API adapters.
- Live checkout requires a paired receiving phone with a recent heartbeat and successful real-SIM tests. The supplied companion APK has previously been blocked by Play Protect, so keep `BDPAYHUB_MODE=sandbox` until that blocker is resolved safely.
- BDPayHub's `SMS_MATCHED` result is receipt-SMS matching, not direct confirmation from the official bKash/Nagad API. Do not describe it as official provider-side settlement confirmation.

## 1. Preserve the current database

Keep the existing Railway Volume mounted at `/data` and keep:

```text
DB_PATH=/data/ars-store.sqlite
```

The server adds the new payment columns and webhook-event table using additive SQLite migrations. It does not delete existing users/orders. Do not delete the volume or replace the database file. Take a backup before deploying.

## 2. Prepare BDPayHub

The API key is tied to a Brand/Store. To offer both methods without exposing account IDs in the storefront, configure two provider-specific brands:

1. In **View Gateways**, add an active bKash **Personal** receiving account and an active Nagad **Personal** receiving account.
2. In **Brands**, create a bKash brand with the ARS Store's exact HTTPS domain and the bKash account as its default account. Create a second brand with the same ARS Store domain and Nagad as its default account.
3. In each brand, create a separate Store API key. Keep each key on the Railway server only.
4. In **Webhook Settings**, register this exact URL for each brand:

   `https://YOUR-ARS-STORE-DOMAIN.up.railway.app/api/bdpayhub/webhook`

   Activate the webhook and use a long random signing secret for each brand. Copy the same respective secret into the matching Railway variable below.
5. Approve the ARS Store public hostname in BDPayHub's webhook allowed-host settings.
6. Confirm the BDPayHub site is actually public. A private/owner-only Site will not work as a checkout API for unauthenticated customers or server-to-server requests.

## 3. Configure Railway Variables

Keep existing `SESSION_SECRET`, `ADMIN_TOKEN`, `APP_URL`, `DB_PATH`, `PRODUCT_PRICE_BDT`, `PRODUCT_DURATION_MONTHS`, and `SUPPORT_WHATSAPP_URL` values. Do not put secrets in GitHub.

Set these variables in Railway → `Site` → **Variables**:

```text
BDPAYHUB_BASE_URL=https://YOUR-PUBLIC-BDPAYHUB-DOMAIN
BDPAYHUB_MODE=sandbox
BDPAYHUB_BKASH_API_KEY=bdp_REPLACE_WITH_BKASH_BRAND_KEY
BDPAYHUB_BKASH_WEBHOOK_SECRET=REPLACE_WITH_BKASH_WEBHOOK_SIGNING_SECRET
BDPAYHUB_NAGAD_API_KEY=bdp_REPLACE_WITH_NAGAD_BRAND_KEY
BDPAYHUB_NAGAD_WEBHOOK_SECRET=REPLACE_WITH_NAGAD_WEBHOOK_SIGNING_SECRET
```

- `BDPAYHUB_BASE_URL` is the gateway's public HTTPS origin only, without `/api/...` or a trailing path.
- Each `BDPAYHUB_*_API_KEY` must be a real key generated for the matching provider-specific Brand/Store.
- Each webhook secret must match the signing secret saved in that brand's webhook configuration.
- Do not send passwords, API keys, or webhook secrets in chat or screenshots.

Save variables and wait for a successful Railway deployment.

## 4. Test in sandbox first

1. Visit the ARS Store and create/log in to an account with email/password.
2. Click **অর্ডার করুন** and select bKash or Nagad.
3. The server creates the invoice through `POST /api/v1/payments` and redirects the customer to the BDPayHub checkout URL.
4. A paid order is accepted only after the server verifies the signed BDPayHub webhook, event timestamp/id, BDT amount and the expected payment record.
5. Check `/admin` using `ADMIN_TOKEN`; fulfillment is still manual and only enabled for `paid` orders.

Note: the BDPayHub source in the supplied handoff currently simulates a sandbox invoice as `PAID` without enqueueing a webhook. Unless that gateway source is updated to emit a sandbox webhook, a sandbox payment may show as pending in ARS Store even though the BDPayHub sandbox page says paid. Do not treat that as a real payment.

## 5. Live mode checklist

Do **not** switch to `BDPAYHUB_MODE=live` until all are true:

- The BDPayHub Site is publicly reachable over HTTPS.
- Both provider-specific Store API keys and webhook secrets are correct.
- The receiving Android companion is installed from an approved distribution path, paired to the right SIM/account, and has a recent heartbeat.
- Small real bKash and Nagad transfers have been matched on the receiving phone and the signed webhook has successfully changed the corresponding ARS Store order to `paid`.
- You have verified refund/support handling and can provide the advertised digital product lawfully.

The payment page redirect alone never marks an order paid. A signed webhook is required. Existing legacy Binance-related database columns are retained only for compatibility with old records; no Binance checkout API call is made by this version.

## Run locally

Requires Node.js 20+ and the existing dependencies in `package.json`.

```bash
npm install
cp .env.example .env
npm start
```

For local testing, use a local HTTPS tunnel only if you understand the webhook/security implications; BDPayHub's live URLs require HTTPS. Do not use real payments during local development.
