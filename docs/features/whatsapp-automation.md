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
