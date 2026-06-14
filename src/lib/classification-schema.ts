import { z } from "zod";

export const TagItemSchema = z.object({
  slug: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  evidence: z.array(z.string()).max(5),
});

export const ClassificationSchema = z.object({
  recommended_tags: z.array(TagItemSchema).max(5),
  suggested_new_tag: z
    .object({
      name: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      description: z.string(),
      synonyms: z.array(z.string()).max(10),
    })
    .nullable(),
  overall_confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
});

export type ParsedClassification = z.infer<typeof ClassificationSchema>;

export type RecommendedTagItem = z.infer<typeof TagItemSchema>;
