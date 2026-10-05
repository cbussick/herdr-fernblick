import { act, createRef, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import {
  annotationGeneralPromptIntro,
  annotationHighlights,
  annotationPrompt,
  positionAnnotationPopover,
  positionTouchAnnotationAction,
  type Annotation,
} from "./annotations";
import { useChatAnnotations, type ChatAnnotations } from "./useChatAnnotations";
import { ChatMessageText } from "./ChatMessageText";

const entry = {
  id: "note-1",
  messageId: "response-1",
  quote: "line one\nline two",
  start: 12,
  end: 29,
  comment: "Keep both lines.",
} satisfies Annotation;
it("serializes older-response anchors, verbatim multiline quotes and comments in review order", () => {
  expect(
    annotationPrompt([entry, { ...entry, messageId: "response-2", comment: "Change this." }]),
  ).toBe(
    "Please address these comments on your earlier responses. Each quoted passage is context; the comment below it is my feedback.\n\n**Comment 1** (response response-1, characters 13–29)\n\n> line one\n> line two\n\nKeep both lines.\n\n**Comment 2** (response response-2, characters 13–29)\n\n> line one\n> line two\n\nChange this.",
  );
});
it("serializes general and mixed feedback without fabricated quotes or anchors", () => {
  const general: Annotation = { id: "general", comment: "Consider accessibility." };
  expect(annotationPrompt([general])).toBe(
    `${annotationGeneralPromptIntro}\n\n**Comment 1** (general comment)\n\nConsider accessibility.`,
  );
  const mixed = annotationPrompt([entry, general]);
  expect(mixed).toContain("**Comment 1** (response response-1, characters 13–29)");
  expect(mixed).toContain("**Comment 2** (general comment)\n\nConsider accessibility.");
  expect(mixed).not.toContain("undefined");
  const html = renderToStaticMarkup(<ChatMessageText text={mixed} annotationFeedback />);
  expect(html).toContain("<strong>Comment 1</strong>");
  expect(html).toContain("<strong>Comment 2</strong>");
  expect(
    annotationHighlights({ id: "a1", role: "assistant", text: "Consider accessibility." }, [
      general,
    ]),
  ).toEqual([]);
});
it("formats feedback labels and preserves raw assistant source text in hidden syntax", () => {
  const text = annotationPrompt([
    { ...entry, comment: "<script>unsafe</script> https://example.com" },
  ]);
  const html = renderToStaticMarkup(<ChatMessageText text={text} annotationFeedback />);
  expect(html).toContain("<strong>Comment 1</strong>");
  expect(html).not.toContain("**Comment 1**");
  expect(html).not.toContain("<script>");
  expect(html).toContain('href="https://example.com"');
  const assistant = renderToStaticMarkup(<ChatMessageText text={text} annotationSource="a1" />);
  expect(assistant).toContain("<strong>");
  expect(assistant).toContain('aria-hidden="true" data-message-syntax="true">**</span>');
  expect(assistant.replace(/<[^>]+>/g, "")).toContain("**Comment 1**");
  const ordinary = renderToStaticMarkup(
    <ChatMessageText text="**Comment 1** (response a1)" annotationFeedback />,
  );
  expect(ordinary).toContain("<strong>Comment 1</strong>");
});
it("highlights only an exact quote at its original offset, not duplicate or changed text", () => {
  const message = { id: "response-1", role: "assistant" as const, text: "again again" };
  const note = { ...entry, quote: "again", start: 6, end: 11 };
  expect(annotationHighlights(message, [note])).toEqual([note]);
  expect(annotationHighlights({ ...message, text: "again other" }, [note])).toEqual([]);
  expect(annotationHighlights({ ...message, id: "another" }, [note])).toEqual([]);
});
it("renders overlapping highlights across links without losing text, link behavior, or escaping", () => {
  const html = renderToStaticMarkup(
    <ChatMessageText
      text="See https://example.com <script>"
      annotationSource="a1"
      highlights={[
        { start: 0, end: 12 },
        { start: 8, end: 27 },
      ]}
    />,
  );
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).toContain("<mark");
  expect(html).not.toContain("<script>");
  expect(html.replace(/<[^>]+>/g, "")).toBe("See https://example.com &lt;script&gt;");
});
it("positions above a selection, flips below when needed, and clamps to the visual viewport", () => {
  const size = { width: 360, height: 220 };
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  expect(positionAnnotationPopover({ left: 200, top: 400, bottom: 430 }, size, viewport)).toEqual({
    left: 18,
    top: 168,
  });
  expect(positionAnnotationPopover({ left: 10, top: 50, bottom: 70 }, size, viewport)).toEqual({
    left: 12,
    top: 82,
  });
  expect(
    positionAnnotationPopover({ left: -20, top: 600, bottom: 640 }, size, {
      ...viewport,
      top: 100,
      height: 300,
    }),
  ).toEqual({ left: 12, top: 168 });
});

describe("touch selection action placement", () => {
  const size = { width: 106, height: 44 };
  const ipad = { left: 0, top: 0, width: 834, height: 1194 };
  it("sits to the right or left of multiline selections without covering their handles", () => {
    expect(
      positionTouchAnnotationAction({ left: 200, right: 350, top: 300, bottom: 380 }, size, ipad),
    ).toEqual({ left: 370, top: 318 });
    expect(
      positionTouchAnnotationAction({ left: 600, right: 800, top: 300, bottom: 380 }, size, ipad),
    ).toEqual({ left: 474, top: 318 });
  });
  it("reserves native-menu space below short or full-width passages, and flips above near the bottom", () => {
    const phone = { ...ipad, width: 390, height: 844 };
    expect(
      positionTouchAnnotationAction({ left: 58, right: 380, top: 400, bottom: 426 }, size, phone),
    ).toEqual({ left: 58, top: 510 });
    expect(
      positionTouchAnnotationAction({ left: 58, right: 380, top: 740, bottom: 766 }, size, phone),
    ).toEqual({ left: 58, top: 612 });
    expect(
      positionTouchAnnotationAction({ left: 58, right: 380, top: 20, bottom: 46 }, size, phone),
    ).toEqual({ left: 58, top: 130 });
  });
  it("keeps viewport-filling selections usable rather than clamping into the callout band", () => {
    expect(
      positionTouchAnnotationAction({ left: 12, right: 378, top: 20, bottom: 824 }, size, {
        ...ipad,
        width: 390,
        height: 844,
      }),
    ).toEqual({ left: 272, top: 400 });
    expect(
      positionTouchAnnotationAction({ left: 110, right: 480, top: 220, bottom: 480 }, size, {
        left: 100,
        top: 200,
        width: 390,
        height: 300,
      }),
    ).toEqual({ left: 372, top: 328 });
  });
});

describe("annotation draft ownership", () => {
  let api: ChatAnnotations;
  let renderer: ReactTestRenderer;
  let snapshot: Snapshot | undefined;
  let sending = false;
  const transcript = createRef<HTMLElement>();
  const anchor = () => ({ left: 0, top: 0, bottom: 0 }) as DOMRect;
  function Harness() {
    const value = useChatAnnotations(snapshot, true, transcript, sending);
    useLayoutEffect(() => {
      api = value;
    });
    return null;
  }
  async function add(comment = "Change this", general = false) {
    await act(async () => api.begin(general ? null : entry, anchor));
    await act(async () => api.setComment(comment));
    await act(async () => api.save());
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { getSelection: () => null });
    sending = false;
    snapshot = {
      identity: { runtime: "runtime", sessionId: "session" },
      epoch: "epoch",
      messages: [],
    } as unknown as Snapshot;
    await act(async () => {
      renderer = create(<Harness />);
    });
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });
  it("adds, edits and removes comments without any transport side effect", async () => {
    await add();
    expect(api!.entries).toHaveLength(1);
    expect(api!.editor).toBe(null);
    expect(api!.owner).toEqual({ runtime: "runtime", sessionId: "session", epoch: "epoch" });
    const id = api!.entries[0].id;
    await act(async () => api.edit(api.entries[0], anchor));
    await act(async () => api.setComment("Updated"));
    await act(async () => api.save());
    expect(api!.entries[0]).toMatchObject({ id, comment: "Updated" });
    await act(async () => api.remove(id));
    expect(api!.entries).toEqual([]);
  });
  it("adds, edits and deletes general feedback alongside passage comments", async () => {
    await act(async () => api.begin(null, anchor));
    expect(api!.editor?.source).toBe(null);
    await act(async () => api.setComment("General feedback"));
    await act(async () => api.save());
    const general = api!.entries[0];
    expect(general).toEqual({ id: general.id, comment: "General feedback" });
    expect(api!.owner).toEqual({ runtime: "runtime", sessionId: "session", epoch: "epoch" });
    await add("Passage feedback");
    await act(async () => api.edit(general, anchor));
    expect(api!.editor?.source).toBe(null);
    await act(async () => api.setComment("Updated general feedback"));
    await act(async () => api.save());
    expect(api!.entries[0]).toEqual({ id: general.id, comment: "Updated general feedback" });
    await act(async () => api.edit(api.entries[0], anchor));
    await act(async () => api.remove(general.id));
    expect(api!.editor).toBe(null);
    expect(api!.entries.map((value) => value.comment)).toEqual(["Passage feedback"]);
  });
  it.each([false, true])(
    "rejects blank and oversized comments without losing the editor (general: %s)",
    async (general) => {
      await add("   ", general);
      expect(api!.entries).toEqual([]);
      await act(async () => api.setComment("x".repeat(32_000)));
      await act(async () => api.save());
      expect(api!.error).toContain("32,000");
      expect(api!.entries).toEqual([]);
      expect(api!.editor?.comment).toHaveLength(32_000);
    },
  );
  it.each(["epoch", "runtime", "sessionId"] as const)(
    "retains but blocks a mixed batch on %s replacement",
    async (field) => {
      await add();
      await add("General feedback", true);
      snapshot =
        field === "epoch"
          ? { ...snapshot!, epoch: "new" }
          : { ...snapshot!, identity: { ...snapshot!.identity, [field]: "new" } };
      await act(async () => renderer.update(<Harness />));
      expect(api!.stale).toBe(true);
      expect(api!.entries).toHaveLength(2);
      expect(api!.canBegin).toBe(false);
      await act(async () => api.begin(null, anchor));
      expect(api!.editor).toBe(null);
      await act(async () => api.edit(api.entries[0], anchor));
      expect(api!.editor).toBe(null);
      await act(async () => api.begin(entry, anchor));
      expect(api!.editor).toBe(null);
      await act(async () => api.clear());
      await add("New conversation comment");
      expect(api!.stale).toBe(false);
      expect(api!.entries[0].comment).toBe("New conversation comment");
    },
  );
  it.each([false, true])(
    "does not save feedback captured before a conversation change (general: %s)",
    async (general) => {
      await act(async () => api.begin(general ? null : entry, anchor));
      await act(async () => api.setComment("Old response"));
      snapshot = { ...snapshot!, epoch: "new" };
      await act(async () => renderer.update(<Harness />));
      await act(async () => api.save());
      expect(api!.editorStale).toBe(true);
      expect(api!.entries).toEqual([]);
    },
  );
  it("locks mutations during forwarding and clears only the acknowledged batch", async () => {
    await add("First");
    const first = api!.entries[0].id;
    await add("Second", true);
    sending = true;
    await act(async () => renderer.update(<Harness />));
    await act(async () => {
      api.remove(first);
      api.begin(null, anchor);
    });
    expect(api!.entries).toHaveLength(2);
    expect(api!.editor).toBe(null);
    await act(async () => api.acknowledge([first]));
    expect(api!.entries.map((value) => value.comment)).toEqual(["Second"]);
  });
});
