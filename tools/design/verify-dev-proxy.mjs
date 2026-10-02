// Exercise the actual proxy and backend origin guard without sending anything
// to Pi: the empty body is deliberately invalid and is rejected before agent
// lookup or command forwarding. Pass a running frontend's private base URL.
import assert from "node:assert/strict";
const base = new URL(process.argv[2] || "http://100.71.229.1:5186").origin;
for (const origin of [base, "https://untrusted.invalid"]) {
  const response = await fetch(`${base}/api/agents/origin-probe/prompt`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  const expected = origin === base ? 400 : 403;
  console.log(
    `${origin === base ? "Same-origin" : "Cross-origin"} probe: HTTP ${response.status}, ${body.error}`,
  );
  assert.equal(
    response.status,
    expected,
    origin === base
      ? "Same-origin requests must reach body validation, not fail the origin guard"
      : "The proxy must not bypass the backend's cross-origin protection",
  );
}
