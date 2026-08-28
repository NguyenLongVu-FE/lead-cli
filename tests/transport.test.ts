import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessError, NetworkError } from '../src/errors.js';
import { FetchTransport } from '../src/transport.js';
import { startHttpServer, type LocalHttpServer } from './http-server.js';

const servers: LocalHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serverFor(
  handler: Parameters<typeof startHttpServer>[0]
): Promise<LocalHttpServer> {
  const server = await startHttpServer(handler);
  servers.push(server);
  return server;
}

async function readBody(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

describe('FetchTransport', () => {
  it('sends the required JSON request headers', async () => {
    const server = await serverFor((request, response) => {
      expect(request.headers).toMatchObject({
        accept: 'application/json',
        referer: 'https://app.leads.cm/linkedin/',
        'user-agent': 'leads-cm-cli/0.1.0'
      });
      response.end('{"leads":[]}');
    });
    const fetchImpl = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toBeInstanceOf(Headers);
        return globalThis.fetch(input, init);
      }
    ) as unknown as typeof fetch;
    const transport = new FetchTransport({ fetchImpl });

    const result = await transport.get(`${server.url}/Eritrea/1.json`);

    await expect(readBody(result.body)).resolves.toBe('{"leads":[]}');
  });

  it('keeps required headers when a caller supplies differently cased headers and a byte range', async () => {
    const server = await serverFor((request, response) => {
      expect(request.headers).toMatchObject({
        range: 'bytes=100-199',
        accept: 'application/json',
        referer: 'https://app.leads.cm/linkedin/'
      });
      response.statusCode = 206;
      response.end('partial');
    });
    const fetchImpl = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('accept')).toBe('application/json');
        expect(headers.get('referer')).toBe('https://app.leads.cm/linkedin/');
        expect(headers.get('user-agent')).toBe('leads-cm-cli/0.1.0');
        expect(headers.get('range')).toBe('bytes=100-199');
        return globalThis.fetch(input, init);
      }
    ) as unknown as typeof fetch;
    const transport = new FetchTransport({ fetchImpl });

    const result = await transport.get(`${server.url}/Eritrea/1.json`, {
      headers: {
        Range: 'bytes=100-199',
        accept: 'text/html',
        referer: 'https://caller.example/',
        'user-agent': 'caller-client'
      }
    });

    expect(result.status).toBe(206);
    await expect(readBody(result.body)).resolves.toBe('partial');
  });

  it('returns status, headers, and a readable successful body', async () => {
    const server = await serverFor((_request, response) => {
      response.setHeader('X-Result', 'streamed');
      response.write('{"first":');
      response.end('true}');
    });
    const transport = new FetchTransport();

    const result = await transport.get(`${server.url}/Eritrea/1.json`);

    expect(result.status).toBe(200);
    expect(result.headers.get('x-result')).toBe('streamed');
    await expect(readBody(result.body)).resolves.toBe('{"first":true}');
  });

  it('fails a 403 once as an access error', async () => {
    let requests = 0;
    const server = await serverFor((_request, response) => {
      requests += 1;
      response.statusCode = 403;
      response.end('forbidden');
    });
    const transport = new FetchTransport();

    await expect(transport.get(`${server.url}/Eritrea/1.json`)).rejects.toMatchObject({
      name: 'AccessError',
      exitCode: 2,
      message: expect.stringContaining('endpoint policy may have changed')
    });
    expect(requests).toBe(1);
  });

  it('passes a 404 response through without retrying', async () => {
    let requests = 0;
    const server = await serverFor((_request, response) => {
      requests += 1;
      response.statusCode = 404;
      response.end('missing');
    });
    const transport = new FetchTransport();

    const result = await transport.get(`${server.url}/Eritrea/1.json`);

    expect(result.status).toBe(404);
    expect(requests).toBe(1);
    await expect(readBody(result.body)).resolves.toBe('missing');
  });

  it('honors Retry-After before retrying a 429', async () => {
    let requests = 0;
    const waits: number[] = [];
    const server = await serverFor((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.statusCode = 429;
        response.setHeader('Retry-After', '2');
        response.end('slow down');
        return;
      }
      response.end('recovered');
    });
    const transport = new FetchTransport({
      sleep: async (milliseconds) => void waits.push(milliseconds),
      random: () => 0
    });

    const result = await transport.get(`${server.url}/Eritrea/1.json`);

    expect(requests).toBe(2);
    expect(waits).toEqual([2_000]);
    await expect(readBody(result.body)).resolves.toBe('recovered');
  });

  it('retries a server failure and returns the later response', async () => {
    let requests = 0;
    const waits: number[] = [];
    const server = await serverFor((_request, response) => {
      requests += 1;
      response.statusCode = requests === 1 ? 500 : 200;
      response.end(requests === 1 ? 'temporary failure' : 'recovered');
    });
    const transport = new FetchTransport({
      sleep: async (milliseconds) => void waits.push(milliseconds),
      random: () => 0
    });

    const result = await transport.get(`${server.url}/Eritrea/1.json`);

    expect(requests).toBe(2);
    expect(waits).toEqual([250]);
    await expect(readBody(result.body)).resolves.toBe('recovered');
  });

  it('turns an attempt that exceeds the configured timeout into a network error', async () => {
    const fetchImpl = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    ) as unknown as typeof fetch;
    const transport = new FetchTransport({ fetchImpl, timeoutMs: 5 });

    await expect(transport.get('https://vorbidden.com/Eritrea/1.json')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps the timeout active while a 200 response body stalls after headers', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          }
        });
        return Promise.resolve(new Response(body));
      }) as unknown as typeof fetch;
      const transport = new FetchTransport({ fetchImpl, timeoutMs: 5 });
      const result = await transport.get('https://vorbidden.com/Eritrea/1.json');
      let streamError: unknown;
      void readBody(result.body).catch((error: unknown) => {
        streamError = error;
      });

      await vi.advanceTimersByTimeAsync(5);

      expect(streamError).toBeInstanceOf(NetworkError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an interrupted response body as a network error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        controller.error(new Error('connection dropped'));
      }
    });
    const fetchImpl = vi.fn(async () => new Response(body)) as unknown as typeof fetch;
    const transport = new FetchTransport({ fetchImpl });

    const result = await transport.get('https://vorbidden.com/Eritrea/1.json');

    await expect(readBody(result.body)).rejects.toBeInstanceOf(NetworkError);
  });
});
