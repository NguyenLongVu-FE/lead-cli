import { AccessError, NetworkError } from './errors.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 10_000;
const REQUIRED_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://app.leads.cm/linkedin/',
  'User-Agent': 'leads-cm-cli/0.1.0'
};

export interface GetOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export interface TransportResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

export interface Transport {
  get(url: string, options?: GetOptions): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

interface FetchAttempt {
  response: Response;
  finish(): void;
}

export class FetchTransport implements Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly timeoutMs: number;

  constructor(options: FetchTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async get(url: string, options: GetOptions = {}): Promise<TransportResponse> {
    const requestUrl = new URL(url);
    const headers = new Headers(options.headers);
    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      headers.set(name, value);
    }

    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
      const attempt = await this.fetch(requestUrl, headers, options.signal);
      const { response } = attempt;

      if (response.status === 403) {
        attempt.finish();
        throw new AccessError(`Access denied by ${requestUrl.hostname}; endpoint policy may have changed. Upgrade leads-cm-cli and do not bypass access controls.`);
      }

      if (!isRetryableStatus(response.status) || retry === MAX_RETRIES) {
        return {
          status: response.status,
          headers: response.headers,
          body: protectBody(response.body, attempt.finish)
        };
      }

      const delay = retryDelay(response.headers.get('Retry-After'), retry, this.random);
      try {
        await response.body?.cancel();
      } finally {
        attempt.finish();
      }
      await this.sleep(delay);
    }

    throw new NetworkError(`Request to ${requestUrl.hostname} exhausted retries`);
  }

  private async fetch(url: URL, headers: Headers, signal?: AbortSignal): Promise<FetchAttempt> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const requestSignal = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]);
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
      }
    };

    try {
      return { response: await this.fetchImpl(url, { headers, signal: requestSignal }), finish };
    } catch (error) {
      finish();
      throw new NetworkError(`Request to ${url.hostname} failed`, { cause: error });
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function retryDelay(retryAfter: string | null, retry: number, random: () => number): number {
  const retryAfterDelay = parseRetryAfter(retryAfter);
  if (retryAfterDelay !== undefined) {
    return retryAfterDelay;
  }

  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** retry);
  const jitter = Math.floor(random() * exponentialDelay);
  return Math.min(MAX_RETRY_DELAY_MS, exponentialDelay + jitter);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
}

function protectBody(body: ReadableStream<Uint8Array> | null, finish: () => void): ReadableStream<Uint8Array> {
  if (body === null) {
    finish();
    return new ReadableStream({
      start(controller) {
        controller.close();
      }
    });
  }

  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish();
        controller.error(new NetworkError('Response body was interrupted', { cause: error }));
      }
    },
    cancel(reason) {
      try {
        return reader.cancel(reason);
      } finally {
        finish();
      }
    }
  });
}
