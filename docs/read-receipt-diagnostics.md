# Saved read-status logs

Fernblick records the facts needed to investigate read-status failures later. It does not capture chats or user activity, upload logs, or use an external monitoring service.

## Phone / browser

Open **Settings → Read-status logs**:

- **View logs** opens selectable plain text.
- **Copy logs** copies the current saved history. If clipboard access is blocked, the text opens for manual selection/copying.
- **Clear logs** removes this origin's saved history and the displayed copy. New attempts can produce new entries afterward. Open views in other tabs refresh on storage changes.

This works without the backend. Records are saved as separate `localStorage` entries (prefix `fernblick.read-log.v1.`), not in cookies or the service-worker cache. Separate attempt keys avoid tabs overwriting one shared array; there is no in-memory backlog that can restore cleared records. Concurrent writes/pruning are best effort, not a transactional audit trail.

Limits are the newest **200 records**, **128 KiB** of serialized record/key text, and **seven days**. Old entries are pruned on writes, viewing and copying. A closed app cannot run scheduled deletion, so expired physical data may remain until the next launch/access or browser cleanup. Invalid/future/unknown-schema records are removed rather than displayed. Storage access/quota failures never change receipt handling; they can mean an event was not saved. Clearing site data, browser eviction, private browsing or switching scheme/host/port can remove or separate history. Browser storage is not a confidential vault against same-origin scripts or access to the device profile.

Browser Console also receives the same records for live debugging. Developer tools are not required to retrieve saved history; console-only records may disappear after closing the page.

## Server files

Production startup configures a dedicated async file writer:

- `FERNBLICK_LOG_DIR`, default **`~/.local/state/fernblick/logs`**.
- Use a stable persistent directory outside the checkout/build/deployment directory. Each independently running backend/worktree must use a **distinct directory**; multiple backend writers sharing one directory are not supported.
- Directory must be owned by the backend user, exactly **0700**, and resolve without symlinks. Managed files must be owned private regular **0600**, non-hard-linked files. Unsafe destinations are rejected rather than followed or repaired silently.
- Files are newline-delimited JSON, named `read-receipt.<collection-time-ms>-<random-uuid>.ndjson`. Each segment is at most **1 MiB** and rotates at most **hourly** when new events arrive.
- Managed files have a total **100 MiB** budget, including old segments. The writer reserves the full next segment before creating it and removes oldest files first. It does not delete unrelated/unrecognized files.
- Segments expire **seven days after their first event's collection time**. Cleanup runs on startup, before rotation, and once per minute while running. A segment's newer events can therefore expire up to an hour earlier than seven days. Nothing is deleted while Fernblick is stopped. Capacity pressure can shorten coverage further; seven days is not a guaranteed minimum history.
- Queuing is bounded to **128 records** (under 256 KiB of schema-limited event data), with at most 64 queued routine records and failure priority over routine records. Disk work is serialized; receipt requests do not await it. Missing/full/unwritable storage produces at most one safe `read_receipt_log_unavailable` stderr notice per minute, never raw exception text. Subsequent saved events count dropped writes/queue events.

Already-written records survive a backend restart/redeploy if this directory is retained. Graceful shutdown drains the queue; abrupt termination can lose queued or unsynced records. This is troubleshooting history, not a transaction journal or a guarantee against power loss. Treat truncated last lines after a crash as incomplete records.

Only application records go into these files. They are not also copied to server stdout/stderr in production. Startup/crash notices still use stdout/stderr and can be retained by a process supervisor (see HER-22). Tests/embedded servers without a configured file sink fall back to console logging; they do not write to the default user's directory.

### Retrieve a report

As the backend user, substitute the actual configured directory:

```sh
LOG_DIR="$HOME/.local/state/fernblick/logs"
# Find all records for the UUID copied from the phone:
grep -h -F 'the-request-uuid' "$LOG_DIR"/read-receipt.*.ndjson

# Optional: inspect one incident window, skipping incomplete final lines:
cat "$LOG_DIR"/read-receipt.*.ndjson |
  jq -Rrc 'fromjson? | select(.timestamp >= "2026-10-29T12:00:00Z" and .timestamp < "2026-10-29T12:15:00Z")'
```

Do not expose these files through the web server. Share only relevant records through a private channel and remove temporary extracts under the same retention policy. No matching record can mean suppression, expiry, unavailable storage or a request that never reached the server—not proof of what happened.

## Fields and interpretation

Every record has `event: "read_receipt"`, `schemaVersion: 1`, UTC `timestamp`, emitting frontend/backend `build` revision (`development`/`unknown` if unavailable), `severity`, `operation` (`save`, `load`, `cleanup`), `boundary` (`client`, `request`, `persistence`), safe `requestId`, `category`, `durationMs`, `suppressed`, and `dropped`. HTTP `status` and a reviewed OS `errorCode` are included when observable.

Each browser save gets a random UUIDv4 sent in `X-Fernblick-Read-Request-Id`. The backend validates the value, generates a replacement for invalid/missing IDs, echoes it in that response header, and passes it to receipt persistence. IDs are untrusted correlation hints, not identity or authorization. Retries get fresh IDs. Dashboard load/cleanup events use separate server-generated IDs. Phone clocks may differ from the server; use the request ID first and broaden time searches.

- **Client network / timeout / aborted:** transport loss, the existing ten-second deadline, or another observed abort. A browser-only failure cannot appear in server logs unless it actually reached the server or the user shares the saved phone record later.
- **HTTP:** non-2xx response, even when its body is invalid JSON.
- **Response validation:** malformed JSON or invalid success acknowledgement. **Request validation:** invalid input before saving.
- **Stale:** expected 404/409 after an agent disappears or its answer changes; informational, not an operator emergency.
- **Dependency:** Herdr snapshot/session failure. **Storage** at the persistence boundary isolates receipt directory/file/sync problems; allowlisted codes such as ENOSPC/EACCES can clarify the cause without leaking paths. **Unexpected** is an unclassified request exception; look for its matching persistence record.
- A persistence success plus a client timeout/network failure can mean the write finished but its acknowledgement was lost. An aborted HTTP response does not cancel an in-progress save. Diagnostic records must not be used to replay agent actions.

Each logger allows **30 routine and 30 failure records per minute**, separately. The browser has one page-local logger; each backend has separate request/persistence loggers. Successes and expected stale responses consume only the routine allowance; routine traffic cannot suppress a later error through that allowance. Repeated failures are still bounded. The next emitted record reports `suppressed`; next successfully saved file events also report writer `dropped` counts. No later event means no later summary. Browser history and server file eviction are additional limits, so logs are never guaranteed complete. Successful dashboard polls are not logged; save successes are useful for lost-acknowledgement investigations.

Only fixed, validated fields are serialized and revalidated for browser viewing. No chat/prompts, terminal text, images, credentials, cookies/tokens, raw headers/URLs, pane/completion/session IDs, file paths, or arbitrary exception messages/stacks. Logging does not change read/unread status, stale refresh, warning dismissal, retry policy, keepalive, or the request deadline.

## Verification

Unit/HTTP fixtures cover categories, correlation, redaction, error allowances, queue bounds, storage failure recovery, safe filesystem handling, rotation/expiry and retrieval after a backend restart. A real Chromium persistent-profile fixture verifies a network-failure record survives closing and reopening the browser. Settings tests cover offline View/Copy/Clear and clipboard fallback. None uses real user agents or the deployed Herdr socket.
