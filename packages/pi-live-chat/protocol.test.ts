import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  commandSchema,
  messageSchema,
  navigationResponseSchema,
  sendInputSchema,
} from "./protocol.js";

const target = { runtime: randomUUID(), epoch: randomUUID(), sessionId: "session" };
it.each([10, 11])(
  "validates the %i-image boundary across send, history and navigation",
  (count) => {
    const attachments = Array.from({ length: count }, () => `${randomUUID()}.png`);
    const prompt = { text: "", attachments };
    const valid = count === 10;
    expect(sendInputSchema.safeParse(prompt).success).toBe(valid);
    expect(
      commandSchema.safeParse({
        type: "command",
        id: randomUUID(),
        target,
        action: "send",
        ...prompt,
      }).success,
    ).toBe(valid);
    expect(
      navigationResponseSchema.safeParse({
        type: "navigated",
        id: randomUUID(),
        target,
        prompt,
      }).success,
    ).toBe(valid);
    expect(
      messageSchema.safeParse({
        id: "images",
        role: "user",
        text: "",
        attachments: attachments.map((id) => `/api/uploads/${id}`),
      }).success,
    ).toBe(valid);
  },
);
