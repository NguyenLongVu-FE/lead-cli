import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type Writable } from 'node:stream';

import type { Lead, Output, OutputOptions } from './types.js';

export const DEFAULT_OUTPUT_FIELDS = [
  'sourceRef',
  'name',
  'title',
  'department',
  'managementlevel',
  'email',
  'phone',
  'linkedin',
  'city',
  'state',
  'country',
  'postalcode',
  'company',
  'revenue',
  'revenueUsd',
  'foundedyear',
  'employees',
  'companysize',
  'keywords',
  'industry',
  'description',
  'languages',
  'cfacebook',
  'clinkedin',
  'cx',
  'website',
  'cphone',
  'technologies',
  'ccity',
  'cstate',
  'ccountry',
  'cpostalcode',
  'totalfunding',
  'status'
] as const;

export function projectLead(lead: Lead, fields: readonly string[] = DEFAULT_OUTPUT_FIELDS): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in lead) {
      projected[field] = lead[field];
    }
  }
  return projected;
}

export function createOutput(options: OutputOptions = {}): Output {
  const destination = options.outputPath;
  if (destination === undefined) {
    return new OutputWriter(options.stream ?? process.stdout, options, undefined, undefined);
  }

  const temporaryPath = temporaryOutputPath(destination);
  return new OutputWriter(createWriteStream(temporaryPath, { encoding: 'utf8' }), options, destination, temporaryPath);
}

function temporaryOutputPath(destination: string): string {
  return join(dirname(destination), `.${basename(destination)}.${crypto.randomUUID()}.tmp`);
}

class OutputWriter implements Output {
  readonly rollbackable: boolean;
  private readonly fields: readonly string[];
  private readonly format: 'ndjson' | 'csv' | 'tsv';
  private readonly limit: number | undefined;
  private needsDrain = false;
  private csvHeaderWritten = false;
  private committed = false;
  private aborted = false;
  private count = 0;

  constructor(
    private readonly stream: Writable,
    options: OutputOptions,
    private readonly destination: string | undefined,
    private readonly temporaryPath: string | undefined
  ) {
    this.rollbackable = destination !== undefined;
    this.fields = options.fields ?? DEFAULT_OUTPUT_FIELDS;
    this.format = options.format ?? 'ndjson';
    this.limit = options.limit;
  }

  get written(): number {
    return this.count;
  }

  get limitReached(): boolean {
    return this.limit !== undefined && this.count >= this.limit;
  }

  write(lead: Lead): void {
    if (this.limitReached || this.aborted || this.committed) {
      return;
    }

    if (this.format !== 'ndjson' && !this.csvHeaderWritten) {
      this.writeChunk(this.format === 'csv' ? csvRow(this.fields) : tsvRow(this.fields));
      this.csvHeaderWritten = true;
    }

    const projected = projectLead(lead, this.fields);
    const values = this.fields.map((field) => projected[field]);
    this.writeChunk(
      this.format === 'ndjson' ? `${JSON.stringify(projected)}\n` : this.format === 'csv' ? csvRow(values) : tsvRow(values)
    );
    this.count += 1;
  }

  async flush(): Promise<void> {
    if (!this.needsDrain) {
      return;
    }
    await once(this.stream, 'drain');
    this.needsDrain = false;
  }

  async commit(): Promise<void> {
    if (this.committed || this.aborted) {
      return;
    }
    if (this.format !== 'ndjson' && !this.csvHeaderWritten) {
      this.writeChunk(this.format === 'csv' ? csvRow(this.fields) : tsvRow(this.fields));
      this.csvHeaderWritten = true;
    }
    await this.flush();
    if (this.destination !== undefined && this.temporaryPath !== undefined) {
      await closeWritable(this.stream);
      await rename(this.temporaryPath, this.destination);
    }
    this.committed = true;
  }

  async abort(): Promise<void> {
    if (this.aborted || this.committed) {
      return;
    }
    this.aborted = true;
    if (this.temporaryPath !== undefined) {
      try {
        await destroyWritable(this.stream);
      } finally {
        await rm(this.temporaryPath, { force: true });
      }
    }
  }

  private writeChunk(chunk: string): void {
    if (!this.stream.write(chunk)) {
      this.needsDrain = true;
    }
  }
}

function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvValue).join(',')}\r\n`;
}

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function tsvRow(values: readonly unknown[]): string {
  return `${values.map(tsvValue).join('\t')}\n`;
}

function tsvValue(value: unknown): string {
  return (value === null || value === undefined ? '' : String(value))
    .replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

function closeWritable(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}

async function destroyWritable(stream: Writable): Promise<void> {
  if (stream.closed) {
    return;
  }
  const closed = once(stream, 'close');
  stream.destroy();
  await closed;
}
