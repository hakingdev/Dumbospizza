import { mewsPosRequest, MewsPosResponse } from './client';

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let nextPath: string | null = path;

  while (nextPath) {
    const response: MewsPosResponse<T[] | T> = await mewsPosRequest(nextPath);
    const data = Array.isArray(response.data) ? response.data : [response.data];
    results.push(...data);

    const nextLink = response.links?.next;
    if (nextLink) {
      const base = process.env.MEWS_POS_BASE_URL || 'https://api.mews.com/pos';
      const url = new URL(nextLink, base);
      nextPath = `${url.pathname}${url.search}`;
    } else {
      nextPath = null;
    }
  }

  return results;
}

