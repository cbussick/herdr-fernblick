import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const base = process.env.PLAYGROUND_URL || "http://100.71.229.1:5191";
// Desktop WebKit cannot reproduce UIKit's native selection popup. Check the actual
// selection/callout guards and pointer path on both engines, without claiming that it can.
for (const [name, engine] of [
  ["Chromium", chromium],
  ["WebKit", webkit],
]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 810, height: 1080 },
      hasTouch: true,
      isMobile: true,
    });
    await page.goto(base);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const attribution = page.getByRole("link", { name: "React Flow attribution" });
    const selection = await attribution.evaluate((element) => ({
      user: getComputedStyle(element).userSelect,
      webkit: getComputedStyle(element).getPropertyValue("-webkit-user-select"),
    }));
    assert.equal(
      selection.user,
      "none",
      `${name}: attribution remains text-selectable while drawing`,
    );
    if (name === "WebKit")
      assert.equal(selection.webkit, "none", "WebKit requires the prefixed user-select guard");
    const surface = page.getByTestId("ink-surface");
    assert.equal(
      await surface.evaluate((element) => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
      `${name}: native context menu is not blocked on drawing surface`,
    );
    const point = await attribution.boundingBox();
    assert.equal(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        { x: point.x + point.width / 2, y: point.y + point.height / 2 },
      ),
      "ink-surface",
      `${name}: attribution intercepts drawing input`,
    );

    // A selection left by the old build should be dismissed when drawing resumes.
    await page
      .getByRole("heading", { name: "Component canvas", exact: true })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    assert.equal(await page.evaluate(() => getSelection().toString()), "Component canvas");
    const bounds = await page.getByTestId("canvas").boundingBox();
    await page.mouse.move(bounds.x + 60, bounds.y + 150);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 110, bounds.y + 180, { steps: 10 });
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => getSelection().toString()),
      "",
      `${name}: stale browser selection survives a drawing gesture`,
    );
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1"))?.nodes.some(
        (n) => n.type === "ink",
      ),
    );
    // Also draw across the attribution's exact screen position.
    await page.mouse.move(point.x + 2, point.y + point.height / 2);
    await page.mouse.down();
    await page.mouse.move(point.x + point.width - 2, point.y + point.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).nodes.filter(
          (n) => n.type === "ink",
        ).length === 2,
    );
    assert.equal(await page.evaluate(() => getSelection().toString()), "");
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    assert.equal(
      await attribution.evaluate((element) => getComputedStyle(element).userSelect),
      "none",
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Add Card", exact: true }).click();
    const input = page.getByRole("dialog").getByLabel("Title", { exact: true });
    await input.fill("Text remains editable");
    await input.selectText();
    assert.equal(
      await input.evaluate((element) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
      "Text remains editable",
    );
    console.log(
      `PASS ${name}: canvas selection guards, context-menu suppression, attribution hit testing, stale-selection recovery, consecutive strokes, and editable dialog text.`,
    );
  } finally {
    await browser.close();
  }
}
