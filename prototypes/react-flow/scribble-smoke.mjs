import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const base = process.env.PLAYGROUND_URL || "http://100.71.229.1:5191";
const ipad =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const desktopIpad =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const android =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
for (const [name, engine] of [
  ["Chromium", chromium],
  ["WebKit", webkit],
]) {
  const browser = await engine.launch();
  try {
    for (const [label, userAgent, expected] of [
      ["iPad", ipad, true],
      ["desktop-mode iPad", desktopIpad, true],
      ["non-Apple", android, false],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        userAgent,
      });
      // Playwright's generic touch context reports one point; physical iPads report multitouch.
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }),
      );
      await page.goto(base);
      await page.getByRole("button", { name: "Draw", exact: true }).click();
      const prevented = (locator) =>
        locator.evaluate((element) => {
          const event = new Event("touchstart", { bubbles: true, cancelable: true });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
      assert.equal(
        await prevented(page.getByTestId("ink-surface")),
        expected,
        `${name} ${label}: drawing must suppress iOS Scribble without changing other platforms`,
      );
      await page.getByRole("button", { name: "Eraser", exact: true }).click();
      assert.equal(
        await prevented(page.getByTestId("ink-surface")),
        expected,
        `${name} ${label}: erasing must suppress iOS Scribble too`,
      );
      assert.equal(
        await prevented(page.getByRole("button", { name: "Select", exact: true })),
        false,
        "Toolbar touch defaults must remain available",
      );
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByRole("button", { name: "Add Card", exact: true }).click();
      const input = page.getByRole("dialog").getByLabel("Title", { exact: true });
      assert.equal(
        await prevented(input),
        false,
        "Text fields must retain native touch/Scribble behavior",
      );
      await input.fill("Text entry still works");
      await page.getByRole("button", { name: "Add component", exact: true }).click();
      if (name === "Chromium" && label === "iPad") {
        // Real browser touch/pen delivery still works with the native default canceled.
        await page.getByRole("button", { name: "Draw", exact: true }).click();
        const session = await page.context().newCDPSession(page);
        const touch = (type, points) =>
          session.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
          });
        await touch("touchStart", [[400, 600, 1]]);
        await touch("touchMove", [[450, 650, 1]]);
        await touch("touchEnd", []);
        await session.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: 450,
          y: 500,
          button: "left",
          buttons: 1,
          pointerType: "pen",
          force: 0.6,
        });
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 470,
          y: 530,
          button: "left",
          buttons: 1,
          pointerType: "pen",
          force: 0.7,
        });
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: 490,
          y: 510,
          button: "left",
          buttons: 0,
          pointerType: "pen",
          force: 0,
        });
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).nodes.filter(
              (n) => n.type === "ink",
            ).length === 2,
        );
        const zoom = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).viewport.zoom,
        );
        await touch("touchStart", [
          [450, 600, 1],
          [550, 600, 2],
        ]);
        await touch("touchMove", [
          [430, 610, 1],
          [580, 610, 2],
        ]);
        await touch("touchEnd", []);
        await page.waitForFunction(
          (before) =>
            JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).viewport.zoom !==
            before,
          zoom,
        );
        assert.equal(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).nodes.filter(
                (n) => n.type === "ink",
              ).length,
          ),
          2,
        );
      }
      await page.close();
      console.log(
        `PASS ${name} ${label}: native touch-start suppression scoped to drawing/erasing, toolbar and text fields untouched.`,
      );
    }
  } finally {
    await browser.close();
  }
}
console.log(
  "These tests verify event policy, not iPadOS Scribble itself; real-device confirmation with Scribble enabled is still required.",
);
