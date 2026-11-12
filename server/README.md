# SentiMart server (Module 1: foundation + auth)

## Run locally

1. `cd server && cp .env.example .env` and fill `MONGODB_URI` (Atlas) and `JWT_ACCESS_SECRET` (32+ random chars:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
2. `npm install`
3. `npm run dev` (API on http://localhost:5000/api/v1)
4. Optional: `npm run seed:admin` creates the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`

## Test

- `npm test` (unit + integration; uses an in-memory MongoDB replica set, no Atlas needed)
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
