import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.PLAYGROUND_URL || "http://100.71.229.1:5191";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const session = await context.newCDPSession(page);
  const pen = (type, x, y, force = 0.6) =>
    session.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      pointerType: "pen",
      force,
    });
  const touch = (type, points) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
    });
  const strokes = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1"))?.nodes.filter(
          (n) => n.type === "ink",
        ) || [],
    );
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  await page.evaluate(() => {
    globalThis.penEvents = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture"])
      document.querySelector('[data-testid="ink-surface"]').addEventListener(type, (event) =>
        globalThis.penEvents.push({
          type,
          pointerType: event.pointerType,
          pointerId: event.pointerId,
        }),
      );
  });
  // A palm is already resting when the Pencil arrives. Every pen stroke must survive,
  // even while that same contact stays down between consecutive letters.
  const expected = Number(process.env.PEN_STROKES || 3);
  await touch("touchStart", [[700, 650, 1]]);
  for (let i = 0; i < expected; i++) {
    await pen("mousePressed", 450 + i * 60, 400);
    await pen("mouseMoved", 470 + i * 60, 430, 0.8);
    await pen("mouseReleased", 490 + i * 60, 410, 0);
  }
  await touch("touchEnd", []);
  await settle();
  const result = await strokes();
  const events = await page.evaluate(() => globalThis.penEvents);
  assert.equal(
    events.filter((e) => e.type === "pointerdown" && e.pointerType === "pen").length,
    expected,
    "The browser must deliver each tested pen contact",
  );
  assert.equal(
    result.filter((n) => n.data.pressure).length,
    expected,
    "Pencil strokes are lost when a palm touches the canvas first",
  );
  assert.equal(
    result.filter((n) => !n.data.pressure).length,
    0,
    "The palm must not leave an ink mark",
  );
  let total = expected;
  const check = async () => {
    await settle();
    const all = await strokes();
    assert.equal(all.length, total);
    assert.ok(
      all.every((n) => n.data.pressure),
      "No palm/finger ink should survive a pen takeover",
    );
  };

  // Pen first: a palm landing/lifting in the middle must not steal or finish the pen.
  await pen("mousePressed", 450, 400);
  await touch("touchStart", [[700, 650, 2]]);
  await pen("mouseMoved", 480, 430);
  await touch("touchEnd", []);
  await pen("mouseMoved", 510, 410);
  await pen("mouseReleased", 530, 420, 0);
  total++;
  await check();

  // A pen takes over even if two fingers had already started a pan/zoom gesture.
  await touch("touchStart", [
    [650, 600, 3],
    [750, 600, 4],
  ]);
  await touch("touchMove", [
    [640, 610, 3],
    [780, 610, 4],
  ]);
  await pen("mousePressed", 450, 400);
  await pen("mouseMoved", 480, 430);
  await touch("touchEnd", []);
  await pen("mouseReleased", 510, 410, 0);
  total++;
  await check();

  // A cancellation/capture-loss from a superseded palm must not cancel the new pen.
  await touch("touchStart", [[700, 650, 5]]);
  const touchId = await page.evaluate(
    () =>
      globalThis.penEvents
        .filter((e) => e.type === "pointerdown" && e.pointerType === "touch")
        .at(-1).pointerId,
  );
  await pen("mousePressed", 450, 400);
  for (const type of ["pointercancel", "lostpointercapture"])
    await page
      .getByTestId("ink-surface")
      .dispatchEvent(type, { pointerId: touchId, pointerType: "touch", bubbles: true });
  await pen("mouseMoved", 480, 430);
  await pen("mouseReleased", 510, 410, 0);
  await touch("touchEnd", []);
  total++;
  await check();

  // Fast taps reuse the same pen ID: no artificial sleeps between letters.
  for (let i = 0; i < 20; i++) {
    await pen("mousePressed", 440 + i * 5, 450, 0.3);
    await pen("mouseReleased", 440 + i * 5, 450, 0);
  }
  total += 20;
  await check();
  const viewport = await page.evaluate(
    () => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).viewport,
  );
  await page.reload();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  assert.equal((await strokes()).length, total, "All pen strokes survive reload");
  assert.deepEqual(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).viewport,
    ),
    viewport,
  );
  console.log(
    `PASS: ${total} Pencil strokes, palm-first and pen-first order, existing pinch takeover, stale palm cancellation/capture loss, rapid reused-pointer taps, no palm ink, and reload persistence.`,
  );
} finally {
  await browser.close();
}
