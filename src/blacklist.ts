import { NetworkError, SchemaError } from './errors.js';
import { parseTabular } from './parser.js';
import type { BlacklistLoadResult } from './types.js';
import type { Transport } from './transport.js';

export function countryBlacklistUrl(slug: string): string {
  const encodedSlug = encodeURIComponent(slug).replace(/'/g, '%27');
  return `https://vorbidden.com/Blacklist/${encodedSlug}.json`;
}

export async function loadBlacklist(transport: Transport, slug: string, signal?: AbortSignal): Promise<BlacklistLoadResult> {
  const response = await transport.get(countryBlacklistUrl(slug), { signal });
  if (response.status === 404) {
    await response.body.cancel();
    return { available: false, emails: new Set() };
  }
  if (response.status !== 200) {
    await response.body.cancel();
    throw new NetworkError(`Blacklist for ${slug} returned HTTP ${response.status}`);
  }

  const emails = new Set<string>();
  let emailField: string | undefined;
  await parseTabular(response.body, {
    onHeaders(headers) {
      emailField = headers.find((header) => header.toLowerCase() === 'email');
      if (emailField === undefined) {
        throw new SchemaError('Blacklist response is missing an email column');
      }
    },
    onRow(row) {
      const email = emailField === undefined ? undefined : row[emailField];
      if (typeof email === 'string' && email.trim() !== '') {
        emails.add(normalizeEmail(email));
      }
    }
  });
  return { available: true, emails };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
