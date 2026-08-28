import { describe, expect, it } from 'vitest';

import { countryBlacklistUrl, loadBlacklist } from '../src/blacklist.js';
import type { Transport, TransportResponse } from '../src/transport.js';

const encoder = new TextEncoder();

function response(document: unknown, status = 200): TransportResponse {
  return {
    status,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify(document)));
        controller.close();
      }
    })
  };
}

function transportWith(reply: TransportResponse): Transport {
  return { async get() { return reply; } };
}

describe('country blacklist', () => {
  it('uses the audited encoded blacklist URL', () => {
    expect(countryBlacklistUrl("Côte_d'Ivoire")).toBe("https://vorbidden.com/Blacklist/C%C3%B4te_d%27Ivoire.json");
  });

  it('loads and normalizes the email column without retaining other values', async () => {
    const result = await loadBlacklist(transportWith(response({
      headers: ['name', 'EMAIL'],
      rows: [['ignored', ' Ada@Example.test '], ['ignored', 'GRACE@example.test']]
    })), 'Eritrea');

    expect(result).toEqual({ available: true, emails: new Set(['ada@example.test', 'grace@example.test']) });
  });

  it('treats a missing country blacklist as unavailable', async () => {
    await expect(loadBlacklist(transportWith(response({}, 404)), 'Eritrea'))
      .resolves.toEqual({ available: false, emails: new Set() });
  });

  it('rejects malformed documents and schemas without an email column', async () => {
    await expect(loadBlacklist(transportWith(response({ headers: ['email'], rows: 'broken' })), 'Eritrea'))
      .rejects.toMatchObject({ name: 'SchemaError', exitCode: 5 });
    await expect(loadBlacklist(transportWith(response({ headers: ['name'], rows: [['Ada']] })), 'Eritrea'))
      .rejects.toMatchObject({ name: 'SchemaError', exitCode: 5 });
  });
});
