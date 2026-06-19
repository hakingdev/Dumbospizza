/**
 * Firebase Cloud Messaging (legacy HTTP API).
 * Env: FCM_SERVER_KEY
 */

export function isPushConfigured(): boolean {
  return Boolean(process.env.FCM_SERVER_KEY?.trim());
}

export async function sendFcmToTokens(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<{ success: number; failure: number; errors: string[] }> {
  const key = process.env.FCM_SERVER_KEY?.trim();
  if (!key) {
    throw new Error('FCM_SERVER_KEY not configured');
  }
  if (tokens.length === 0) {
    return { success: 0, failure: 0, errors: [] };
  }

  const errors: string[] = [];
  let success = 0;
  let failure = 0;

  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const chunk = tokens.slice(i, i + batchSize);
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: chunk,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        priority: 'high',
      }),
    });

    const json = (await res.json()) as {
      success?: number;
      failure?: number;
      results?: Array<{ error?: string }>;
    };

    success += json.success ?? 0;
    failure += json.failure ?? 0;
    json.results?.forEach((r) => {
      if (r.error) errors.push(r.error);
    });
  }

  return { success, failure, errors };
}
