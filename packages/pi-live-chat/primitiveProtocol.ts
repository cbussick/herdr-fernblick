import { z } from "zod";

// A small SVG vocabulary, never markup, attribute bags, CSS or external references.
export const primitiveKinds = ["line", "rectangle", "ellipse", "path", "text"] as const;
const unit = z.number().finite().min(0).max(100);
const point = z.tuple([unit, unit]);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const primitivePropsSchema = z
  .object({
    stroke: color,
    fill: color.or(z.literal("none")),
    strokeWidth: z.number().finite().min(0).max(12),
    start: point,
    end: point,
    commands: z
      .array(
        z.union([
          z.tuple([z.literal("M"), unit, unit]),
          z.tuple([z.literal("L"), unit, unit]),
          z.tuple([z.literal("Q"), unit, unit, unit, unit]),
          z.tuple([z.literal("C"), unit, unit, unit, unit, unit, unit]),
          z.tuple([z.literal("Z")]),
        ]),
      )
      .min(1)
      .max(500)
      .refine((commands) => commands[0]?.[0] === "M", "Path must start with M"),
    text: z
      .string()
      .max(2000)
      .refine((s) => s.split("\n").length <= 20, "Maximum 20 text lines"),
    fontSize: z.number().finite().min(1).max(96),
  })
  .strict();
export type PrimitiveProps = z.infer<typeof primitivePropsSchema>;
export type PrimitiveKind = (typeof primitiveKinds)[number];
export function defaultPrimitiveProps(): PrimitiveProps {
  return {
    stroke: "#17374f",
    fill: "none",
    strokeWidth: 2,
    start: [0, 50],
    end: [100, 50],
    commands: [
      ["M", 0, 50],
      ["L", 100, 50],
    ],
    text: "",
    fontSize: 16,
  };
}
