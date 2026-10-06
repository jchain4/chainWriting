/**
 * Which editing features the editor offers. Everything is on by default; a
 * feature turned off is removed from the editor itself — not just hidden
 * from the menus: its markdown shortcuts stop working, and pasted content
 * of that kind is converted (a pasted heading arrives as a paragraph, a
 * table as its cells' text). Useful for constrained inputs such as a comment
 * box: `features={{ headings: false, tables: false, images: false }}`.
 */
export interface EditorFeatures {
  /** Headings (H1–H3), with their buttons in the bubble and "/" menus. */
  headings?: boolean
  /** Block quotes. */
  blockquote?: boolean
  /** Bulleted and numbered lists. */
  lists?: boolean
  /** Code blocks. */
  codeBlock?: boolean
  /** Horizontal rules. */
  horizontalRule?: boolean
  /** Links, including Ctrl+K and autolinking typed URLs. */
  links?: boolean
  /** Images (by URL, upload, paste or drop). */
  images?: boolean
  /** Tables, with their contextual toolbar. */
  tables?: boolean
  /** The "/" command menu. */
  slashMenu?: boolean
  /** The floating formatting menu shown on text selection. */
  bubbleMenu?: boolean
}

export type ResolvedFeatures = Required<EditorFeatures>

const ALL_ON: ResolvedFeatures = {
  headings: true,
  blockquote: true,
  lists: true,
  codeBlock: true,
  horizontalRule: true,
  links: true,
  images: true,
  tables: true,
  slashMenu: true,
  bubbleMenu: true,
}

/** Fills in every feature the host didn't mention as enabled. */
export function resolveFeatures(features: EditorFeatures = {}): ResolvedFeatures {
  const resolved = { ...ALL_ON }
  for (const key of Object.keys(ALL_ON) as (keyof ResolvedFeatures)[]) {
    if (features[key] === false) resolved[key] = false
  }
  return resolved
}

/** StarterKit options that drop the nodes/marks of disabled features from the schema. */
export function starterKitOptions(features: ResolvedFeatures) {
  return {
    link: features.links ? { openOnClick: false, autolink: true } : false,
    heading: features.headings ? undefined : false,
    blockquote: features.blockquote ? undefined : false,
    bulletList: features.lists ? undefined : false,
    orderedList: features.lists ? undefined : false,
    listItem: features.lists ? undefined : false,
    listKeymap: features.lists ? undefined : false,
    codeBlock: features.codeBlock ? undefined : false,
    horizontalRule: features.horizontalRule ? undefined : false,
  } as const
}
