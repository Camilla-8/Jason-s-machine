import { promises as fs } from "fs";
import path from "path";
import type { Tag } from "./types";

const TAGS_PATH = path.join(process.cwd(), "data", "approved-tags.json");

interface TagsFile {
  version: number;
  tags: Tag[];
}

export async function getApprovedTags(): Promise<Tag[]> {
  const raw = await fs.readFile(TAGS_PATH, "utf-8");
  const data = JSON.parse(raw) as TagsFile;
  return data.tags;
}

export async function getTagBySlug(slug: string): Promise<Tag | undefined> {
  const tags = await getApprovedTags();
  return tags.find((t) => t.slug === slug);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function addApprovedTag(tag: Omit<Tag, "slug"> & { slug?: string }): Promise<Tag> {
  const raw = await fs.readFile(TAGS_PATH, "utf-8");
  const data = JSON.parse(raw) as TagsFile;

  const slug = tag.slug ?? slugify(tag.name);
  const existing = data.tags.find((t) => t.slug === slug || t.name.toLowerCase() === tag.name.toLowerCase());
  if (existing) {
    return existing;
  }

  const newTag: Tag = {
    slug,
    name: tag.name,
    description: tag.description,
    synonyms: tag.synonyms,
    negative_signals: tag.negative_signals ?? [],
    related_tags: tag.related_tags ?? [],
  };

  data.tags.push(newTag);
  await fs.writeFile(TAGS_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  return newTag;
}

export function formatTagsForPrompt(tags: Tag[]): string {
  return tags
    .map(
      (t) =>
        `- ${t.name} (slug: ${t.slug}): ${t.description}\n  Synonyms: ${t.synonyms.join(", ")}\n  Avoid when: ${t.negative_signals.join("; ")}`
    )
    .join("\n");
}
