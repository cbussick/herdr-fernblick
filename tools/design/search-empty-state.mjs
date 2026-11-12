import assert from "node:assert/strict";

// Verify the real component, not a DOM/style proposal.
export async function verifyEmptySearch(page, search, screenshot) {
  const region = page.locator('[data-ui="search-empty-state"]');
  await region.waitFor();
  assert(
    await region.evaluate((el) => {
      const outer = el.getBoundingClientRect(),
        group = el.firstElementChild.getBoundingClientRect();
      return (
        Math.abs((outer.left + outer.right - group.left - group.right) / 2) < 2 &&
        (group.height > outer.height ||
          Math.abs((outer.top + outer.bottom - group.top - group.bottom) / 2) < 2)
      );
    }),
    "Empty state is centered in its results area",
  );
  await page.screenshot({ path: screenshot });
  await region.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert(
    await search.evaluate((el) => el === document.activeElement),
    "Clearing search restores focus",
  );
}
