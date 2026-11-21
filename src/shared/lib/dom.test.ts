import { Window } from "happy-dom";
import { expect, it } from "vitest";
import { isDomElement, isDomNode, isHtmlElement } from "./dom";

it("narrows DOM capabilities across windows without accepting arbitrary event targets", () => {
  const first = new Window();
  const second = new Window();
  for (const window of [first, second]) {
    const html = window.document.createElement("button");
    const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const text = window.document.createTextNode("text");
    expect(isDomNode(html)).toBe(true);
    expect(isDomElement(html)).toBe(true);
    expect(isHtmlElement(html)).toBe(true);
    expect(isDomNode(text)).toBe(true);
    expect(isDomElement(text)).toBe(false);
    expect(isDomElement(svg)).toBe(true);
    expect(isHtmlElement(svg)).toBe(false);
  }
  expect(isDomNode(null)).toBe(false);
  expect(isDomNode(new EventTarget())).toBe(false);
  expect(isDomElement(new AbortController().signal)).toBe(false);
});
