# Automatic WhatsApp reporting

SISMEPDA sends attendance reports to a WhatsApp group on a fixed daily schedule.
The message text is not a second implementation of the report: it is built by the
same functions that render `/laporan-whatsapp` (`buildClassesNotSubmittedReport`,
`buildStudentAttendanceReport` in `lib/whatsapp-report.ts`). A second query would
eventually disagree with the screen, and the group would be the last place anyone
noticed.

WhatsApp connectivity uses [Baileys](https://github.com/WhiskeySockets/Baileys),
an unofficial WhatsApp Web client. It is pinned to the exact version
`7.0.0-rc14`, not a caret range: the package has no stable release, so `latest`
is itself a release candidate and a caret would silently pull a breaking RC.

## Schedule

| Slot | Time (school timezone) | Message |
|---|---|---|
| 08:00 | 08:00 | Classes that have not submitted attendance |
| 10:00 | 10:00 | Classes that have not submitted attendance |
| 12:00 | 12:00 | Student attendance recap for the day |

Times live in code (`lib/whatsapp-schedule.ts`), not in the database. They are a
school rule, not operator configuration; the database stores only what an
operator owns — the per-message-type toggle and the target group. The school
timezone comes from settings (`readSchoolTimeZone()`), never a hardcoded offset.

Sending is skipped entirely on holidays and non-school days, as decided by
`resolveHoliday()` — the same rule the rest of the application uses.

A slot is only sent within a 20-minute grace window. A worker that was down at
08:00 and started at 11:30 reports the 08:00 slot as missed rather than sending
it: by then the classes have submitted, so the message would be both late and
factually wrong.

## Architecture

The WhatsApp connection is stateful and long-lived, which Next.js request
handlers are not. It therefore runs as a separate persistent process.

| Module | Responsibility | Imports Baileys |
|---|---|---|
| `lib/whatsapp-schedule.ts` | Slot times, idempotency key format | no |
| `lib/whatsapp-messages.ts` | Message text (pure) | no |
| `lib/whatsapp-transport.ts` | Transport contract, status labels, reconnect backoff | no |
| `lib/whatsapp-slots.ts` | Which slots are due now (pure) | no |
| `lib/whatsapp-target.ts` | Group name → JID resolution (pure) | no |
| `lib/whatsapp-session-root.ts` | Environment → session path (pure) | no |
| `lib/whatsapp-baileys.mts` | The adapter | **yes — the only one** |
| `lib/server-whatsapp.ts` | Configuration, history, send with idempotency | no |
| `lib/server-whatsapp-worker-client.ts` | Next.js → worker HTTP client | no |
| `scripts/whatsapp-worker.mts` | The persistent process: scheduler + control API | via adapter |

Baileys is confined to one file so the rest of the feature can be tested against
a fake transport, and so a breaking upgrade has one blast radius.

### Why `.mts`

`lib/whatsapp-baileys.mts` and `scripts/whatsapp-worker.mts` use the ESM
extension deliberately. Baileys 7 depends on `whatsapp-rust-bridge`, which is
ESM-only. If any file in that import chain is a plain `.ts`, tsx loads the whole
chain as CommonJS and the worker dies at startup with
`ERR_PACKAGE_PATH_NOT_EXPORTED` — a runtime failure that neither `tsc` nor
ESLint detects. For the same reason the worker imports by relative path with
`.js`/`.mjs` extensions instead of the `@/` alias, which tsx does not map on the
ESM path. A test asserts all of this.

Because the worker is a plain Node process rather than a bundled Next module,
`lib/server-school-time-zone.ts` cannot use `server-only`; that marker is a
bundler guard and throws outside Next. `lib/server-media-storage.ts` and
`lib/server-holidays.ts`, which are also shared with CLI tooling, already follow
this pattern.

## Worker

The worker is one process with two jobs: run the scheduler loop, and expose a
small control API on `127.0.0.1` for the Next.js app.

| Endpoint | Purpose |
|---|---|
| `GET /status` | Connection state, phone number, display name, connected-since, last disconnect time and translated reason, last error, QR when pairing |
| `POST /connect` | Start connecting / request a QR |
| `POST /reconnect` | Drop and re-establish the connection |
| `POST /logout` | Log out and delete the session |
| `POST /send` | Send one slot immediately ("Kirim sekarang") |

Every endpoint requires `Authorization: Bearer $WHATSAPP_WORKER_TOKEN`. The
worker refuses to start if that variable is unset — an unauthenticated endpoint
that can send messages as the school's WhatsApp account is not an acceptable
default. It binds to loopback only and is never exposed publicly.

Next.js never opens a Baileys socket itself; it only asks the worker. That is
what keeps exactly one WhatsApp connection alive regardless of how many requests
or renders happen.

## Authorization

Three separate permissions, because the consequences differ sharply. Holding one
never widens another.

| Permission | Allows |
|---|---|
| `whatsapp.read` | Connection state, schedule status, send history |
| `whatsapp.connection.manage` | Connect, view QR, reconnect, logout, change toggle and target group |
| `whatsapp.send` | "Kirim sekarang" |

The pairing QR is guarded by `whatsapp.connection.manage`, not `whatsapp.read`,
and is served from its own endpoint (`GET /api/whatsapp/qr`). Anyone who scans it
links their device to the school WhatsApp account, so it must not travel in the
status payload every reader receives. `withoutQr()` strips it on the other
routes.

Authorization never inspects role names; every route calls `requirePermission()`
through `lib/whatsapp-access.ts`.

## API

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/whatsapp` | `whatsapp.read` | Status, today's schedule, history. A dead worker is reported as a readable error state, not a 500 — an offline worker is a normal operational condition that must be visible on screen |
| `GET /api/whatsapp/qr` | `whatsapp.connection.manage` | QR only; never persisted |
| `POST /api/whatsapp/connection` | `whatsapp.connection.manage` | `connect` / `reconnect` / `logout` |
| `GET /api/whatsapp/configuration` | `whatsapp.read` | Config plus group list when connected |
| `PATCH /api/whatsapp/configuration` | `whatsapp.connection.manage` | Toggle and target group |
| `POST /api/whatsapp/send` | `whatsapp.send` | Manual send |

Schedule times are not writable through the API. They are a school rule in
`lib/whatsapp-schedule.ts`; making them editable would give code and database two
competing truths.

A duplicate target group name returns `409` rather than silently picking the
first match — choosing wrongly would send the student attendance recap to the
wrong group with nobody noticing.

Manual sends pass a `MANUAL` slot marker instead of borrowing a scheduled hour.
`ATTENDANCE_MISSING` has two slots (08:00 and 10:00); borrowing one would make a
manual send look like a scheduled one in both the schedule card and the history.
The worker fixes `trigger: "MANUAL"` itself rather than reading it from the
request body, so a caller cannot impersonate a scheduled send and write an
idempotency key that blocks that day's real schedule.

## Admin page

`/whatsapp` (`app/whatsapp/page.tsx`), reached from **Komunikasi & Data →
WhatsApp Otomatis**, gated by `whatsapp.read`.

The server component resolves capabilities and passes them down as
`canManageConnection` and `canSend`; the client never infers its own rights
from the session. Hiding a button is convenience — enforcement stays in the
route handlers, so a hand-crafted `fetch` gains nothing.

`components/whatsapp/whatsapp-panel.tsx` is a client component and therefore
imports only pure modules (`whatsapp-transport`, `whatsapp-schedule`). Importing
a value from `lib/server-*` would pull `pg` into the browser bundle and break
`next build` with `Can't resolve 'util/types'`; a test locks this boundary.

The panel shows:

- connection state, phone number, profile name, connected-since, last
  disconnect time and a translated reason;
- connect / reconnect / logout, for `whatsapp.connection.manage` only;
- the QR code, polled every 5 s and **only** while the state is `WAITING_QR`
  and the viewer may manage the connection;
- per-schedule toggle, per-slot delivery state, and "Kirim sekarang";
- delivery history separating manual from scheduled sends, naming the operator
  who triggered a manual send.

Status is polled every 10 s because the connection changes without any user
interaction — the socket drops, the worker reconnects, a scheduled send fires.

## Audit

Every state-changing action writes to the shared `AuditLog`:
`WHATSAPP_CONNECTION_STARTED`, `WHATSAPP_CONNECTION_RECONNECTED`,
`WHATSAPP_LOGGED_OUT`, `WHATSAPP_SCHEDULE_TOGGLED`,
`WHATSAPP_MESSAGE_SENT_MANUALLY`. Manual sends are logged whatever the outcome —
a refused or skipped attempt is as worth tracing as a successful one. Read-only
endpoints write nothing; logging every poll would drown the trail it exists to
provide. Audit entries record connection state and phone number only, never
session credentials.

## Session storage

The pairing credential lives in a directory on disk, outside the repository and
outside the image:

- path from `WHATSAPP_SESSION_DIR` (`lib/whatsapp-session-root.ts`)
- in production, a Docker named volume mounted into the worker only
- `.gitignore` excludes session directories
- never returned by any API, never rendered in the browser

It survives application rebuilds, so a redeploy does not require re-scanning a
QR code.

## Idempotency

`WhatsAppSendLog.idempotencyKey` is unique and derived from date, slot and
message type. A scheduled send that already happened cannot be repeated, even if
the worker restarts mid-loop.

Manual sends store `NULL` in that column. PostgreSQL treats each `NULL` as
distinct in a unique index, so an operator can resend deliberately while the
scheduler still cannot double-send — one column, no second constraint.

Every row snapshots the message text it sent, because the underlying attendance
data changes afterwards and the history must show what was actually delivered.

## Running it

Locally:

```
npm run whatsapp:worker:local
```

In production, the worker is a second service in an overlay compose file,
`compose.whatsapp.yaml`, applied alongside `deploy.yaml` and
`compose.media.yaml` the same way the media overlay is. It shares the
application image, runs `restart: unless-stopped`, and depends on no interactive
terminal — an SSH session closing does not stop it.

First-time pairing requires scanning a QR code once from the admin page. That is
a deliberate manual step and is never performed automatically.

## Configuration

| Variable | Purpose |
|---|---|
| `WHATSAPP_WORKER_TOKEN` | Shared secret between app and worker. Required. |
| `WHATSAPP_WORKER_URL` | Where Next.js reaches the worker. |
| `WHATSAPP_WORKER_PORT` | Worker listen port (loopback). |
| `WHATSAPP_SESSION_DIR` | Session/credential directory. |

`WHATSAPP_WORKER_TOKEN` lives in `/etc/sismepda/sismepda.env` on the host, which
is outside Git and survives every `git` operation. Both the app and the worker
read the same value through the overlay. The worker **refuses to start** when it
is empty — without it, anything on the Docker network could send messages as the
school. Generate it once with `openssl rand -hex 32`; see
`.env.production.example`.

Deploy preflight reports `WHATSAPP_OVERLAY=` and `WHATSAPP_TOKEN=` as
`present`/`absent`. Only that verdict is printed — the token value never reaches
a deploy log.

### Why the worker file is `.mts`

`scripts/whatsapp-worker.mts` and `lib/whatsapp-baileys.mts` are true ESM
modules, and the extension is load-bearing. Baileys 7 depends on
`whatsapp-rust-bridge`, which is ESM-only; if any file in that import chain
becomes `.ts`, tsx loads the whole chain as CommonJS and the worker dies at
startup with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

That failure is invisible to `tsc` and to lint, so it is pinned by tests
instead: `tests/whatsapp-worker.test.ts` asserts that the compose `command:`
names a worker file that actually exists on disk, and that no `.ts` variant is
referenced anywhere. The overlay also builds from the `migrator` image stage,
the only stage carrying tsx plus `lib/` and `scripts/`.

### Checking the worker in production

```bash
ssh smpn2
cd /srv/apps/sismepda

docker compose -f deploy.yaml -f compose.media.yaml -f compose.whatsapp.yaml \
  --env-file /etc/sismepda/sismepda.env ps

docker compose -f deploy.yaml -f compose.media.yaml -f compose.whatsapp.yaml \
  --env-file /etc/sismepda/sismepda.env logs --tail=100 whatsapp-worker
```

`whatsapp-worker` must show `Up`. A healthy start logs the listen port and the
session path. Otherwise the first log lines name the cause:

| Log | Cause |
|---|---|
| `WHATSAPP_WORKER_TOKEN belum diatur; worker berhenti.` | Token missing in the env file |
| `Cannot find module .../whatsapp-worker.ts` | Compose points at a file that does not exist |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | ESM chain broken — a `.mts` file became `.ts` |
| `Can't reach database server` | `DATABASE_URL` wrong, or worker not on the `database` network |
| `sesi: /app/whatsapp-session (configured)` then repeated QR | Session volume not mounted |
| `gagal menyambung saat start` | Baileys/WhatsApp connectivity, session intact |

### Do not delete the session volume

`sismepda_whatsapp_session` holds WhatsApp **credentials**. It is not part of a
PostgreSQL dump, so a database backup does not restore it. Removing it — or
letting the volume name drift — forces a fresh QR pairing. Restarting or
redeploying the container does not: shutdown closes the socket without logging
out, which is why pairing is needed only on first setup or after an explicit
logout.
