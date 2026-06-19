const DEFAULT_BASE_URL = 'https://api.mews.com/pos';

export type MewsPosHeaders = Record<string, string>;

export interface MewsPosResponse<T> {
  data: T;
  included?: any[];
  links?: {
    next?: string | null;
  };
}

function getBaseUrl() {
  return process.env.MEWS_POS_BASE_URL || DEFAULT_BASE_URL;
}

function getApiKey() {
  return process.env.MEWS_POS_API_KEY || '';
}

export async function mewsPosRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<MewsPosResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MEWS_POS_API_KEY is not set');
  }

  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: MewsPosHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/vnd.api+json',
    ...(options.headers as Record<string, string> | undefined)
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mews POS request failed (${response.status}): ${text}`);
  }

  return response.json();
}

