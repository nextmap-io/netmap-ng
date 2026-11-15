/** The URL if it is http(s), else undefined: stored links may predate server-side checks. */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url.trim()) ? url : undefined;
}
