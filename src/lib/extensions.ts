import type { AnyExtension } from '@tiptap/react'

/**
 * Merge user-supplied Tiptap extensions into the library's fixed defaults.
 * A user extension whose `.name` matches a default extension's `.name`
 * replaces that default entirely (e.g. passing a reconfigured
 * `StarterKit.configure({ heading: false })` — name `"starterKit"` — fully
 * replaces the built-in StarterKit); anything with a new name is appended.
 */
export function mergeExtensions(
  defaults: AnyExtension[],
  user: AnyExtension[] = [],
): AnyExtension[] {
  const userNames = new Set(user.map((extension) => extension.name))
  return [...defaults.filter((extension) => !userNames.has(extension.name)), ...user]
}
