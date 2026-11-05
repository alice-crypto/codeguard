export function isSafeUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https:\/\//i.test(url);
}
