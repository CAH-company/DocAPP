import pl from "./pl.json";

// Jedyny język w F1; struktura pozwala dodać kolejne bez zmian w komponentach.
export const messages = { pl } as const;
export type Locale = keyof typeof messages;
export const defaultLocale: Locale = "pl";

export function t(path: string, locale: Locale = defaultLocale): string {
  let node: unknown = messages[locale];
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return path;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : path;
}
