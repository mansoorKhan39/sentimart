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
