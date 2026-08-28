import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LeadsCmClient } from '../src/client.js';
import { NetworkError } from '../src/errors.js';
import { createOutput } from '../src/output.js';
import type { Lead } from '../src/types.js';
import type { GetOptions, Transport, TransportResponse } from '../src/transport.js';

const encoder = new TextEncoder();

function document(rows: unknown[][]): string {
  return JSON.stringify({
    headers: ['name', 'title', 'employees', 'revenue', 'linkedin'],
    rows
  });
}

function response(rows: unknown[][], status = 200): TransportResponse {
  return responseWithHeaders(['name', 'title', 'employees', 'revenue', 'linkedin'], rows, status);
}

function responseWithHeaders(headers: string[], rows: unknown[][], status = 200): TransportResponse {
  return {
    status,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ headers, rows })));
        controller.close();
      }
    })
  };
}

class FakeTransport implements Transport {
  readonly urls: string[] = [];
  maxInFlight = 0;
  private inFlight = 0;

  constructor(private readonly replies: Map<number, TransportResponse>) {}

  async get(url: string, _options?: GetOptions): Promise<TransportResponse> {
    this.urls.push(url);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await Promise.resolve();
    this.inFlight -= 1;
    const file = Number(new URL(url).pathname.match(/\/(\d+)\.json$/)?.[1]);
    return this.replies.get(file) ?? response([], 404);
  }
}

class CollectingOutput {
  readonly leads: Lead[] = [];
  readonly rollbackable: boolean;
  committed = false;
  aborted = false;

  constructor(private readonly limit?: number, rollbackable = false) {
    this.rollbackable = rollbackable;
  }

  get written(): number {
    return this.leads.length;
  }

  get limitReached(): boolean {
    return this.limit !== undefined && this.written >= this.limit;
  }

  write(lead: Lead): void {
    if (!this.limitReached) this.leads.push(lead);
  }

  async flush(): Promise<void> {}
  async commit(): Promise<void> {
    this.committed = true;
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
}

describe('LeadsCmClient.search', () => {
  it('defaults to file 1 and waits for each request before starting the next', async () => {
    const transport = new FakeTransport(new Map([[1, response([['Ada Example', 'Founder', '11', '250', 'ada-example']])]]));
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({ country: 'Eritrea', filters: {}, output });

    expect(transport.urls).toEqual(['https://vorbidden.com/Eritrea/1.json']);
    expect(transport.maxInFlight).toBe(1);
    expect(result).toEqual({ filesCompleted: 1, rowsRead: 1, leadsMatched: 1, leadsExcluded: 0, leadsWritten: 1,
      blacklistChecked: 0, blacklistExcluded: 0, blacklistAvailable: undefined });
    expect(output.leads[0]?.sourceRef).toBe('Eritrea:1:1');
    expect(output.committed).toBe(true);
  });

  it('requests each of the five files in a dataset in order', async () => {
    const transport = new FakeTransport(new Map(Array.from({ length: 5 }, (_, index) => [index + 1, response([])])));
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({ country: 'Eritrea', selection: { kind: 'dataset', dataset: 1 }, filters: {}, output });

    expect(transport.urls).toEqual([
      'https://vorbidden.com/Eritrea/1.json',
      'https://vorbidden.com/Eritrea/2.json',
      'https://vorbidden.com/Eritrea/3.json',
      'https://vorbidden.com/Eritrea/4.json',
      'https://vorbidden.com/Eritrea/5.json'
    ]);
    expect(result.filesCompleted).toBe(5);
  });

  it('ends an all-files search at the first 404 and honors maxFiles', async () => {
    const transport = new FakeTransport(new Map([
      [1, response([])],
      [2, response([])],
      [3, response([], 404)]
    ]));
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({
      country: 'Eritrea',
      selection: { kind: 'all', startFile: 1, maxFiles: 3 },
      filters: {},
      output
    });

    expect(transport.urls).toEqual([
      'https://vorbidden.com/Eritrea/1.json',
      'https://vorbidden.com/Eritrea/2.json',
      'https://vorbidden.com/Eritrea/3.json'
    ]);
    expect(result.filesCompleted).toBe(2);
  });

  it('treats a first dataset 404 and an explicit-file 404 as errors', async () => {
    const client = new LeadsCmClient({ transport: new FakeTransport(new Map()) });

    await expect(
      client.search({ country: 'Eritrea', selection: { kind: 'dataset', dataset: 1 }, filters: {}, output: new CollectingOutput() })
    ).rejects.toThrow('not found');
    await expect(
      client.search({ country: 'Eritrea', selection: { kind: 'file', file: 7 }, filters: {}, output: new CollectingOutput() })
    ).rejects.toThrow('not found');
  });

  it('does not normalize an unknown country with an omitted selection to file 1', async () => {
    const transport = new FakeTransport(new Map([[1, response([])]]));
    const client = new LeadsCmClient({ transport });

    await expect(client.search({ country: 'Uncatalogued', filters: {}, output: new CollectingOutput() })).rejects.toThrow('explicit file selection');
    expect(transport.urls).toEqual([]);
  });

  it('aborts the active response at the output limit without requesting later files', async () => {
    let aborted = false;
    const transport: Transport = {
      async get(url, options) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(document([
              ['Ada Example', 'Founder', '11', '250', 'ada-example'],
              ['Grace Example', 'CEO', '1', '10', 'grace-example']
            ])));
            options?.signal?.addEventListener('abort', () => {
              aborted = true;
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          }
        });
        expect(url).toContain('/1.json');
        return { status: 200, headers: new Headers(), body };
      }
    };
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput(1);

    const result = await client.search({ country: 'Eritrea', filters: {}, output });

    expect(aborted).toBe(true);
    expect(result.leadsWritten).toBe(1);
    expect(output.leads.map((lead) => lead.name)).toEqual(['Ada Example']);
  });

  it('aggregates rows, matches, and writes after filtering normalized leads', async () => {
    const transport = new FakeTransport(new Map([[1, response([
      ['Ada Example', 'Founder', '11', '250', 'ada-example'],
      ['Grace Example', 'CEO', '1', '10', 'grace-example']
    ])]]));
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({ country: 'Eritrea', filters: { titleInclude: ['founder'] }, output });

    expect(result).toEqual({ filesCompleted: 1, rowsRead: 2, leadsMatched: 1, leadsExcluded: 0, leadsWritten: 1,
      blacklistChecked: 0, blacklistExcluded: 0, blacklistAvailable: undefined });
    expect(output.leads[0]).toMatchObject({ name: 'Ada Example', companysize: 'Growing Startup', revenueUsd: 250_000 });
  });

  it('accepts the documented companyphone requirement for source cphone records', async () => {
    const transport = new FakeTransport(new Map([[1, responseWithHeaders(
      ['name', 'title', 'employees', 'revenue', 'linkedin', 'cphone'],
      [['Ada Example', 'Founder', '11', '250', 'ada-example', '+1-555-0101']]
    )]]));
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({ country: 'Eritrea', filters: { required: ['companyphone'] }, output });

    expect(result).toMatchObject({ rowsRead: 1, leadsMatched: 1, leadsWritten: 1 });
    expect(output.leads[0]).toMatchObject({ cphone: '+1-555-0101' });
  });

  it('applies repeatable source exclusions after filters and before paging across files', async () => {
    const transport = new FakeTransport(new Map([
      [1, response([
        ['Ignored', 'Analyst', '11', '250', 'ignored'],
        ['Excluded', 'Founder', '11', '250', 'excluded'],
        ['First', 'Founder', '11', '250', 'first']
      ])],
      [2, response([
        ['Second', 'Founder', '11', '250', 'second'],
        ['Third', 'Founder', '11', '250', 'third'],
        ['Fourth', 'Founder', '11', '250', 'fourth']
      ])]
    ]));
    const output = new CollectingOutput();
    const client = new LeadsCmClient({ transport });

    const result = await client.search({
      country: 'Eritrea',
      selection: { kind: 'dataset', dataset: 1 },
      filters: { titleInclude: ['Founder'] },
      excludeRefs: ['Eritrea:1:2'],
      page: { number: 2, size: 2 },
      output
    });

    expect(output.leads.map((lead) => lead.sourceRef)).toEqual(['Eritrea:2:2', 'Eritrea:2:3']);
    expect(result).toMatchObject({ rowsRead: 6, leadsMatched: 4, leadsExcluded: 1, leadsWritten: 2 });
    expect(transport.urls).toEqual(['https://vorbidden.com/Eritrea/1.json', 'https://vorbidden.com/Eritrea/2.json']);
  });

  it('rejects invalid, wrong-country, and non-positive page inputs before transport', async () => {
    for (const options of [
      { excludeRefs: ['not-a-reference'] },
      { excludeRefs: ['France:1:1'] },
      { page: { number: 0, size: 50 } },
      { page: { number: 1, size: 0 } }
    ]) {
      const transport = new FakeTransport(new Map());
      const client = new LeadsCmClient({ transport });

      await expect(client.search({ country: 'Eritrea', filters: {}, output: new CollectingOutput(), ...options }))
        .rejects.toMatchObject({ name: 'CliError', exitCode: 1 });
      expect(transport.urls).toEqual([]);
    }
  });

  it('aborts the active response as soon as a requested page is full', async () => {
    let aborted = false;
    const transport: Transport = {
      async get(_url, options) {
        options?.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return response([
          ['First', 'Founder', '11', '250', 'first'],
          ['Second', 'Founder', '11', '250', 'second']
        ]);
      }
    };
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    await client.search({ country: 'Eritrea', filters: {}, page: { number: 1, size: 1 }, output });

    expect(aborted).toBe(true);
    expect(output.leads.map((lead) => lead.sourceRef)).toEqual(['Eritrea:1:1']);
  });

  it('loads blacklist first and excludes normalized emails before pagination', async () => {
    const urls: string[] = [];
    const transport: Transport = {
      async get(url) {
        urls.push(url);
        if (url.includes('/Blacklist/')) {
          return responseWithHeaders(['email'], [[' BLOCKED@example.test ']]);
        }
        return responseWithHeaders(
          ['name', 'title', 'employees', 'revenue', 'linkedin', 'email'],
          [
            ['Blocked', 'Founder', '11', '250', 'blocked', 'blocked@example.test'],
            ['First', 'Founder', '11', '250', 'first', 'first@example.test'],
            ['Second', 'Founder', '11', '250', 'second', 'second@example.test'],
            ['No Email', 'Founder', '11', '250', 'none', null]
          ]
        );
      }
    };
    const client = new LeadsCmClient({ transport });
    const output = new CollectingOutput();

    const result = await client.search({
      country: 'Eritrea', filters: {}, excludeBlacklist: true, page: { number: 2, size: 1 }, output
    });

    expect(urls[0]).toBe('https://vorbidden.com/Blacklist/Eritrea.json');
    expect(output.leads.map((lead) => lead.sourceRef)).toEqual(['Eritrea:1:3']);
    expect(result).toMatchObject({ blacklistAvailable: true, blacklistChecked: 3, blacklistExcluded: 1, leadsMatched: 2 });
  });

  it('does not request or count blacklist data unless explicitly enabled', async () => {
    const transport = new FakeTransport(new Map([[1, response([['Ada', 'Founder', '11', '250', 'ada']])]]));
    const result = await new LeadsCmClient({ transport }).search({ country: 'Eritrea', filters: {}, output: new CollectingOutput() });

    expect(transport.urls).toEqual(['https://vorbidden.com/Eritrea/1.json']);
    expect(result).toMatchObject({ blacklistAvailable: undefined, blacklistChecked: 0, blacklistExcluded: 0 });
  });

  it('keeps a body interruption as a network error when stdout has no matching output', async () => {
    const client = new LeadsCmClient({ transport: interruptedTransport() });
    const output = new CollectingOutput();

    await expect(client.search({ country: 'Eritrea', filters: { titleInclude: ['CEO'] }, output })).rejects.toMatchObject({
      name: 'NetworkError',
      exitCode: 3
    });
    expect(output.written).toBe(0);
  });

  it('classifies a body interruption after stdout output as partial output', async () => {
    const client = new LeadsCmClient({ transport: interruptedTransport() });
    const output = new CollectingOutput();

    await expect(client.search({ country: 'Eritrea', filters: {}, output })).rejects.toMatchObject({
      name: 'PartialOutputError',
      exitCode: 4
    });
    expect(output.written).toBe(1);
    expect(output.aborted).toBe(true);
  });

  it('keeps a body interruption as a network error and cleans up rollbackable atomic output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-client-'));
    const destination = join(directory, 'leads.ndjson');
    const client = new LeadsCmClient({ transport: interruptedTransport() });
    const output = createOutput({ outputPath: destination });

    await expect(client.search({ country: 'Eritrea', filters: {}, output })).rejects.toMatchObject({
      name: 'NetworkError',
      exitCode: 3
    });
    await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('LeadsCmClient.getLead', () => {
  it('fetches only the referenced file and returns the referenced source row', async () => {
    const transport = new FakeTransport(new Map([[2, response([
      ['First', 'Founder', '11', '250', 'first'],
      ['Second', 'Founder', '11', '250', 'second'],
      ['Third', 'Founder', '11', '250', 'third']
    ])]]));
    const client = new LeadsCmClient({ transport });

    const lead = await client.getLead('Eritrea:2:3');

    expect(transport.urls).toEqual(['https://vorbidden.com/Eritrea/2.json']);
    expect(lead).toMatchObject({ name: 'Third', sourceRef: 'Eritrea:2:3' });
  });

  it('aborts the source response as soon as the referenced row arrives', async () => {
    let aborted = false;
    const transport: Transport = {
      async get(_url, options) {
        options?.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return response([
          ['First', 'Founder', '11', '250', 'first'],
          ['Second', 'Founder', '11', '250', 'second'],
          ['Third', 'Founder', '11', '250', 'third']
        ]);
      }
    };

    const lead = await new LeadsCmClient({ transport }).getLead('Eritrea:1:2');

    expect(aborted).toBe(true);
    expect(lead.sourceRef).toBe('Eritrea:1:2');
  });

  it('returns typed errors for invalid references, missing files, and missing rows', async () => {
    const client = new LeadsCmClient({ transport: new FakeTransport(new Map([[1, response([['Only', 'Founder', '11', '250', 'only']])]])) });

    await expect(client.getLead('not-a-reference')).rejects.toMatchObject({ name: 'CliError', exitCode: 1 });
    await expect(client.getLead('Eritrea:2:1')).rejects.toMatchObject({ name: 'NetworkError', exitCode: 3 });
    await expect(client.getLead('Eritrea:1:2')).rejects.toMatchObject({ name: 'NetworkError', exitCode: 3 });
  });
});

function interruptedTransport(): Transport {
  let delivered = false;
  return {
    async get() {
      return {
        status: 200,
        headers: new Headers(),
        body: new ReadableStream({
          pull(controller) {
            if (delivered) {
              controller.error(new NetworkError('Response body was interrupted'));
              return;
            }
            delivered = true;
            controller.enqueue(encoder.encode('{"headers":["name","title","employees","revenue","linkedin"],"rows":[["Ada Example","Founder","11","250","ada-example"],'));
          }
        })
      };
    }
  };
}
