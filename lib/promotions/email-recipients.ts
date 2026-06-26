export const MAX_MANUAL_EMAIL_RECIPIENTS = 5000;

export interface ParsedEmailRecipients {
  recipients: string[];
  invalidEntries: string[];
  duplicateCount: number;
  entryCount: number;
  truncated: boolean;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function extractEmail(raw: string): string {
  const trimmed = raw.trim().replace(/^mailto:/i, '');
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  const value = angleMatch ? angleMatch[1] : trimmed;
  return value
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.)\]]+$/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeEmailRecipient(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const email = extractEmail(String(raw));
  return EMAIL_RE.test(email) ? email : null;
}

export function parseEmailRecipients(
  input: string | Array<string | number>,
  options: { limit?: number } = {}
): ParsedEmailRecipients {
  const limit = options.limit ?? MAX_MANUAL_EMAIL_RECIPIENTS;
  const rawEntries = Array.isArray(input)
    ? input.map((entry) => String(entry))
    : input.split(/[\n,;]+/);

  const recipients: string[] = [];
  const invalidEntries: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let entryCount = 0;
  let truncated = false;

  for (const raw of rawEntries) {
    const entry = raw.trim();
    if (!entry) continue;
    entryCount++;

    const email = normalizeEmailRecipient(entry);
    if (!email) {
      invalidEntries.push(entry);
      continue;
    }

    if (seen.has(email)) {
      duplicateCount++;
      continue;
    }

    if (recipients.length >= limit) {
      truncated = true;
      continue;
    }

    seen.add(email);
    recipients.push(email);
  }

  return {
    recipients,
    invalidEntries,
    duplicateCount,
    entryCount,
    truncated,
  };
}
