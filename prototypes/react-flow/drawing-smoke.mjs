import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PLAYGROUND_URL || "http://100.71.229.1:5191";
const evidence = new URL("../../.runtime/react-flow-playground/", import.meta.url).pathname;
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByTestId("component-guide").waitFor();
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")));
  const strokes = async () => (await saved())?.nodes.filter((n) => n.type === "ink") || [];
  const count = async (n) =>
    page.waitForFunction(
      (expected) =>
        (JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1"))?.nodes.filter(
          (n) => n.type === "ink",
        ).length || 0) === expected,
      n,
    );
  const raf = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const screenPoint = async (node, index = 1) => {
    const board = await saved();
    const canvas = await page.getByTestId("canvas").boundingBox();
    const v = board.viewport;
    const p = node.data.points[Math.min(index, node.data.points.length - 1)];
    return {
      x:
        canvas.x +
        v.x +
        (node.position.x + (p[0] * (node.width || node.style.width)) / node.data.w) * v.zoom,
      y:
        canvas.y +
        v.y +
        (node.position.y + (p[1] * (node.height || node.style.height)) / node.data.h) * v.zoom,
    };
  };
  async function draw(points) {
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p[0], p[1], { steps: 8 });
    await page.mouse.up();
    await raf();
  }
  const cardBefore = await page.getByTestId("component-guide").boundingBox();
  const x = cardBefore.x + 30;
  const y = cardBefore.y + 45;
  await draw([
    [x, y],
    [x + 45, y + 30],
    [x + 90, y + 5],
    [x + 140, y + 35],
  ]);
  await count(1);
  const first = (await strokes())[0];
  assert.ok(first.data.points.length > 10);
  assert.equal(first.data.pressure, false);
  assert.equal((await saved()).version, 2);
  const cardAfter = await page.getByTestId("component-guide").boundingBox();
  assert.equal(cardBefore.x, cardAfter.x);
  assert.equal(cardBefore.y, cardAfter.y);
  await page.mouse.click(x + 200, y + 40);
  await count(2);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await count(1);
  await page.keyboard.press("Control+z");
  await count(0);
  await page.keyboard.press("Control+Shift+z");
  await count(1);

  // Interrupted gestures leave no saved partial stroke.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await count(1);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 20);
  await page
    .getByTestId("ink-surface")
    .dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  await count(1);

  // Draw mode still allows zooming, without adding an accidental stroke.
  const v1 = (await saved()).viewport;
  await page.mouse.move(x + 30, y + 20);
  await page.mouse.wheel(0, 100);
  await raf();
  assert.notEqual((await saved()).viewport.zoom, v1.zoom);
  await count(1);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const beforePan = (await saved()).viewport;
  const canvasBox = await page.getByTestId("canvas").boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width - 70, canvasBox.y + 430);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 110, canvasBox.y + 450, { steps: 10 });
  await page.mouse.up();
  await raf();
  assert.notEqual((await saved()).viewport.x, beforePan.x);
  await count(1);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  let point = await screenPoint((await strokes())[0]);
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Duplicate selection", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  const beforeMove = (await strokes())[0].position;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 35, point.y + 20, { steps: 12 });
  await page.mouse.up();
  await raf();
  assert.notDeepEqual((await strokes())[0].position, beforeMove);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  assert.deepEqual((await strokes())[0].position, beforeMove);

  // Select only the painted stroke, and resize it with real React Flow controls.
  point = await screenPoint((await strokes())[0]);
  await page.mouse.click(point.x, point.y);
  const handle = await page
    .locator(`[data-id="${first.id}"] .react-flow__resize-control.bottom.right.handle`)
    .boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 20, {
    steps: 12,
  });
  await page.mouse.up();
  await raf();
  const resized = (await strokes())[0];
  assert.ok(resized.width > first.data.w);
  await page.getByRole("button", { name: "Duplicate selection", exact: true }).click();
  await count(2);
  await page.getByRole("button", { name: "Delete selection", exact: true }).click();
  await count(1);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await count(2);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await count(1);

  // A canceled erase must restore the preview without mutating saved strokes.
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  point = await screenPoint((await strokes())[0]);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await count(1);
  assert.equal(
    await page.getByTestId(`stroke-${first.id}`).evaluate((e) => getComputedStyle(e).opacity),
    "1",
  );

  // Erasing is one undoable operation, and never removes components underneath.
  await page.mouse.move(point.x, point.y - 35);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 35, { steps: 5 });
  await page.mouse.up();
  await count(0);
  assert.equal((await saved()).nodes.filter((n) => n.type === "component").length, 6);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await count(1);

  // An ordinary component edit must survive drawing undo/redo.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByTestId("component-api").dblclick({ position: { x: 90, y: 25 } });
  const dialog = page.getByRole("dialog", { name: "Edit Detail Node", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill("Keep this component edit");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
  await count(0);
  assert.equal(
    (await saved()).nodes.find((n) => n.id === "api").data.title,
    "Keep this component edit",
  );
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await count(1);
  const beforeReload = (await strokes())[0];
  await page.reload();
  await page.getByTestId(`stroke-${first.id}`).waitFor();
  const afterReload = (await strokes())[0];
  assert.deepEqual(afterReload.data, beforeReload.data);
  assert.equal(afterReload.style.width, beforeReload.width || beforeReload.style.width);
  await page.screenshot({ path: `${evidence}drawing-desktop.png` });
  assert.deepEqual(errors, []);

  // Touch and pen input are synthetic PointerEvents; real-device feel still needs human testing.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await phone.newPage();
  await mobile.goto(base);
  await mobile.getByRole("button", { name: "Draw", exact: true }).tap();
  // Synthetic capture has no browser-owned pointer: use actual touch through CDP for touch navigation.
  const session = await phone.newCDPSession(mobile);
  const touch = (type, points) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
    });
  await touch("touchStart", [[100, 500, 1]]);
  await touch("touchMove", [[140, 530, 1]]);
  await touch("touchEnd", []);
  await mobile.waitForFunction(() =>
    JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1"))?.nodes.some(
      (n) => n.type === "ink",
    ),
  );
  const mobileSaved = () =>
    mobile.evaluate(() => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")));
  assert.equal((await mobileSaved()).nodes.filter((n) => n.type === "ink").length, 1);
  const beforePinch = (await mobileSaved()).viewport;
  await touch("touchStart", [[100, 500, 1]]); // This provisional stroke must be canceled by the second finger.
  await touch("touchStart", [
    [100, 500, 1],
    [200, 500, 2],
  ]);
  await touch("touchMove", [
    [80, 510, 1],
    [230, 510, 2],
  ]);
  await touch("touchEnd", []);
  await mobile.waitForFunction(
    (zoom) =>
      JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).viewport.zoom !== zoom,
    beforePinch.zoom,
  );
  assert.equal((await mobileSaved()).nodes.filter((n) => n.type === "ink").length, 1);

  // Browser mouse emulation with pointerType=pen via CDP provides pressure and real capture semantics.
  const pen = (type, x, y, force) =>
    session.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      pointerType: "pen",
      force,
    });
  await pen("mousePressed", 120, 560, 0.2);
  await pen("mouseMoved", 145, 580, 0.8);
  await pen("mouseReleased", 165, 570, 0);
  await mobile.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).nodes.filter(
        (n) => n.type === "ink",
      ).length === 2,
  );
  const penStroke = (await mobileSaved()).nodes.filter((n) => n.type === "ink")[1];
  assert.equal(penStroke.data.pressure, true);
  assert.ok(penStroke.data.points.some((p) => p[2] > 0.6));
  await mobile.screenshot({ path: `${evidence}drawing-mobile.png` });
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  console.log(
    "PASS: ink over components, dots, mouse, touch, pen pressure, cancellation, pinch, zoom, stroke selection/move/resize/duplicate/delete, eraser, scoped undo/redo, legacy component editing, and reload persistence.",
  );
} catch (error) {
  if (page) await page.screenshot({ path: `${evidence}drawing-failure.png` });
  throw error;
} finally {
  await browser.close();
}
