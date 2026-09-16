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

Times are operator configuration, stored per message type in
`WhatsAppConfiguration.slots` and edited from the WhatsApp page. School hours
move — exam weeks, Ramadan, a new start time — and requiring a release for each
shift made the on-screen schedule slowly drift from what was actually sent.

`WHATSAPP_SCHEDULE[].defaultSlots` in `lib/whatsapp-schedule.ts` is **only** a
migration seed for rows never configured by an operator:

| Message | Seeded slots |
|---|---|
| Classes that have not submitted attendance | 08:00, 10:00 |
| Student attendance recap for the day | 12:00 |

The scheduler re-reads the configured slots on every tick, so an edit takes
effect without restarting the worker. Slots are validated by `normalizeSlots()`
(`lib/whatsapp-slot-config.ts`) on both the client and the server: `HH:mm`,
no duplicates, sorted ascending. An empty list is legal and means the type is
simply not scheduled.

The school timezone comes from settings (`readSchoolTimeZone()`), never a
hardcoded offset.

Sending is skipped entirely on holidays and non-school days, as decided by
`resolveHoliday()` — the same rule the rest of the application uses. The guard
sits in `sendWhatsAppMessage()` before the report is read, before the template
is chosen, and before the occurrence is claimed, so a holiday cancels all four
message conditions at once rather than each one separately. It applies to
scheduled sends only: a manual send stays available, because the operator
pressing the button knows what day it is. The outcome is `SKIPPED`/`HOLIDAY`,
not `FAILED` — not sending on a holiday is correct behaviour, not a fault.

A slot is only sent within a 20-minute grace window. A worker that was down at
08:00 and started at 11:30 reports the 08:00 slot as missed rather than sending
it: by then the classes have submitted, so the message would be both late and
factually wrong.

## Message templates

The text of every automatic message is editable by an admin on the WhatsApp page
and stored in `WhatsAppConfiguration.messageTemplates` (`Json?`). Templates are
data, not code: there is no expression language, no conditionals and no
evaluation — only placeholder substitution against an explicit registry.

### Four conditions, chosen by the system

The admin never writes a condition. `templateKeyFor()` picks one of four:

| Key | Chosen when |
|---|---|
| `MISSING_PENDING` | Reminder, and at least one class has not submitted |
| `MISSING_COMPLETE` | Reminder, and every class has submitted |
| `ABSENT_PRESENT` | Attendance report, and at least one student is absent |
| `ABSENT_NONE` | Attendance report, and nobody is absent (NIHIL) |

`ABSENT_NONE` is a separate template rather than `ABSENT_PRESENT` with an empty
list, because the NIHIL message has a different shape, not merely less content.

### Placeholders

Scalars available to every template: `tanggal`, `waktu`, `nama_sekolah`,
`jumlah_kelas`, `jumlah_kelas_sudah_rekap`, `jumlah_kelas_belum_rekap`,
`jumlah_siswa`, `jumlah_hadir`, `jumlah_tidak_hadir`, `jumlah_sakit`,
`jumlah_izin`, `jumlah_dispensasi`, `jumlah_alfa`.

Collection placeholders are restricted to the templates where they mean
something: `daftar_kelas_belum_rekap` only on `MISSING_PENDING`, and
`daftar_siswa_tidak_hadir` only on `ABSENT_PRESENT`. Each has its own item
format and separator (one newline or a blank line), with its own placeholders:

| Collection | Item placeholders |
|---|---|
| `daftar_kelas_belum_rekap` | `no`, `nama_kelas`, `tingkat`, `wali_kelas`, `jumlah_siswa_belum_diisi` |
| `daftar_siswa_tidak_hadir` | `no`, `nama_siswa`, `nama_kelas`, `tingkat`, `status`, `keterangan` |

`wali_kelas` comes from `SchoolClass.homeroomUser` and `keterangan` from
`Attendance.note`; both are real columns, and both fall back to `-` when empty.
Absent rows are ordered SAKIT → IZIN → ALFA → DISPENSASI, which reproduces the
grouping of the original message without needing conditionals in the template.

### Validation

`validateTemplate()` runs on the client and again in the route handler, because
the screen can be bypassed and a mistyped variable would otherwise send broken
text to the school group every day. An unknown placeholder is reported by name
(`Variabel tidak dikenal: {{jumlah_sakitt}}`) and blocks saving; empty bodies and
over-long bodies are rejected too. Substitution is single-pass, so data that
happens to contain `{{...}}` is printed literally and never re-interpreted.
Multiline text, emoji and WhatsApp's own `*bold*` / `_italic_` / `~strike~` pass
through untouched.

### Fallback

Fallback is per condition, not per row. Any condition that has no valid stored
template uses the built-in text from `lib/whatsapp-template-defaults.ts`, which
reproduces the message SISMEPDA sent before templates existed. A row whose JSON
is corrupt or partially invalid therefore still sends the remaining three
conditions normally, and an installation that never opens the editor sees no
change at all. "Restore defaults" writes `NULL` rather than a copy of the
built-in text, so later improvements to the defaults still reach that row.

Two deliberate differences from the old text: the "Catatan: N kelas belum
mengisi absensi" line on the attendance report and the per-status counts now
always appear, because a template cannot know a condition. Both read `0` when
they do not apply.

### Preview

The preview renders in the browser from labelled sample data in
`lib/whatsapp-template-sample.ts`. It is not an endpoint and has no path to the
transport, so it cannot send anything.

## Architecture

The WhatsApp connection is stateful and long-lived, which Next.js request
handlers are not. It therefore runs as a separate persistent process.

| Module | Responsibility | Imports Baileys |
|---|---|---|
| `lib/whatsapp-schedule.ts` | Message type definitions, seed slots, idempotency key format | no |
| `lib/whatsapp-slot-config.ts` | Slot validation, dedupe, sorting (pure) | no |
| `lib/whatsapp-messages.ts` | Shared report helpers: class/slot labels, incomplete-class filter (pure) | no |
| `lib/whatsapp-template.ts` | Placeholder registry, validation, rendering (pure) | no |
| `lib/whatsapp-template-defaults.ts` | Built-in text for the four conditions (pure) | no |
| `lib/whatsapp-template-context.ts` | Report data → placeholder values, condition selection (pure) | no |
| `lib/whatsapp-template-store.ts` | Parsing stored JSON, per-condition fallback (pure) | no |
| `lib/whatsapp-template-sample.ts` | Sample data for the preview (pure) | no |
| `lib/whatsapp-transport.ts` | Transport contract, status labels, reconnect backoff | no |
| `lib/whatsapp-slots.ts` | Which configured slots are due now (pure) | no |
| `lib/whatsapp-target.ts` | Destination resolution: default/override, JID validation, display labels (pure) | no |
| `lib/whatsapp-session-root.ts` | Environment → session path (pure) | no |
| `lib/whatsapp-session-store.ts` | Session presence check and credential wipe | no |
| `lib/whatsapp-session-lock.ts` | Cross-process single-owner lock | no |
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
| `POST /reconnect` | Drop and re-establish the connection, reusing credentials |
| `POST /relogin` | Discard the old session and request a fresh QR |
| `POST /logout` | Log out and delete the session |
| `GET /groups` | Group list; `409 NOT_CONNECTED` unless the session is live |
| `POST /resolve-target` | Group name → JID; `409 NOT_CONNECTED` unless the session is live |
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

### Report data: authorization is a boundary, not a query concern

The report query and the permission check are separate functions, because two
callers with different natures read the same data:

```
web request  → requirePermission("reports.whatsapp.read.all") → report data
worker       → report data
```

| Function | Module | Authorization |
|---|---|---|
| `readWhatsAppReportClasses(date)` | `lib/server-whatsapp-report.ts` | none — data only |
| `getWhatsAppReportClasses(date)` | `lib/whatsapp-access.ts` | requires `reports.whatsapp.read.all` |

The worker is a plain Node process: it has no request, no cookie and no user
session, so `auth()` has nothing to read. When the permission check lived inside
the query, the worker's import chain
(`whatsapp-worker.mts` → `server-whatsapp.ts` → `server-whatsapp-report.ts` →
`rbac-access.ts` → `@/auth`) pulled Auth.js into a process that cannot use it —
and since `auth.ts` is not copied into the worker image, production crash-looped
with `Cannot find module '@/auth'`.

This is not an RBAC bypass. The worker gets no identity, no role and no generic
exemption; it simply never passes through user authorization, because it is a
trusted internal service startable only from the deployment. Everything a user
can reach still goes through the permission-checking wrapper, and web surfaces
must never call the `read...` function directly. A test walks the worker's real
import graph transitively and fails if `auth.ts`, `rbac-access.ts` or any
`next-auth` package reappears in it.

## API

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/whatsapp` | `whatsapp.read` | Status, today's schedule, history. A dead worker is reported as a readable error state, not a 500 — an offline worker is a normal operational condition that must be visible on screen |
| `GET /api/whatsapp/qr` | `whatsapp.connection.manage` | QR as a PNG data URL; never persisted, never logged |
| `POST /api/whatsapp/connection` | `whatsapp.connection.manage` | `connect` / `reconnect` / `relogin` / `logout` |
| `GET /api/whatsapp/configuration` | `whatsapp.read` | Config plus group list when connected |
| `PATCH /api/whatsapp/configuration` | `whatsapp.connection.manage` | Toggle, destination mode, per-type group, schedule slots, message templates |
| `PUT /api/whatsapp/configuration` | `whatsapp.connection.manage` | Default destination group |
| `POST /api/whatsapp/send` | `whatsapp.send` | Manual send |

Schedule times are writable through `PATCH`, and the server re-runs
`normalizeSlots()` on whatever arrives. The client is not a guard: a request can
reach the route without passing through the screen.

Message templates use the same `PATCH` with `scope: "templates"`. The server
re-validates every placeholder and rejects an unknown one with `400`. Sending
`templates: null` restores the built-in text for that message type.

The destination is chosen by JID, never by name. A duplicate group name used to
return `409`; that error class no longer exists, because the operator picks from
a list and the client submits the JID. See "Destination groups" below.

Manual sends pass a `MANUAL` slot marker instead of borrowing a scheduled hour.
`ATTENDANCE_MISSING` normally has several slots; borrowing one would make a
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

- the connection state in plain language ("Perlu login ulang"), never the
  internal enum as the primary information; the raw state, disconnect category,
  error code and last heartbeat live in a collapsed "Detail teknis" section for
  admins who need to trace an incident;
- phone number, profile name, connected-since, last disconnect time and a
  translated reason;
- exactly the connection actions that make sense for the current state, for
  `whatsapp.connection.manage` only;
- the QR code as a scannable image, polled every 5 s and **only** while the
  state is `WAITING_QR` and the viewer may manage the connection;
- per-schedule toggle, per-slot delivery state, and "Kirim sekarang";
- a collapsed "Format Pesan Otomatis" section per message type, holding the
  template editor for that type's conditions, the list of available variables,
  the per-item format for collections, a sample-data preview and "Kembalikan ke
  template bawaan"; shown only to `whatsapp.connection.manage`;
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

## Networking

The worker sits on **two** Docker networks, and needs both:

| Network | Internal | Purpose |
|---|---|---|
| `sismepda_database` | yes | Reach PostgreSQL; be reached by the app as `whatsapp-worker:3100` |
| `sismepda_whatsapp_egress` | no | Outbound access to WhatsApp |

The database network is created with `internal: true`. Docker gives containers
attached only to an internal network no default route and no outbound DNS, so a
worker with just that network starts, listens and queries the database
correctly while every outbound name resolution fails with `EAI_AGAIN`. The
failure surfaces far from its cause: Baileys cannot fetch the live WA Web
version (falling back to a pinned one, logged as `terbaru: tidak`), and the
handshake is then closed with status 408 before any QR is issued.

The egress network is an ordinary bridge declared in `compose.whatsapp.yaml`.
It adds outbound NAT only — no host port is bound and nothing can route inward
— and only the worker joins it. PostgreSQL stays confined to the internal
network and gains no internet path.

Two fixes are deliberately **not** used: making the database network
non-internal would expose PostgreSQL as well, and attaching the worker to the
reverse-proxy network would place it alongside the public-facing surface for
traffic that only ever flows outward.

## Pairing

Pairing is the one part of this feature that depends on WhatsApp's own moving
parts, so the adapter pins nothing and asks the server instead.

**Protocol version.** `fetchLatestWaWebVersion()` reports the version
`web.whatsapp.com` is actually serving right now. `fetchLatestBaileysVersion()`
reads the Baileys repository's metadata, which lags behind the server; once it
lags far enough WhatsApp rejects the handshake and no QR is ever issued. The
version is never hardcoded — a pinned version becomes wrong the moment WhatsApp
raises theirs, and silently.

**Browser identity.** The socket must present the web tuple
(`Browsers.ubuntu("SISMEPDA")`). Desktop subplatforms (`WIN32`, `DARWIN`) are
rejected with 428 before a QR appears; QR pairing is a web-client flow.

**The QR is an image, never a string.** `GET /api/whatsapp/qr` renders the
payload to a PNG data URL server-side; the raw payload never reaches the
browser, the DOM, the database, or any log. A raw payload cannot be scanned
anyway, and it links any device that copies it to the school account.

### Diagnosing a failed connection

`DisconnectReason.connectionLost` and `DisconnectReason.timedOut` are **both
408**, and `connectionClosed` is **428**. Matching on the enum therefore reports
every 408 as a network fault, including a handshake that timed out before
pairing — which is why a broken pairing used to look like a flaky connection.

The adapter maps raw status numbers instead, and uses "has a QR been issued yet"
to split the collision: a 408 before any QR is a handshake failure
(`HANDSHAKE_FAILED`), a 408 after one is a genuine network drop (`NETWORK`).

On close the adapter logs the raw status code, the category, the previous state,
whether a QR had been issued, and the error name — metadata only. Credentials,
auth state, QR payloads, tokens and message content are never logged.

| Status | Meaning |
|---|---|
| 401 | Logged out — requires a human to scan a new QR |
| 403 | Account refused by WhatsApp |
| 408 before QR | Handshake timed out |
| 408 after QR | Network drop; reconnect is automatic |
| 411 | Multi-device version mismatch |
| 428 | Closed before the session formed |
| 440 | Session taken over by another device |
| 500 | Session files corrupt |
| 503 | WhatsApp unavailable |
| 515 | Restart requested |

Each status maps to one policy object (`classifyDisconnect`) carrying the
category, the next state, whether to reconnect, and whether a new login is
required. The rule that matters: **a policy that requires a new login never asks
for a reconnect.** Retrying with revoked credentials never succeeds; it only
repeats until WhatsApp rate-limits the school's number. `shouldReconnect` is the
single home for that decision and the adapter defers to it.

### Connection states

| State | Meaning | Offered action |
|---|---|---|
| `UNPAIRED` | No credentials on disk | Hubungkan WhatsApp |
| `CONNECTING` | Socket opening | disabled button |
| `WAITING_QR` | QR issued, waiting for a scan | Batalkan penautan |
| `CONNECTED` | Live session | Keluar & hapus sesi |
| `DISCONNECTED` | Temporary drop, credentials still valid | Sambungkan ulang |
| `LOGGED_OUT` | Session invalid, credentials revoked | Login ulang (new QR) |
| `ERROR` | Account refused | Coba sambungkan lagi |

`connectionActionsFor(state, sessionExists)` derives the buttons; the panel only
renders what it returns. "Hubungkan" and "Sambungkan ulang" can never appear
together, because they mean different things and showing both forces the admin to
guess. A `DISCONNECTED` state with no credentials on disk offers pairing rather
than a reconnect that has nothing to reconnect to.

`sessionExists` is read from `creds.json` on disk, not inferred from the
connection state, so a stored pairing still reports as present while the socket
is down — the difference between "never paired" and "paired but disconnected".

### One socket per session

Baileys credentials identify **one linked device**. Two sockets loading the same
session directory present the same identity; WhatsApp takes the session over
(440) and then unlinks it (401) minutes after a successful pairing. That is the
"paired, then logged out a few minutes later" symptom.

Two guards, because there are two ways to get a second socket:

- **Within the process** — each socket open bumps a `generation` counter, and
  `connection.update` events from an older generation are ignored. Baileys does
  not detach listeners when a socket ends, so a dead socket can still emit and
  overwrite correct state. `connect()` is idempotent: calling it while a socket
  is already live is logged and ignored, so a double-clicked button cannot open a
  second socket.
- **Across processes** — `lib/whatsapp-session-lock.ts` keeps an `owner.lock`
  file inside the session directory holding a random owner id and a heartbeat.
  A worker that finds a fresh lock owned by someone else exits instead of
  starting. A stale lock (no heartbeat within `LOCK_STALE_MS`) is taken over, so
  a container killed with `SIGKILL` does not lock the session forever. The check
  is time-based, not PID-based: every container has a PID 1, so PIDs mean nothing
  across containers. The lock file holds no credentials.

This is what a deploy that leaves the old worker running, a local worker pointed
at the production volume, or a second replica would otherwise cost.

### Logout is idempotent

"Keluar & hapus sesi" promises a clean state, and a clean state must not depend
on WhatsApp being reachable. Remote logout is attempted first so the device
really leaves the linked-devices list, but its failure — which is certain when
the session is already invalid, since there is no socket to ask — never aborts
the operation. Local cleanup runs outside that `try`.

The order matters: stop reconnecting, close the socket, then wipe credentials. A
live socket would rewrite `creds.json` after deletion and leave the session
half-populated. `discardSessionCredentials` removes the directory, and falls back
to emptying its contents when the directory itself cannot be unlinked — in
production it is a volume mount point. Partial credentials are worse than none:
Baileys loads them, WhatsApp rejects them, and the panel shows a pairing that
never connects.

After a successful wipe the state is `UNPAIRED`, not `LOGGED_OUT`: with no
credentials left, "not yet linked" is the honest description, and it offers the
right button.

### Destination groups

Every message type sends to a group, and the group is identified by **JID**
(`120363…@g.us`). Group names change; a name is a label, never an address.

Two levels, both stored in PostgreSQL:

- `WhatsAppSetting` (singleton row, id `default`) holds the default destination:
  `defaultGroupJid` plus `defaultGroupName` as a display snapshot.
- `WhatsAppConfiguration.destinationMode` is `DEFAULT` or `OVERRIDE`. Under
  `OVERRIDE` the row's own `targetGroupJid` wins.

`resolveDestination()` in `lib/whatsapp-target.ts` is the only place that
decides where a message goes, and `sendWhatsAppMessage()` is its only caller —
so scheduled sends and "Kirim sekarang" cannot drift apart. `OVERRIDE` with an
empty JID resolves to `NOT_RESOLVED`, never to the default: an operator who
chose "different group" has stated this report must *not* follow the default,
and guessing would send to the group they were avoiding.

Unresolved destinations are recorded as `SKIPPED` (`NO_TARGET` /
`INVALID_TARGET`). The scheduler keeps running; it never picks a fallback group.

`automaticBlockFor()` guards the automatic toggle, enforced in the API route and
not only in the UI. History stores the JID and name snapshot that were used at
send time, so renaming a group later does not rewrite where past messages went.

If a saved JID is missing from the current group list, the UI says so and leaves
the configuration untouched. Silently reassigning the destination would move the
recap to another group with nobody noticing — and an empty list usually means the
session is merely down, not that the group is gone.

### Group listing requires a live session

Group names only exist after the session forms. Both `GET /groups` and
`POST /resolve-target` check the state first and answer `409 NOT_CONNECTED`,
because asking too early is an ordinary condition, not a fault — returning 500
floods the worker log with stack traces on every page load. `workerGroups()`
checks the state before calling at all, and the configuration route swallows
only `NOT_CONNECTED`; every other failure is still logged, so real problems stay
visible.

## Idempotency

`WhatsAppSendLog.idempotencyKey` is unique and derived from date, slot and
message type. A scheduled send that already happened cannot be repeated, even if
the worker restarts mid-loop.

**The claim is written before the message is sent.** This ordering is the whole
mechanism, not a detail. Previously the message went out first and the row was
written afterwards, so the unique constraint rejected only the *record* — the
message had already been delivered. Because the scheduler ticks every minute and
a slot stays due for a 20-minute grace window, the same occurrence was re-sent
every minute until the window closed.

Now a `PROCESSING` row is inserted first. A second writer — a concurrent tick, a
second worker, or the same worker after a restart — is rejected by PostgreSQL
before the transport is touched, and the send is skipped. The claim is then
resolved to `SENT` or `FAILED`.

A failed claim stays `FAILED` and is **not** deleted. It still owns the
occurrence, so a transport failure is not retried every minute for the rest of
the grace window. The status chips read these rows directly, which is why
"Terkirim" means a delivery actually succeeded rather than that the clock passed
the slot.

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
| `Cannot find module '@/auth'` | The worker import chain reached user authorization — see "Report data" above |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | ESM chain broken — a `.mts` file became `.ts` |
| `Can't reach database server` | `DATABASE_URL` wrong, or worker not on the `database` network |
| `sesi: /app/whatsapp-session (configured)` then repeated QR | Session volume not mounted |
| `gagal menyambung saat start` | Baileys/WhatsApp connectivity, session intact |
| `koneksi_tertutup ... status=428 ... qr_pernah_terbit=tidak` | Handshake refused before pairing — check the WA Web version line and that the browser tuple is still web |
| `koneksi_tertutup ... status=408 ... qr_pernah_terbit=tidak` | Handshake timed out before a QR was issued; not a network fault |
| `koneksi_tertutup ... status=401` | Logged out — a human must scan a new QR |
| `koneksi_tertutup ... status=440` | Session taken over — another socket used the same credentials; see "One socket per session" |
| `sesi ... sedang dipegang worker lain` then exit | A second worker found a live lock and refused to start — this is the guard working |
| `EAI_AGAIN` for any hostname | Worker has no egress — check it is on `sismepda_whatsapp_egress`, see "Networking" |
| `versi WA Web ... (terbaru: tidak)` | Version fetch failed and fell back; usually the same egress fault |
| No `versi WA Web ...` line at all | Version fetch failed; Baileys fell back to its built-in version |

Verifying worker connectivity:

```bash
# Both networks must be listed.
docker inspect sismepda-whatsapp-worker-1 \
  --format '{{range $name, $conf := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}'

# DNS must resolve; EAI_AGAIN means the egress network is missing.
docker exec sismepda-whatsapp-worker-1 node -e \
  "require('node:dns').lookup('web.whatsapp.com',(e,a)=>console.log('error=',e,'address=',a))"

# Outbound HTTPS must reach WhatsApp.
docker exec sismepda-whatsapp-worker-1 node -e \
  "fetch('https://web.whatsapp.com/sw.js').then(r=>console.log('status=',r.status)).catch(e=>console.error(e.cause??e))"
```

### Do not delete the session volume

`sismepda_whatsapp_session` holds WhatsApp **credentials**. It is not part of a
PostgreSQL dump, so a database backup does not restore it. Removing it — or
letting the volume name drift — forces a fresh QR pairing. Restarting or
redeploying the container does not: shutdown closes the socket without logging
out, which is why pairing is needed only on first setup or after an explicit
logout.
