# SentiMart server (Module 1: foundation + auth, Module 2: catalog + cart)

## Run locally
1. `cd server && cp .env.example .env` and fill `MONGODB_URI` (Atlas) and `JWT_ACCESS_SECRET` (32+ random chars:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
2. `npm install`
3. `npm run dev` (API on http://localhost:5000/api/v1)
4. Optional: `npm run seed:admin` creates the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`

## Test
- `npm test` (unit + integration). Integration tests use an in-memory MongoDB (large first download) or, on slow internet, an Atlas database named sentimart_test: `set TEST_MONGODB_URI=mongodb+srv://USER:PASS@HOST/sentimart_test?retryWrites=true&w=majority` (cmd) before `npm test`
- Lint: `npm run lint`

## Try it
```bash
curl -s localhost:5000/api/v1/health
curl -s -X POST localhost:5000/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ali Khan","email":"ali@example.com","password":"Str0ngPass1"}'
curl -s -c jar.txt -X POST localhost:5000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ali@example.com","password":"Str0ngPass1"}'
# copy accessToken from the response:
curl -s localhost:5000/api/v1/users/me -H "Authorization: Bearer <accessToken>"
curl -s -b jar.txt -c jar.txt -X POST localhost:5000/api/v1/auth/refresh
curl -s -b jar.txt -X POST localhost:5000/api/v1/auth/logout
```

## Deploy (Vercel)
- New Vercel project, Root Directory `server`, framework "Other"; add every variable from `.env.example` (except ADMIN_*).
- `api/index.js` exports the Express app and `vercel.json` rewrites all paths to it.
- Atlas: Network Access `0.0.0.0/0` (Vercel egress IPs are dynamic); use a least-privilege DB user.

## Module 2: categories, products, images, cart, wishlist
| Method | Route | Who |
|---|---|---|
| GET | /categories | public |
| POST / PATCH / DELETE | /categories(/:id) | admin |
| GET | /products?q&category&minPrice&maxPrice&minRating&sentiment&sort&page&limit | public (limit capped at 50) |
| GET | /products/:id | public |
| POST | /products | approved seller |
| PATCH / DELETE | /products/:id | owner seller |
| POST | /products/:id/images (multipart field `images`, max 2 files per request, 2 MB each, JPEG/PNG/WebP) | owner seller |
| DELETE | /products/:id/images/:imageId | owner seller |
| GET / DELETE | /cart | customer |
| PUT / DELETE | /cart/items/:productId (body `{ "qty": 2 }`) | customer |
| GET | /wishlist | customer |
| POST / DELETE | /wishlist/:productId | customer |

- Prices and totals are integers in minor units (paisa): 249900 means PKR 2,499.00.
- Images: create a free Cloudinary account and set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Without them uploads return 503.
- Sample data: `npm run seed:catalog` creates 6 categories, 18 products and a demo approved seller (password printed once).
- Search uses a case-insensitive "contains" match (works while typing). At large scale, switch to MongoDB Atlas Search.
- Tests: `npm test` (same TEST_MONGODB_URI rule as Module 1). Image upload tests mock Cloudinary, so they never call it.

## Module 3: orders, sub-orders and emails

Customer (needs a logged-in `customer`):

| Method | Route | What it does |
|---|---|---|
| POST | `/api/v1/orders` | Checkout. Body: `{ "address": { "line1", "city", "phone?" }, "paymentMethod": "COD" or "TEST_CARD" }` |
| GET | `/api/v1/orders?page&limit` | My orders (newest first) with their packages |
| GET | `/api/v1/orders/:id` | One order (404 if it is not mine) |
| PATCH | `/api/v1/sub-orders/:id/cancel` | Cancel a package while Pending or Confirmed; stock is restored |

Seller (needs a logged-in `seller`):

| Method | Route | What it does |
|---|---|---|
| GET | `/api/v1/seller/sub-orders?status&page&limit` | My packages, with the shipping address |
| PATCH | `/api/v1/seller/sub-orders/:id/status` | Body `{ "status": "Confirmed" / "Shipped" / "Delivered" }`, one step forward at a time |

How checkout works: the whole checkout runs in **one MongoDB transaction** (stock for every item, the order, one sub-order per seller, clearing the cart). If any item is out of stock nothing changes and you get `409 OUT_OF_STOCK`. Stock is reduced with a conditional update (`stock >= qty`), so two buyers of the last unit can never both succeed. Prices are copied into the sub-order at purchase time.

Emails (order confirmation, new order for each seller, status changes) go through Brevo or Resend (both have free tiers). In `.env` set `EMAIL_PROVIDER=brevo` (or `resend`) and `EMAIL_API_KEY=...`, and set `MAIL_FROM` to a sender address you verified with the provider. With `EMAIL_PROVIDER=none` emails are only logged. An email failure never breaks an order.

Try it (after `npm run seed:catalog`): log in as a customer, add items with `PUT /cart/items/:productId`, then `POST /orders`.

## Module 4: reviews with sentiment analysis (needs the `nlp-service`)
| Method | Route | Who |
|---|---|---|
| GET | /products/:id/reviews?sentiment&page&limit | public (published reviews + rating and sentiment summary) |
| GET | /products/:id/reviews/eligibility | customer (can I review this product?) |
| POST | /products/:id/reviews (body `{ rating, text }`) | customer with a delivered package |
| PATCH / DELETE | /reviews/:id | author, within 7 days |
| POST | /reviews/:id/reply (body `{ text }`) | owner seller |
| GET / POST | /internal/retry-pending | cron only (`Authorization: Bearer CRON_SECRET`) |

- Flow: eligibility (delivered package, one review per package) -> API history checks (duplicate text, burst posting) -> NLP service (sentiment, keywords, text spam rules) -> merged spam score -> published or flagged (>= `SPAM_THRESHOLD`) -> product rating and sentiment numbers recalculated -> seller emailed about a negative review.
- If the NLP service is down or slow (3 s), the review is saved as `analysisStatus: "pending"` and analysed later: lazily when the reviews are read (at most once a minute per review) and by the daily cron in `vercel.json`. Set `CRON_SECRET` in Vercel.
- Env: `NLP_URL`, `NLP_API_KEY` (same value as in `nlp-service`), `NLP_TIMEOUT_MS`, `SPAM_THRESHOLD`, `REVIEW_EDIT_DAYS`, `CRON_SECRET`. With `NLP_URL` empty every review stays pending.
- Flagged reviews wait for an admin decision (Module 5).

## Module 5: seller dashboard data and admin panel APIs
**Seller** (role seller; a pending seller sees empty data)
| Method | Route | Notes |
|---|---|---|
| GET | /seller/analytics/overview | KPI cards: revenue and orders vs the previous 30 days, to-confirm and to-ship counts, stock, rating, sentiment index, unanswered negative reviews |
| GET | /seller/analytics/sales?range=7d\|30d\|90d\|365d or from&to, interval=day\|week\|month | revenue and orders series (gaps filled with 0), status breakdown, top products |
| GET | /seller/analytics/sentiment?productId | trend per bucket, overall distribution, 0-100 sentiment gauge |
| GET | /seller/analytics/complaints?limit&productId | top negative keywords with examples |
| GET | /seller/analytics/export?type=sales\|sentiment\|complaints | CSV download (Excel safe, formulas defused) |
| GET | /seller/inventory?stock=all\|low\|out&q | stock table and badge counts (`LOW_STOCK_THRESHOLD`) |
| GET | /seller/reviews?sentiment&replied&productId | reviews on my products |

**Admin** (role admin)
| Method | Route | Notes |
|---|---|---|
| GET | /admin/users?q&role&status | list and search |
| PATCH | /admin/users/:id/status | suspend / reactivate (ends sessions, hides a seller's products, admins are protected) |
| GET | /admin/sellers?status=pending | application queue with product counts |
| PATCH | /admin/sellers/:id/approval | approve / reject (emails the seller, hides or restores listings) |
| GET | /admin/products, PATCH /admin/products/:id/status, DELETE /admin/products/:id | catalog moderation |
| GET | /admin/reviews/flagged, PATCH /admin/reviews/:id/moderate | spam queue: `{ "action": "approve" \| "remove" }` |
| GET | /admin/reports?range | users, sellers, sales series, order statuses, review spam rate, top sellers and products, queue counts |
| GET | /admin/audit-log?action | who did what (kept 13 months) |

- Day, week and month buckets use UTC; weeks start on Monday. Money is in minor units; CSV shows rupees.
- Create the first admin with `npm run seed:admin`.
- **Demo data for the dashboards:** `npm run seed:catalog` then `npm run seed:demo` (95 orders over 90 days, about 100 reviews with sentiment and keywords, spam in the admin queue, pending seller applications, a second seller). Rebuild with `npm run seed:demo -- --reset`. The demo accounts and their shared password are printed once.
