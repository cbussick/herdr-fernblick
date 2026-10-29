# Read-receipt diagnostics

Read-status saves emit JSON console records with `event: "read_receipt"`. There is no analytics service, telemetry upload endpoint, or persistent browser log.

## Retrieve and correlate

- In browser developer tools, enable **Preserve log** in Console and include Info and Warning levels. Filter for `read_receipt`. Capture the record closest to the warning's timestamp before reloading. Mobile browsers may require remote developer tools; records are not recoverable after the page closes unless the console was preserved/captured.
- Backend records go to stdout (success/stale) and stderr (failures). Retrieve them from the terminal running `npm start` / `npm run dev:api`, or the deployment's existing service/container log collector. Filter for `read_receipt`, then the browser record's `requestId` and timestamp. Retention is controlled by that collector, not Fernblick.
- The browser generates a new random UUID per save, sent in `X-Fernblick-Read-Request-Id`. The backend accepts only canonical UUIDv4 values, replaces invalid/missing IDs with a random UUID, and returns it in the same response header. The Network panel can show this ID even when no browser record was retained. IDs are correlation hints, not trusted identities or authorization.

Records include UTC `timestamp`, `operation` (`save`, `load`, `cleanup`), `boundary` (`client`, `request`, `persistence`), `requestId`, `category`, elapsed `durationMs`, and HTTP `status` when observable. Persistence load/cleanup failures use a server-generated ID rather than a browser save ID.

## Interpret

- Client `network`: fetch/body transport failure without an observed timeout; `timeout`: the existing ten-second deadline fired; `aborted`: another observed abort. No server match can mean the request never reached Fernblick, a proxy interrupted it, or logs were suppressed/lost—not proof that no receipt was saved.
- Client `http`: non-2xx response (even if its body is invalid JSON); `response_validation`: malformed JSON or invalid success acknowledgement; `request_validation`: invalid local receipt input.
- `stale` at Info level: expected 404/409 after an agent closes or its answer changes. Existing refresh behavior is unchanged.
- Server request `dependency`: Herdr snapshot/session failure; `http` / `request_validation`: request rejected before persistence; `unexpected`: unclassified exception. Check the matching persistence record: `storage` isolates receipt directory/file/fsync failures, without exposing the OS error text or path.
- A persistence `success` followed by client `timeout`/`network` means saving finished but the browser did not confirm it. An aborted HTTP response does not cancel an in-progress save.
- Dashboard receipt reads and cleanup failures also emit persistence diagnostics. Cleanup remains best effort.

Each logger is limited to **30 records per 60-second window**, shared across its categories and operations: one browser logger per loaded page, and separate backend request and persistence loggers per process. The next emitted record reports the count of `suppressed` records. Successful saves are included to help diagnose lost acknowledgements; successful dashboard reads are not logged. Limits use constant-size counters, not per-agent/session maps. A missing record is therefore not evidence of success or failure.

Only fixed diagnostic fields are emitted. Never log response/request bodies, chat content, pane/completion/session identifiers, paths, credentials, headers other than the validated correlation ID, or exception messages/stacks. Diagnostics are best effort and do not change receipt persistence, read/unread state, warning dismissal, retry policy, keepalive, or the request deadline.
