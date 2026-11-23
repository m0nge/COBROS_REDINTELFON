export const HARD_REFRESH_QUERY_PARAM = '__hard_refresh';

export function buildHardRefreshUrl(currentUrl: string, cacheBuster: number): string {
  const url = new URL(currentUrl);
  url.searchParams.set(HARD_REFRESH_QUERY_PARAM, String(cacheBuster));
  return url.toString();
}

export function cleanHardRefreshUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  if (!url.searchParams.has(HARD_REFRESH_QUERY_PARAM)) return currentUrl;
  url.searchParams.delete(HARD_REFRESH_QUERY_PARAM);
  return url.toString();
}
