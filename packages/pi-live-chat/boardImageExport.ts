import { z } from "zod";

export const boardImageQualitySchema = z.enum(["standard", "high"]);
export type BoardImageQuality = z.infer<typeof boardImageQualitySchema>;

/** Downloads have a separate budget. Undefined always keeps the smaller agent budget. */
export function boardImageLimits(quality?: BoardImageQuality) {
  if (quality === undefined)
    return { maxSide: 2048, maxPixels: 2 * 1024 * 1024, maxBytes: 2 * 1024 * 1024, scale: 1 };
  boardImageQualitySchema.parse(quality);
  return quality === "high"
    ? { maxSide: 4096, maxPixels: 16 * 1024 * 1024, maxBytes: 16 * 1024 * 1024, scale: 2 }
    : { maxSide: 2048, maxPixels: 4 * 1024 * 1024, maxBytes: 16 * 1024 * 1024, scale: 1 };
}
