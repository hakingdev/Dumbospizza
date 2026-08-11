/**
 * AI-анализ адреса доставки через Claude API: входит ли адрес в одну из зон,
 * настроенных рестораном в админке, и в какую именно.
 *
 * Claude получает список зон (имя, км по дороге, Liefergebühr, Mindestbestellwert)
 * и — если удалось посчитать — геоданные (PLZ, Ortsteile, дорожное расстояние).
 * Ответ — строго по JSON-схеме (structured outputs), имя зоны копируется из списка.
 * Ключ ANTHROPIC_API_KEY живёт только на сервере (.env.local / Vercel env).
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ZoneForAnalysis {
  name: string;
  maxDistance: number;
  deliveryFee: number;
  minOrderAmount: number;
}

export interface GeoContextForAnalysis {
  postcode?: string;
  localities?: string[];
  roadDistanceKm?: number;
  /** 'road' — реальный маршрут (Google/OSRM), 'estimated' — Luftlinie × коэффициент. */
  distanceMode?: 'road' | 'estimated';
}

export interface ZoneAnalysisVerdict {
  canDeliver: boolean;
  zoneName: string | null;
  confidence: 'high' | 'medium' | 'low';
  message: string;
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    canDeliver: {
      type: 'boolean',
      description: 'true, если адрес попадает в одну из зон доставки',
    },
    zoneName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Точное имя зоны из списка (скопировать 1:1) или null',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    message: {
      type: 'string',
      description: 'Короткое дружелюбное сообщение клиенту на немецком',
    },
  },
  required: ['canDeliver', 'zoneName', 'confidence', 'message'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the delivery-zone dispatcher for the pizzeria "Dumbos Pizza" in Bad Kissingen, Bavaria, Germany.
Your only job: decide whether a customer address lies inside one of the restaurant-defined delivery zones, and if so, pick exactly one zone.

How the zones work:
- "maxDistance" is the maximum DRIVING distance in km from the restaurant to the address.
- Zones with a place name (e.g. "Garitz", "Bad Kissingen Zentrum", "Euerdorf") refer to that Ortsteil / village — an address in that district belongs to that zone regardless of exact distance.
- Zones named like "10-12 km" are pure distance rings: match them by driving distance only.
- If several zones qualify, pick the most specific one (district match beats ring; among rings the smallest qualifying one).
- If the address matches no zone (too far away, different town outside all zones), set canDeliver=false and zoneName=null.

Rules for the answer:
- "zoneName" must be copied EXACTLY, character by character, from the provided zone list — or null.
- Use the provided geodata when present; it comes from a geocoder and a routing engine and is more reliable than guessing. If geodata is missing, use your own geographic knowledge of the Bad Kissingen area.
- "message" is one short, friendly German sentence for the customer (e.g. "Wir liefern gerne zu Ihnen nach Garitz!" or "Leider liegt Ihre Adresse außerhalb unseres Liefergebiets.").
- Do not invent zones, fees or distances.`;

/**
 * Бросает при любой ошибке (нет ключа, таймаут, refusal, кривой JSON) —
 * вызывающий роут ловит и падает на геометрический fallback.
 */
export async function analyzeDeliveryAddress(params: {
  address: string;
  restaurantAddress: string;
  zones: ZoneForAnalysis[];
  geo?: GeoContextForAnalysis | null;
}): Promise<ZoneAnalysisVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });

  const userPrompt = [
    `Restaurant address: ${params.restaurantAddress}`,
    '',
    'Delivery zones (JSON):',
    JSON.stringify(params.zones, null, 2),
    '',
    `Customer address: ${params.address}`,
    '',
    'Geodata for the customer address (may be missing or approximate):',
    params.geo ? JSON.stringify(params.geo, null, 2) : 'not available',
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    // low effort: простая классификация в чекауте, важна задержка ответа
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: VERDICT_SCHEMA as any },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  } as any);

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined the request');
  }

  const textBlock = response.content.find((block: any) => block.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
  if (!textBlock?.text) throw new Error('Empty response from Claude');

  const verdict = JSON.parse(textBlock.text) as ZoneAnalysisVerdict;
  if (typeof verdict.canDeliver !== 'boolean') throw new Error('Malformed verdict');
  return verdict;
}
