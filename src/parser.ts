import { JSONParser, TokenType } from '@streamparser/json';

import { SchemaError } from './errors.js';
import type { ParseCallbacks, ParseStats, RawLead, RawLeadValue } from './types.js';

export async function parseTabular(
  stream: ReadableStream<Uint8Array>,
  callbacks: ParseCallbacks
): Promise<ParseStats> {
  let headers: string[] | undefined;
  let hasRowsContainer = false;
  let rows = 0;
  let callbackError: unknown;
  let depth = 0;
  let topLevelKey: string | undefined;
  let awaitingTopLevelValue: string | undefined;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parser = new JSONParser({ paths: ['$.headers', '$.rows.*'], keepStack: false });

  parser.onToken = ({ token, value }) => {
    if (depth === 1 && token === TokenType.STRING) {
      topLevelKey = value as string;
    } else if (depth === 1 && token === TokenType.COLON && topLevelKey !== undefined) {
      awaitingTopLevelValue = topLevelKey;
      topLevelKey = undefined;
    } else if (depth === 1 && awaitingTopLevelValue !== undefined) {
      if (awaitingTopLevelValue === 'rows') {
        if (token !== TokenType.LEFT_BRACKET) {
          throw new SchemaError('Response rows must be an array');
        }
        hasRowsContainer = true;
      }
      awaitingTopLevelValue = undefined;
    }

    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
      depth += 1;
    } else if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) {
      depth -= 1;
    }
  };

  parser.onValue = ({ key, value }) => {
    try {
      if (key === 'headers') {
        if (headers !== undefined || !isHeaderRow(value)) {
          throw new SchemaError('Response headers must be a single array of strings');
        }
        headers = [...value];
        callbacks.onHeaders(headers);
        return;
      }

      if (typeof key === 'number') {
        if (headers === undefined) {
          throw new SchemaError('Response row arrived before headers');
        }
        if (!Array.isArray(value) || value.length !== headers.length || !value.every(isRawLeadValue)) {
          throw new SchemaError(`Response row ${key} does not match the header schema`);
        }

        const row: RawLead = {};
        for (let index = 0; index < headers.length; index += 1) {
          row[headers[index]] = value[index];
        }
        callbacks.onRow(row);
        rows += 1;
      }
    } catch (error) {
      callbackError = error;
      throw error;
    }
  };

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      try {
        const input = decoder.decode(value, { stream: true });
        if (input !== '') {
          parser.write(input);
        }
      } catch (error) {
        throw parserError(error, callbackError);
      }
      await callbacks.onChunkComplete?.();
    }

    try {
      const input = decoder.decode();
      if (input !== '') {
        parser.write(input);
      }
    } catch (error) {
      throw parserError(error, callbackError);
    }

    if (!parser.isEnded) {
      try {
        parser.end();
      } catch (error) {
        throw parserError(error, callbackError);
      }
    }

    if (headers === undefined) {
      throw new SchemaError('Response is missing headers');
    }
    if (!hasRowsContainer) {
      throw new SchemaError('Response is missing rows');
    }
    return { rows };
  } finally {
    reader.releaseLock();
  }
}

function isHeaderRow(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((header) => typeof header === 'string');
}

function isRawLeadValue(value: unknown): value is RawLeadValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function parserError(error: unknown, callbackError: unknown): Error {
  if (error === callbackError && error instanceof Error) {
    return error;
  }
  if (error instanceof SchemaError) {
    return error;
  }
  return new SchemaError('Response JSON could not be parsed', { cause: error });
}
