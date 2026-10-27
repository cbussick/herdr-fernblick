import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScoutLogo } from "./ScoutLogo";

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("renders genuine vector artwork with separate pupils and an accessible name", async () => {
  await act(async () => {
    renderer = create(<ScoutLogo />);
  });
  const svg = renderer.root.findByType("svg");
  expect(renderer.root.findByType("title").children).toEqual(["Fernblick"]);
  expect(svg.props["aria-labelledby"]).toBe(renderer.root.findByType("title").props.id);
  expect(svg.props["data-animated"]).toBeUndefined();
  expect(renderer.root.findAllByType("image")).toHaveLength(0);
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  expect(renderer.root.findAllByType("ellipse")).toHaveLength(2);
  expect(renderer.root.findByProps({ "data-part": "pupils" })).toBeDefined();
  expect(renderer.root.findAllByType("path").length).toBeGreaterThan(4);
  const rim = renderer.root.findByProps({ "data-part": "goggle-rim" });
  expect(svg.children.at(-1)).toBe(rim);
  const eye = renderer.root.findByProps({ "data-part": "eyes" });
  const goggles = renderer.root.findByProps({ "data-part": "binoculars" });
  expect(rim.props.d).toBe(`${goggles.props.d} ${eye.props.d}`);
  expect(renderer.root.findByType("clipPath").findByType("path").props.d).toBe(goggles.props.d);
});

it("opts into animation and gives each instance its own outer goggle clipping mask", async () => {
  await act(async () => {
    renderer = create(
      <>
        <ScoutLogo animated />
        <ScoutLogo />
      </>,
    );
  });
  const logos = renderer.root.findAllByType("svg");
  expect(logos[0].props["data-animated"]).toBe(true);
  expect(logos[1].props["data-animated"]).toBeUndefined();
  const clips = renderer.root.findAllByType("clipPath");
  expect(clips[0].props.id).not.toBe(clips[1].props.id);
  const clippedGroups = renderer.root.findAllByType("g").filter((group) => group.props.clipPath);
  expect(clippedGroups.map((group) => group.props.clipPath)).toEqual(
    clips.map((clip) => `url(#${clip.props.id})`),
  );
});
