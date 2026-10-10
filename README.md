# RecyConnect

Backend for a recyclable-waste traceability platform. Residents request pickups, collectors claim, verify (QR scan) and weigh them, hand them to a recycling facility, and the facility confirms receipt. Every status change is appended to an immutable-by-convention `statusHistory`, which is the **chain of custody**. Photos are classified asynchronously by an ML worker, and operational events (contamination, hand-offs, recycler confirmations, missed pickups) are published to SNS as alerts.

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
 contamination (worker) · handoff · recycler confirm (API)
 missed pickups (scheduled job Lambda)  ──▶ ┌─────┐ ──▶ email / SMS / Lambda subscribers
                                            │ SNS │
                                            └─────┘  (+ stored in recy-alerts for the admin UI)
 every Lambda: structured JSON logs on stdout ──▶ CloudWatch Logs
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
| `src/services/alertService.ts` + `src/notify/notifier.ts` | **SNS** alerts: store in `recy-alerts`, publish via the `Notifier` interface |
| `src/jobs/missedPickups.ts` | **Scheduled Lambda** (EventBridge): missed-pickup check |
| `src/services/healthService.ts` | `GET /api/health`: DynamoDB / S3 / SQS / SNS connectivity |
| `src/utils/logger.ts` + `src/middleware/requestLogger.ts` | **CloudWatch Logs** stand-in: pino JSON logs with a request id |
| `src/utils/sanitize.ts` + `src/utils/response.ts` | Response sanitiser that strips `qrToken` from every response body |
| `src/config/aws.ts` | Shared AWS SDK v3 clients (DynamoDB, S3, SQS, SNS); region from env |
| `src/worker/classifier.ts` | **SQS → async worker Lambda** (also runs locally as a long-poller) |
| `src/ml/mockClassifier.ts` | **ML classifier** (swappable `WasteClassifier` interface; mock for now) |
| `src/scripts/createTables.ts` | Infrastructure: creates the 4 **DynamoDB** tables + GSIs |
| `src/scripts/seed.ts` | Demo data |
| `src/scripts/bootstrapLocal.ts` + `docker-compose.yml` | LocalStack emulation of S3, SQS, SNS and DynamoDB for offline dev |
| `src/scripts/demoReset.ts`, `demoPreflight.ts` | `npm run demo:reset` / `npm run demo` |
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

# then, one command:
npm run demo
```

`npm run demo` checks LocalStack is up (with all four services), the tables exist and ports 5000/5173 are free, then starts four processes in one terminal with `concurrently` (output is prefixed `[api]`, `[worker]`, `[job]`, `[web]`; Ctrl+C stops them all):

| Process | What |
|---|---|
| `api` | `npm run dev`: API on http://localhost:5000 |
| `worker` | `npm run worker`: ML worker (polls SQS, writes results to DynamoDB, raises contamination alerts) |
| `job` | `npm run job:missed -- --watch`: missed-pickup check every 60 s (stand-in for the EventBridge schedule) |
| `web` | `cd web && npm run dev`: web app on http://localhost:5173 |

`npm run demo:reset` wipes and re-creates every table, the bucket, both queues and the topic in LocalStack, then re-seeds clean demo data. Run it before presenting. It refuses to run unless `AWS_ENDPOINT` is set, so it can't touch real AWS. Then follow the [5-minute demo script](#5-minute-demo-script).

The web app reads `VITE_API_URL` (default `http://localhost:5000`; see `web/.env.example`). Port 5173 is fixed (`strictPort`) because the S3 CORS rule and the API's `CORS_ORIGIN` allow exactly that origin. Camera QR scanning needs a secure origin: `localhost` counts, a LAN IP over plain HTTP doesn't, so manual code entry is always available as a fallback. `cd web && npm run build` produces a static bundle in `web/dist`, suitable for S3 + CloudFront.

To use real AWS instead of LocalStack, follow sections 1–3 below and run the same three processes.

## Prerequisites

- Node.js 20+
- **Either** Docker (to run everything locally with LocalStack, no AWS account needed) **or** an AWS account with an IAM user that has programmatic access

## Run locally with LocalStack (no AWS account)

[LocalStack](https://www.localstack.cloud/) emulates S3, SQS, SNS and DynamoDB in one container on `http://localhost:4566`. When `AWS_ENDPOINT` is set, every AWS client in `src/config/aws.ts` points at it and uses `test`/`test` credentials. S3 uses path-style URLs (`http://localhost:4566/<bucket>/<key>`), so presigned upload URLs work straight from the browser. When `AWS_ENDPOINT` is **not** set, nothing changes and the code talks to real AWS.

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

`local:bootstrap` is safe to re-run: it skips anything that already exists. It refuses to run if `AWS_ENDPOINT` is unset, so it can never touch real AWS. (`npm run demo:reset` deletes all of it first, then runs the same bootstrap and the seed.) It creates:

| Resource | Settings |
|---|---|
| S3 bucket `$S3_BUCKET` (`recyconnect-photos`) | CORS: `PUT`/`GET` from `http://localhost:5173` |
| SQS `recy-classify-queue` | Standard, visibility timeout 60 s, receive wait 20 s, redrive to DLQ after 5 receives |
| SQS `recy-classify-dlq` | Standard |
| SNS `recy-alerts` | Standard topic (no subscribers by default) |
| DynamoDB `recy-users`, `recy-pickups`, `recy-handoffs`, `recy-alerts` | Same definitions as `npm run tables` |

The queue URL and topic ARN it prints (`http://sqs.ap-south-1.localhost.localstack.cloud:4566/000000000000/recy-classify-queue`, `arn:aws:sns:ap-south-1:000000000000:recy-alerts`) already match `.env.local.example`. **Upgrading from an older checkout:** add `SNS_TOPIC_ARN` and `TABLE_ALERTS` from `.env.local.example` to your `.env`, and run `npm run local:down && npm run local:up` so the container picks up `SERVICES=...,sns`. `*.localhost.localstack.cloud` is public DNS that resolves to `127.0.0.1`.

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
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": ["sns:Publish", "sns:GetTopicAttributes"],
      "Resource": "arn:aws:sns:ap-south-1:ACCOUNT_ID:recy-alerts"
    },
    {
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:ap-south-1:ACCOUNT_ID:recy-classify-queue"
    }
  ]
}
```

(The API's HeadObject check is authorised by `s3:GetObject`; `/api/health`'s HeadBucket needs `s3:ListBucket`. `TransactWriteItems` is authorised via the per-item `PutItem`/`UpdateItem` permissions. The `recy-*` table pattern already covers `recy-alerts`.)

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

### 1d. SNS topic for alerts

SNS → Topics → Create topic → **Standard**, name `recy-alerts` → Create → copy the **ARN** into `SNS_TOPIC_ARN`. Add subscriptions as needed, e.g. **Email** for the ops team (confirm the email), or **SMS** with a subscription filter policy `{"type": ["missed_pickup"]}` so only missed pickups text someone. Each message carries `type` and `pickupId` message attributes; the body is the alert JSON.

### 1e. DynamoDB tables

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
| `TABLE_USERS` / `TABLE_PICKUPS` / `TABLE_HANDOFFS` / `TABLE_ALERTS` | Table names (defaults `recy-users`, `recy-pickups`, `recy-handoffs`, `recy-alerts`) |
| `S3_BUCKET` | Bucket name from 1b |
| `SQS_QUEUE_URL` | Queue URL from 1c |
| `SNS_TOPIC_ARN` | Topic ARN from 1d. If unset, alerts are still stored and shown in the admin UI but not published |
| `MISSED_PICKUP_MINUTES` *(optional)* | An assigned pickup not collected after this long is reported as missed (default `30`) |
| `MISSED_PICKUP_INTERVAL_SECONDS` *(optional)* | How often `npm run job:missed -- --watch` re-checks (default `60`) |
| `LOG_LEVEL` *(optional)* | pino level: `debug`, `info` (default), `warn`, `error`, `silent` |
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

Other scripts: `npm run build` (tsc → `dist/`), `npm start` (run built server), `npm run typecheck`, `npm run job:missed` (one missed-pickup check; `-- --watch` repeats it), `npm run demo` / `npm run demo:reset` (LocalStack only).

### Tests

| Script | What | Needs |
|---|---|---|
| `npm run test:unit` | Sanitiser rules, `/api/uploads/confirm` over HTTP with AWS stubbed, a guard that no handler bypasses `ok()`, missed-pickup selection | nothing |
| `npm run test:e2e` | Whole lifecycle over HTTP (below) | API + worker running, seeded |
| `npm run test:ui` (or `cd web && npm run test:ui`) | Playwright: the demo in a real browser, one context per role | API + worker running, seeded (starts Vite itself if needed) |
| `npm test` | All three, in that order | same as above |

The quickest way to satisfy "API + worker running" is `npm run demo` in another terminal. First-time Playwright setup: `cd web && npx playwright install chromium`.

### End-to-end test

`npm run test:e2e` (`tests/e2e.mjs`) drives one pickup through its whole lifecycle over HTTP. It needs `npm run seed` done and `npm run dev` + `npm run worker` running. It covers:

- **Auth:** register, login, `/me`
- **Pickup:** create, then collector assign
- **Photo:** presign, PUT a PNG straight to S3 (checking CORS), confirm
- **Worker:** waits up to 60 s for it to write the ML result
- **Custody chain:** collect with qrToken, handoff, admin confirm, then the timeline
- **Admin:** checks stats, filtered list and collector counts
- **Alerts:** runs `job:missed` (threshold 0) and checks one, and only one, `missed_pickup` alert; checks `handoff` and `recycler_confirmed` alerts are stored, plus mark-as-read. On LocalStack it subscribes a temporary SQS queue to the topic and checks those alerts were actually **delivered through SNS**
- **Monitoring:** `/api/health` reports all four dependencies ok, responses carry `x-request-id`

Along the way it also checks the expected 400/403/404/409 rejections. It finishes with a **qrToken leak sweep**: it records every response a collector received during the run and fails if any contains the resident's token or a `qrToken` field. It reads `.env`, so it works against LocalStack or real AWS (`E2E_API_URL` overrides the API address). Each run adds one resident and one completed pickup, so it can be repeated without resetting data. It exits non-zero if any check fails.

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
| `recy-alerts` | `alertId` | none (scanned; admin-only, small) |

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

**`qrToken` visibility:** the QR token is the resident's proof that the collector was physically there, so it's returned **only to the owning resident and admins**. It is never returned to a collector by any endpoint. This is enforced in one place: `ok()` (`src/utils/response.ts`), the only way handlers send a body, runs every payload through `sanitizeForViewer()` (`src/utils/sanitize.ts`). That function walks the whole response and drops any `qrToken` the caller may not see, so a new endpoint can't leak it even if it forgets `toPickupView()`. `npm run test:unit` pins the rule, exercises `/api/uploads/confirm` over HTTP, and fails if any handler calls `res.json`/`res.send` directly. `npm run test:e2e` and `npm run test:ui` sweep every collector response for leaks.

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
| `GET /api/admin/alerts` | admin | `{ alerts (newest 50), unreadCount }` |
| `PATCH /api/admin/alerts/:id/read` | admin | mark one alert read |
| `POST /api/admin/alerts/read-all` | admin | mark all read → `{ updated }` |
| `GET /api/health` | public | DynamoDB / S3 / SQS / SNS connectivity; 200 or 503 (see Monitoring) |
| `GET /health` | public | liveness only (process is up) |

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

## Alerts (SNS)

| Alert `type` | Raised by | When |
|---|---|---|
| `contamination` | worker | the classifier flags contamination in a photo |
| `handoff` | API (`POST /api/handoffs`) | a collector hands a pickup to a facility |
| `recycler_confirmed` | API (`PATCH /api/handoffs/:id/confirm`) | the recycler confirms receipt |
| `missed_pickup` | `src/jobs/missedPickups.ts` | a pickup has been `assigned` for more than `MISSED_PICKUP_MINUTES` without being collected |

`alertService.raiseAlert()` writes the alert to `recy-alerts` (`alertId, type, pickupId, message, createdAt, read`), then hands it to a `Notifier` (`src/notify/notifier.ts`). `SnsNotifier` publishes to `SNS_TOPIC_ARN` with `type`/`pickupId` message attributes. It's the same code for LocalStack and real AWS; only `AWS_ENDPOINT` differs. With no topic configured, `LogNotifier` just logs. Alerts are side effects of changes that already committed, so a failing store or publish is logged and never fails the request. The missed-pickup alert id is derived from the pickup (`missed-<pickupId>`), so running the job repeatedly alerts once per pickup.

The admin dashboard's **Alerts** panel shows the newest 50 with an unread badge. It refreshes with the stats every 5 s. Clicking an alert marks it read and opens that pickup's chain of custody.

To watch SNS deliveries locally, subscribe a queue and read it:

```bash
aws --endpoint-url http://localhost:4566 sqs create-queue --queue-name alerts-tap
aws --endpoint-url http://localhost:4566 sns subscribe --topic-arn arn:aws:sns:ap-south-1:000000000000:recy-alerts \
  --protocol sqs --notification-endpoint arn:aws:sqs:ap-south-1:000000000000:alerts-tap
aws --endpoint-url http://localhost:4566 sqs receive-message --queue-url http://localhost:4566/000000000000/alerts-tap
```

## Monitoring (CloudWatch stand-in)

**Logs.** API, worker and job all log with [pino](https://getpino.io): one JSON object per line on stdout. On Lambda, **stdout is exactly what CloudWatch Logs ingests** (one log group per function), so these lines are the CloudWatch logs and need no agent or extra code. Locally, the same lines appear in your terminal. Every line has `level`, `time`, `service`, `msg`, plus:

| `event` | Fields | Where |
|---|---|---|
| `request` | `reqId`, `method`, `path`, `status`, `durationMs`, `userId`, `role` | every API request (on finish) |
| `status_transition` | `reqId`, `pickupId`, `from`, `to`, `by`, `durationMs` | every pickup status change |
| `worker_job` | `messageId`, `pickupId`, `outcome` (`classified`/`stale`/`discarded`/`failed`/…), `durationMs`, ML result | every SQS message |
| `job_missed_pickups` | `checked`, `overdue`, `newAlerts`, `thresholdMinutes`, `durationMs` | every missed-pickup run |
| `alert_published` / `alert_publish_failed` | `alertId`, `type`, `pickupId`, `notifier` | every alert |

Each request gets an id (an incoming `X-Request-Id` is reused, e.g. from API Gateway; otherwise a UUID). It is returned in the `X-Request-Id` response header and attached to every line logged while handling that request, including service-level lines like `status_transition`, via `AsyncLocalStorage`. Quote it from a bug report to find everything that request did. Example CloudWatch Logs Insights queries:

```
filter event = "status_transition" | stats count(*), avg(durationMs) by to
filter event = "request" and status >= 500 | sort @timestamp desc
filter reqId = "8426c172-..." | sort @timestamp asc
filter event = "worker_job" | stats count(*) by outcome
```

Metric filters on these fields (e.g. `{ $.event = "worker_job" && $.outcome = "failed" }`) can drive CloudWatch alarms. Set `LOG_LEVEL=debug` for more detail or `silent` to mute.

**Health.** `GET /api/health` checks each dependency in parallel (3 s timeout each): DynamoDB `DescribeTable` on all four tables, S3 `HeadBucket`, SQS `GetQueueAttributes`, SNS `GetTopicAttributes`. It returns `200 {status:"ok"}` or `503 {status:"degraded"}`, with `status`/`latencyMs`/`error` per dependency. Only the error class is returned, never its message, because the endpoint is public. SNS reports `not_configured` (not a failure) when `SNS_TOPIC_ARN` is unset. `GET /health` stays a cheap liveness probe.

## 5-minute demo script

**Before (once):** Docker running → `npm run local:up` → `npm run demo:reset` → `npm run demo`. Open three browser windows side by side. Use separate profiles or private windows, because each window needs its own login.

| Window | Account (password `password123`) | Tip |
|---|---|---|
| **A: Resident** | `arjun.resident@recyconnect.dev` | normal desktop size |
| **B: Collector** | `ravi.collector@recyconnect.dev` | DevTools → device toolbar → a phone (it's the mobile view) |
| **C: Admin** | `admin@recyconnect.dev` | wide window; put it on the projector |

On the login page, click an account in the *Demo accounts* list to fill it in, then **Sign in**.

1. **(0:00) Admin, C: the starting point.** Point out the live stats and the **Alerts** panel. It already has a red unread badge: a **Missed pickup** (Priya's pickup, assigned to Ravi ~1 day ago, flagged by the scheduled job seconds after start) and an older, read **Contamination** alert. Say: "every alert is also published to SNS, so ops get an email or SMS."
2. **(0:45) Resident, A: request a pickup.** Address `12 MG Road, Bengaluru 560001`, category *Plastic*, note "Bottles by the gate" → **Request pickup**. Show the QR code and the code text under it. Only this resident and admins can ever see it.
3. **(1:30) Collector, B: claim it.** **Available** tab → the new pickup → **Claim pickup**. Back in C, the *Assigned* count goes up within 5 s.
4. **(2:00) Collector, B: photo + AI.** **Take / upload photo** → choose `web/public/demo-photos/plastic-bottles.png` (also `paper-cardboard.png`, `mixed-waste.png`). The photo goes straight to S3; *Analysing photo…* turns into the AI category, confidence and contamination badge within a few seconds (S3 → SQS → worker). If contamination is flagged (the mock does this ~15% of the time), a **Contamination** alert appears in C. Use **Retake photo** to try again live.
5. **(2:45) Collector, B: verify presence.** In A, click **Copy code** (or read it out). In B, paste it into *QR code* (or tap **Scan with camera** and point it at A's screen), weight `3.4` → **Confirm collection**. Optional: first paste a wrong code to show the rejection.
6. **(3:30) Collector, B: hand off.** Facility `GreenCycle MRF, Whitefield` → **Record hand-off**. In C, a **Hand-off** alert appears and the unread badge goes up.
7. **(4:00) Admin, C: confirm receipt.** Status filter **Handed off** → **Confirm recycler receipt** on the new row. A **Recycler confirmed** alert appears. Click it to open the full chain of custody: requested → assigned → collected (3.4 kg, photo, AI result) → handed off → completed, with who did each step and when.
8. **(4:40) Close.** A shows *Completed*. Show the `[api]` terminal: JSON log lines with `status_transition`, `from`, `to`, `durationMs`, and the same `reqId` across a request. "On Lambda these go straight to CloudWatch Logs." Optionally open http://localhost:5000/api/health to show all four AWS dependencies green. **Mark all read** to tidy up.

Reset for the next run: Ctrl+C, `npm run demo:reset`, `npm run demo`.

## Deploying to Lambda (later)

1. `npm run build`, zip `dist/` + `node_modules/` (production deps).
2. **API Lambda:** handler `dist/lambda.handler`, Node.js 20, put API Gateway (HTTP API, `ANY /{proxy+}`) in front.
3. **Worker Lambda:** handler `dist/worker/classifier.handler`, timeout ≤ queue visibility timeout, SQS trigger on `recy-classify-queue` with batch item failures enabled.
4. **Missed-pickup Lambda:** handler `dist/jobs/missedPickups.handler`, triggered by an EventBridge schedule (e.g. `rate(5 minutes)`).
5. Give all three an execution role with the permissions from 1a instead of access keys; set the remaining env vars (including `SNS_TOPIC_ARN`) on each function. Their stdout logs land in CloudWatch Logs automatically.

## Known prototype limitations

- Email uniqueness is checked via a GSI query (eventually consistent); a guard item with a conditional put would make it strict.
- Admin stats and collector lists use table scans — fine at prototype scale; switch to pre-aggregated counters (DynamoDB Streams) as data grows.
- Recycler confirmation is done by admins; a `recycler` role is a TODO.
- Alerts are listed with a table scan and kept forever; add a TTL attribute and a `createdAt` GSI before volume grows.
