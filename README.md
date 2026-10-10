# RecyConnect — Phase 1 Backend

Backend for a recyclable-waste traceability platform. Residents request pickups, collectors claim, verify (QR scan) and weigh them, hand them to a recycling facility, and the facility confirms receipt. Every status change is appended to an immutable-by-convention `statusHistory`, which is the **chain of custody**. Photos are classified asynchronously by an ML worker.

```
                ┌──────────────┐     ┌──────────────────────────┐     ┌──────────┐
 client ──────▶ │ API Gateway  │ ──▶ │ Lambda (Express app)     │ ──▶ │ DynamoDB │
                └──────────────┘     │ handlers → services      │     └──────────┘
                                     └──────────┬───────────────┘           ▲
          presigned PUT                         │ SendMessage               │ ml* fields
 client ───────────────────▶ ┌────┐   confirm   ▼                           │
                             │ S3 │ ───────▶ ┌─────┐ ──▶ ┌──────────────────┴──┐
                             └────┘          │ SQS │     │ Worker Lambda       │
                                             └─────┘     │ → ML classifier     │
                                                         └─────────────────────┘
```

## Architecture mapping

| Folder / file | Architecture component |
|---|---|
| `src/lambda.ts` | **API Gateway → Lambda** entry point (`serverless-http` wraps the Express app) |
| `src/server.ts` | Local stand-in for API Gateway (plain `app.listen`) |
| `src/app.ts` | The API Lambda's routing layer (Express app, no `listen`) |
| `src/handlers/` | API Gateway routes → thin request/response handlers (auth, pickups, uploads, handoffs, admin) |
| `src/middleware/` | API-layer concerns: JWT auth (Cognito later), role checks, zod validation, error mapping |
| `src/services/` | **Lambda business logic** + all **DynamoDB** access (state machine, transactions, queries) |
| `src/services/uploadService.ts` | **S3** presigned PUT URLs + **SQS** `SendMessage` |
| `src/config/aws.ts` | Shared AWS SDK v3 clients (DynamoDB, S3, SQS); region from env |
| `src/worker/classifier.ts` | **SQS → async worker Lambda** (also runs locally as a long-poller) |
| `src/ml/mockClassifier.ts` | **ML classifier** (swappable `WasteClassifier` interface; mock for now) |
| `src/scripts/createTables.ts` | Infrastructure: creates the 3 **DynamoDB** tables + GSIs |
| `src/scripts/seed.ts` | Demo data |
| `src/scripts/bootstrapLocal.ts` + `docker-compose.yml` | LocalStack emulation of S3, SQS and DynamoDB for offline dev |
| `web/` | Client (React SPA): talks to API Gateway for data and to S3 directly for photo uploads |

## Run everything together (backend + worker + web)

Quickest path, fully local with LocalStack (needs Docker):

```bash
# one-time setup
npm install && (cd web && npm install)
npm run local:up
cp .env.local.example .env
npm run local:bootstrap
npm run seed

# then, in three terminals:
npm run dev                  # 1. API         → http://localhost:5000
npm run worker               # 2. ML worker   (polls SQS, writes results to DynamoDB)
cd web && npm run dev        # 3. Web app     → http://localhost:5173
```

Open http://localhost:5173. The login page lists the demo accounts; click one to fill it in. A good demo uses three browser windows (or one normal and two private), one per role:

1. **Resident** (`arjun.resident@…`): request a pickup. The detail page shows its QR code and the code as text.
2. **Collector** (`ravi.collector@…`; use phone size or DevTools device mode): claim it under **Available**, upload a photo and watch *Analysing…* turn into the AI result, then scan the resident's QR (or paste the code) and enter the weight. Finish with a hand-off to a facility.
3. **Admin** (`admin@…`): stats update live every 5 s. Filter by *Handed off*, click **Confirm recycler receipt**, then click the row to see the complete chain of custody.

The web app reads `VITE_API_URL` (default `http://localhost:5000`; see `web/.env.example`). Port 5173 is fixed (`strictPort`) because the S3 CORS rule and the API's `CORS_ORIGIN` allow exactly that origin. Camera QR scanning needs a secure origin: `localhost` counts, a LAN IP over plain HTTP doesn't, so manual code entry is always available as a fallback. `cd web && npm run build` produces a static bundle in `web/dist`, suitable for S3 + CloudFront.

To use real AWS instead of LocalStack, follow sections 1–3 below and run the same three processes.

## Prerequisites

- Node.js 20+
- **Either** Docker (to run everything locally with LocalStack, no AWS account needed) **or** an AWS account with an IAM user that has programmatic access

## Run locally with LocalStack (no AWS account)

[LocalStack](https://www.localstack.cloud/) emulates S3, SQS and DynamoDB in one container on `http://localhost:4566`. When `AWS_ENDPOINT` is set, every AWS client in `src/config/aws.ts` points at it and uses `test`/`test` credentials. S3 uses path-style URLs (`http://localhost:4566/<bucket>/<key>`), so presigned upload URLs work straight from the browser. When `AWS_ENDPOINT` is **not** set, nothing changes and the code talks to real AWS.

```bash
npm install
npm run local:up              # docker compose up -d  (LocalStack on :4566)
cp .env.local.example .env    # already points at LocalStack; change JWT_SECRET if you like
npm run local:bootstrap       # bucket + CORS, SQS queue + DLQ, DynamoDB tables; prints SQS_QUEUE_URL
npm run seed
npm run dev                   # terminal 1: API on http://localhost:5000
npm run worker                # terminal 2: classifier worker polling the LocalStack queue
npm run test:e2e              # terminal 3: full lifecycle test (see "End-to-end test" below)
```

`local:bootstrap` is safe to re-run: it skips anything that already exists. It refuses to run if `AWS_ENDPOINT` is unset, so it can never touch real AWS. It creates:

| Resource | Settings |
|---|---|
| S3 bucket `$S3_BUCKET` (`recyconnect-photos`) | CORS: `PUT`/`GET` from `http://localhost:5173` |
| SQS `recy-classify-queue` | Standard, visibility timeout 60 s, receive wait 20 s, redrive to DLQ after 5 receives |
| SQS `recy-classify-dlq` | Standard |
| DynamoDB `recy-users`, `recy-pickups`, `recy-handoffs` | Same definitions as `npm run tables` |

The queue URL it prints (`http://sqs.ap-south-1.localhost.localstack.cloud:4566/000000000000/recy-classify-queue`) already matches `.env.local.example`. `*.localhost.localstack.cloud` is public DNS that resolves to `127.0.0.1`.

Stop with `npm run local:down`. Data lives in the `localstack-data` Docker volume. If state is lost after a restart, run `local:bootstrap` and `seed` again; `docker volume rm recyconnect_localstack-data` gives a clean slate.

**LocalStack version:** `docker-compose.yml` pins `localstack/localstack:4.14.0`, the last release that runs without an account. Newer images (`latest`, `2026.x`) exit with *"License activation failed"* unless `LOCALSTACK_AUTH_TOKEN` is set. To use a newer image with your own token:

```bash
LOCALSTACK_IMAGE=localstack/localstack:latest LOCALSTACK_AUTH_TOKEN=<token> npm run local:up
```

**Differences from real AWS to keep in mind:** LocalStack doesn't enforce IAM policies, and it is laxer than S3 about some request validation. Do a final check against real AWS before deploying.

## 1. Create AWS resources (console)

Use the same region everywhere — the default is **ap-south-1 (Mumbai)**.

### 1a. IAM user for local development

IAM → Users → Create user (e.g. `recyconnect-dev`) → Attach policy directly → create an inline policy with this JSON (replace `ACCOUNT_ID` and `YOUR_BUCKET`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable", "dynamodb:DescribeTable",
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:ACCOUNT_ID:table/recy-*",
        "arn:aws:dynamodb:ap-south-1:ACCOUNT_ID:table/recy-*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:ap-south-1:ACCOUNT_ID:recy-classify-queue"
    }
  ]
}
```

(The API's HeadObject check is authorised by `s3:GetObject`. `TransactWriteItems` is authorised via the per-item `PutItem`/`UpdateItem` permissions.)

Then Security credentials → Create access key → "Local code" → copy the key ID and secret into `.env`.

### 1b. S3 bucket for photos

S3 → Create bucket:
- **Name:** globally unique, e.g. `recyconnect-photos-<yourname>`
- **Region:** ap-south-1
- **Block all public access:** leave **ON** (uploads use presigned URLs; nothing is public)
- Everything else default → Create

Then open the bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → Edit → paste:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["http://localhost:5173"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Add your production frontend origin to `AllowedOrigins` later.

### 1c. SQS queue

SQS → Create queue:
- **Type:** Standard
- **Name:** `recy-classify-queue`
- **Visibility timeout:** 60 seconds (must be ≥ the worker Lambda timeout when deployed)
- **Receive message wait time:** 20 seconds (long polling)
- Recommended: **Dead-letter queue** → create `recy-classify-dlq` first (Standard), then enable DLQ here with *Maximum receives* = 5
- Create → copy the **queue URL** (`https://sqs.ap-south-1.amazonaws.com/<ACCOUNT_ID>/recy-classify-queue`) into `.env`

### 1d. DynamoDB tables

Don't create them in the console — `npm run tables` does it (step 3).

## 2. Configure

```bash
npm install
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Local API port (default 5000) |
| `AWS_REGION` | Region for all AWS clients (default `ap-south-1`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user keys from 1a. Leave empty on Lambda (execution role is used) |
| `JWT_SECRET` | Long random string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `TABLE_USERS` / `TABLE_PICKUPS` / `TABLE_HANDOFFS` | Table names (defaults `recy-users`, `recy-pickups`, `recy-handoffs`) |
| `S3_BUCKET` | Bucket name from 1b |
| `SQS_QUEUE_URL` | Queue URL from 1c |
| `CORS_ORIGIN` *(optional)* | Comma-separated allowed origins for the API (default `http://localhost:5173`) |
| `JWT_EXPIRES_IN` *(optional)* | Token lifetime (default `7d`) |
| `AWS_ENDPOINT` *(LocalStack only)* | e.g. `http://localhost:4566`. **Leave unset for real AWS.** |
| `AWS_PUBLIC_ENDPOINT` *(optional, LocalStack)* | Browser-reachable endpoint for presigned URLs if it differs from `AWS_ENDPOINT` (e.g. API running inside Docker). Defaults to `AWS_ENDPOINT` |

## 3. Run

```bash
npm run tables   # create DynamoDB tables + GSIs, waits until ACTIVE (idempotent)
npm run seed     # 1 admin, 2 collectors, 3 residents, 6 pickups; prints credentials
npm run dev      # API on http://localhost:5000 (tsx watch)
npm run worker   # in a second terminal: long-polls SQS and classifies photos
```

Other scripts: `npm run build` (tsc → `dist/`), `npm start` (run built server), `npm run typecheck`.

### End-to-end test

`npm run test:e2e` (`tests/e2e.mjs`) drives one pickup through its whole lifecycle over HTTP. It needs `npm run seed` done and `npm run dev` + `npm run worker` running. It covers:

- **Auth:** register, login, `/me`
- **Pickup:** create, then collector assign
- **Photo:** presign, PUT a PNG straight to S3 (checking CORS), confirm
- **Worker:** waits up to 60 s for it to write the ML result
- **Custody chain:** collect with qrToken, handoff, admin confirm, then the timeline
- **Admin:** checks stats, filtered list and collector counts

Along the way it also checks the expected 400/403/404/409 rejections. It reads `.env`, so it works against LocalStack or real AWS (`E2E_API_URL` overrides the API address). Each run adds one resident and one completed pickup, so it can be repeated without resetting data. It exits non-zero if any check fails.

All seed accounts use password **`password123`**:

| Role | Email |
|---|---|
| admin | admin@recyconnect.dev |
| collector | ravi.collector@recyconnect.dev |
| collector | meena.collector@recyconnect.dev |
| resident | arjun.resident@recyconnect.dev |
| resident | priya.resident@recyconnect.dev |
| resident | kabir.resident@recyconnect.dev |

Seeded pickups that already show ML results reference placeholder photo keys (`pickups/<id>/seed-placeholder.jpg`) that don't exist in S3. Re-running `seed` is a no-op if the admin already exists.

## Data model

| Table | PK | GSIs (sort key) |
|---|---|---|
| `recy-users` | `userId` | `email-index` |
| `recy-pickups` | `pickupId` | `residentId-index` (createdAt), `collectorId-index` (createdAt), `status-index` (createdAt) |
| `recy-handoffs` | `handoffId` | `pickupId-index` |

`collectorId` is **omitted** (not stored as null) on unassigned pickups because DynamoDB rejects NULL-typed index keys; the API always returns `collectorId: null` in that case.

## Status machine

```
pending ──assign──▶ assigned ──collect (QR + kg)──▶ collected ──handoff──▶ handed_off ──confirm──▶ completed
```

- Only the single next step is allowed; anything else → **409**.
- Each write uses a DynamoDB `ConditionExpression` on the current status, so two collectors racing to claim the same pickup can't both win (loser gets 409).
- Handoff creation and confirmation are `TransactWriteItems`: the handoff record and the pickup status change succeed or fail together.
- Every transition appends `{ status, by, at }` to `statusHistory`.

## API

All responses are `{ "success": true, "data": ... }` or `{ "success": false, "message": "..." }`. Authenticated routes need `Authorization: Bearer <token>`.

| Method & path | Role | Notes |
|---|---|---|
| `POST /api/auth/register` | public | `{ name, email, password (≥8), phone?, role? }`; role is `resident` (default) or `collector` — admins can't self-register |
| `POST /api/auth/login` | public | `{ email, password }` → `{ token, user }` |
| `GET /api/auth/me` | any | current user |
| `POST /api/pickups` | resident | `{ address, notes?, declaredCategory: plastic\|paper\|mixed }`; generates `qrToken` |
| `GET /api/pickups/mine` | resident | own pickups incl. `qrToken` (render it as the QR code) |
| `GET /api/pickups/available` | collector | pending pickups (`qrToken` stripped) |
| `GET /api/pickups/assigned` | collector | pickups this collector claimed (`qrToken` stripped) |
| `PATCH /api/pickups/:id/assign` | collector | pending → assigned |
| `PATCH /api/pickups/:id/collect` | collector (assignee) | `{ qrToken, weightKg }`; wrong token → 400; assigned → collected |
| `GET /api/pickups/:id/timeline` | owner resident, assigned collector, admin | status history with actor names, handoffs, ML result, and `photoUrl` (presigned GET, valid 15 min, `null` if no photo) |
| `POST /api/uploads/presign` | anyone with access to the pickup | `{ pickupId, contentType: image/jpeg\|image/png }` → `{ uploadUrl, key, headers, expiresIn }` |
| `POST /api/uploads/confirm` | anyone with access to the pickup | `{ pickupId, key }`; verifies the object exists, sets `photoKey`, `mlStatus='queued'`, enqueues `{ pickupId, key }` → 202 |
| `POST /api/handoffs` | collector (assignee) | `{ pickupId, facilityName, handoffPhotoKey? }`; collected → handed_off |
| `PATCH /api/handoffs/:id/confirm` | admin (acting as recycler) | confirms; handed_off → completed. TODO: dedicated `recycler` role |
| `GET /api/admin/stats` | admin | counts per status, total kg collected, contamination count, ML queue size |
| `GET /api/admin/pickups?status=` | admin | optional status filter (uses `status-index`) |
| `GET /api/admin/collectors` | admin | collectors with assigned / in-transit / completed counts and kg |

### Photo upload flow (client side)

```js
const { data } = await api.post('/api/uploads/presign', { pickupId, contentType: file.type });
await fetch(data.uploadUrl, { method: 'PUT', headers: data.headers, body: file }); // straight to S3
await api.post('/api/uploads/confirm', { pickupId, key: data.key });             // → SQS → worker
// poll GET /api/pickups/:id/timeline until ml.status === 'done'
```

The `Content-Type` header on the PUT must match what was presigned or S3 returns 403.

## Async classifier worker

`src/worker/classifier.ts` exports:
- `handler` — Lambda handler for an SQS trigger. Returns `batchItemFailures` so only failed messages are retried (enable **Report batch item failures** on the event source mapping).
- `npm run worker` — local long-polling loop (20 s wait, 10 messages/batch); deletes each message after it's processed.

Per message: load pickup → skip if the photo has since been replaced (stale message) → `classifier.classify(...)` → write `mlCategory`, `mlContamination`, `mlConfidence`, `mlStatus='done'` (conditional on `photoKey` still matching).

**Swapping in a real model:** implement `WasteClassifier` from `src/ml/mockClassifier.ts` (e.g. a class that calls a SageMaker endpoint with the S3 object) and return it from `getClassifier()`. Nothing else changes.

> Design note: SQS messages are sent by `/uploads/confirm` rather than by an S3 event notification. That way the API can validate ownership and the key prefix before anything is queued. Switching to S3 → SQS event notifications later only requires the worker to parse the S3 event shape.

## Deploying to Lambda (later)

1. `npm run build`, zip `dist/` + `node_modules/` (production deps).
2. **API Lambda:** handler `dist/lambda.handler`, Node.js 20, put API Gateway (HTTP API, `ANY /{proxy+}`) in front.
3. **Worker Lambda:** handler `dist/worker/classifier.handler`, timeout ≤ queue visibility timeout, SQS trigger on `recy-classify-queue` with batch item failures enabled.
4. Give both an execution role with the permissions from 1a instead of access keys; set the remaining env vars on each function.

## Known prototype limitations

- Email uniqueness is checked via a GSI query (eventually consistent); a guard item with a conditional put would make it strict.
- Admin stats and collector lists use table scans — fine at prototype scale; switch to pre-aggregated counters (DynamoDB Streams) as data grows.
- Recycler confirmation is done by admins; a `recycler` role is a TODO.
