import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PLAYGROUND_URL || "http://100.71.229.1:5191";
const evidence = new URL("../../.runtime/react-flow-playground/", import.meta.url).pathname;
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
let lastPage;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  lastPage = page;
  const errors = [];
  const unexpectedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(base) && !request.url().startsWith("data:"))
      unexpectedRequests.push(request.url());
  });
  await page.goto(base);
  await page.getByTestId("component-api").waitFor();
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")));
  await page.screenshot({ path: `${evidence}desktop-initial.png` });

  // A real structured edit: props, fields, color, icon, image and live preview.
  await page.getByTestId("component-api").dblclick({ position: { x: 100, y: 25 } });
  let dialog = page.getByRole("dialog", { name: "Edit Detail Node" });
  await dialog.getByLabel("Title", { exact: true }).fill("Identity service");
  await dialog.getByLabel("Subtitle", { exact: true }).fill("Changed through props");
  await dialog.getByRole("button", { name: "Use #9170e8", exact: true }).click();
  await dialog.getByRole("button", { name: "Icon: Lock", exact: true }).click();
  await dialog.getByRole("button", { name: "Add field", exact: true }).click();
  await dialog.getByLabel("Field 4 label", { exact: true }).fill("Owner");
  await dialog.getByLabel("Field 4 value", { exact: true }).fill("Platform team");
  await dialog.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await dialog.getByRole("button", { name: "Remove image", exact: true }).waitFor();
  // Scrolling long fields must not scroll the modal title or Save button away.
  const headingBox = await dialog
    .getByRole("heading", { name: "Edit Detail Node", exact: true })
    .boundingBox();
  const saveBox = await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .boundingBox();
  assert.ok(headingBox.y > 0 && saveBox.y + saveBox.height < 1000);
  await page.screenshot({ path: `${evidence}detail-editor.png` });
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByTestId("component-api").getByText("Platform team").waitFor();
  assert.equal((await saved()).nodes.find((n) => n.id === "api").data.title, "Identity service");

  // Cancel does not mutate the saved data.
  await page.getByRole("button", { name: "Edit Identity service", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit Detail Node" });
  await dialog.getByLabel("Title", { exact: true }).fill("Discard this");
  await page.keyboard.press("Escape");
  assert.equal((await saved()).nodes.find((n) => n.id === "api").data.title, "Identity service");

  // Table editing adds actual columns/cells, not a flattened image.
  await page.getByTestId("component-users").dblclick({ position: { x: 90, y: 25 } });
  dialog = page.getByRole("dialog", { name: "Edit Table Node" });
  await dialog.getByRole("button", { name: "Column", exact: true }).click();
  await dialog.getByLabel("Column 3 name", { exact: true }).fill("Required");
  await dialog.getByLabel("Row 1 column 3", { exact: true }).fill("Yes");
  await dialog.getByRole("button", { name: "Row", exact: true }).click();
  await dialog.getByLabel("Row 4 column 1", { exact: true }).fill("created_at");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByTestId("component-users").getByText("created_at").waitFor();

  // All six insert dialogs and selectable, editable resulting components.
  for (const name of [
    "Boundary",
    "Card",
    "Icon Node",
    "Detail Node",
    "Table Node",
    "Comment Node",
  ]) {
    await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: `Add ${name}`, exact: true });
    await dialog
      .getByLabel(name === "Boundary" ? "Label" : "Title", { exact: true })
      .fill(`Test ${name}`);
    await dialog.getByRole("button", { name: "Add component", exact: true }).click();
    await page.getByRole("button", { name: `Edit Test ${name}`, exact: true }).waitFor();
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  }
  assert.equal((await saved()).nodes.length, 12);

  // Duplicate / delete uses normal selection and keeps children with boundaries.
  await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
  await page.getByTestId("component-guide").click({ position: { x: 100, y: 30 } });
  await page.getByRole("button", { name: "Duplicate selection", exact: true }).click();
  assert.equal((await saved()).nodes.length, 13);
  await page.getByRole("button", { name: "Delete selection", exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).nodes.length === 12,
  );

  // Use a fresh demo for drag/connect/resize tests.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Reset to example", exact: true }).click();
  await page.getByTestId("component-guide").click({ position: { x: 100, y: 30 } });
  const handle = (id, side) => page.locator(`[data-id="${id}"] [data-handleid="${side}"]`);
  const from = await handle("guide", "right").boundingBox();
  const to = await handle("note", "left").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("fernblick-react-flow-playground-v1")).edges.length === 3,
  );
  const newEdge = (await saved()).edges.find((e) => e.source === "guide");
  assert.equal(newEdge.target, "note");

  // Real pointer resize must survive a reload, not just update the current DOM.
  await page.getByTestId("component-guide").click({ position: { x: 100, y: 30 } });
  const resize = await page
    .locator('[data-id="guide"] .react-flow__resize-control.bottom.right.handle')
    .boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 45, resize.y + resize.height / 2 + 25, {
    steps: 12,
  });
  await page.mouse.up();
  const resizedWidth = (await saved()).nodes.find((n) => n.id === "guide").width;
  assert.ok(resizedWidth > 320);

  // Moving the boundary moves its children; relative child data stays stable.
  const before = await saved();
  const b = await page.getByTestId("component-platform").boundingBox();
  await page.mouse.move(b.x + 50, b.y + 25);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y + 65, { steps: 12 });
  await page.mouse.up();
  const after = await saved();
  assert.notEqual(
    after.nodes.find((n) => n.id === "platform").position.x,
    before.nodes.find((n) => n.id === "platform").position.x,
  );
  assert.deepEqual(
    after.nodes.find((n) => n.id === "api").position,
    before.nodes.find((n) => n.id === "api").position,
  );

  await page.reload();
  await page.getByTestId("component-api").waitFor();
  assert.equal((await saved()).edges.length, 3);
  await page.waitForFunction(
    (width) =>
      Math.abs(parseFloat(document.querySelector('[data-id="guide"]').style.width) - width) < 1,
    resizedWidth,
  );
  await page.screenshot({ path: `${evidence}desktop-tested.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);

  // Narrow touch viewport: component palette and modal remain usable.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const phone = await mobile.newPage();
  await phone.goto(base);
  await phone.getByRole("button", { name: "Add Card", exact: true }).tap();
  const phoneDialog = phone.getByRole("dialog", { name: "Add Card", exact: true });
  await phoneDialog.getByLabel("Title", { exact: true }).fill("Mobile card");
  await phoneDialog.getByLabel("Body", { exact: true }).fill("Edited on a narrow touch viewport.");
  await phone.screenshot({ path: `${evidence}mobile-editor.png` });
  await phoneDialog.getByRole("button", { name: "Add component", exact: true }).tap();
  await phone.getByRole("button", { name: "Edit Mobile card", exact: true }).waitFor();
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await phone.screenshot({ path: `${evidence}mobile-canvas.png` });
  console.log(
    `PASS: six components, prop/image/field/table edits, cancel, duplicate/delete, real handle connection, resize persistence, boundary movement, persistence, mobile dialog, no external requests/page errors. Screenshots: ${evidence}`,
  );
} catch (error) {
  if (lastPage) {
    await lastPage.screenshot({ path: `${evidence}failure.png` });
    console.error(
      await lastPage.evaluate(() => localStorage.getItem("fernblick-react-flow-playground-v1")),
    );
  }
  throw error;
} finally {
  await browser.close();
}
