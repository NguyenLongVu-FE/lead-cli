import { strict as assert } from 'node:assert';

import { countries, countryBlacklistUrl, LeadsCmClient, loadBlacklist } from '../src/index.js';
import { parseTabular } from '../src/parser.js';
import { FetchTransport, type GetOptions, type Transport, type TransportResponse } from '../src/transport.js';
import type { Lead, Output } from '../src/types.js';

const LIVE_GATE = 'LEADS_CM_LIVE_CONTRACT';
const COUNTRY = 'Eritrea';
const EXPECTED_HEADERS = [
  'name', 'title', 'department', 'managementlevel', 'email', 'phone', 'linkedin', 'city', 'state', 'country', 'postalcode',
  'company', 'revenue', 'foundedyear', 'employees', 'keywords', 'industry', 'description', 'languages', 'cfacebook',
  'clinkedin', 'cx', 'website', 'cphone', 'technologies', 'ccity', 'cstate', 'ccountry', 'cpostalcode', 'totalfunding'
] as const;

interface FileAudit {
  file: number;
  status: number;
  headers?: readonly string[];
  rows?: number;
  types?: Record<string, number>;
}

class AggregateOutput implements Output {
  readonly rollbackable = true;
  private count = 0;

  get written(): number { return this.count; }
  get limitReached(): boolean { return false; }
  write(_lead: Lead): void { this.count += 1; }
  async flush(): Promise<void> {}
  async commit(): Promise<void> {}
  async abort(): Promise<void> {}
}

class AuditedTransport implements Transport {
  readonly audits: FileAudit[] = [];
  readonly pending: Promise<void>[] = [];
  constructor(private readonly transport = new FetchTransport()) {}

  async get(url: string, options?: GetOptions): Promise<TransportResponse> {
    const response = await this.transport.get(url, options);
    const file = Number(new URL(url).pathname.match(/\/(\d+)\.json$/)?.[1]);
    assert(Number.isSafeInteger(file), 'live contract received an unrecognized data-file URL');
    const audit: FileAudit = { file, status: response.status };
    this.audits.push(audit);
    if (response.status !== 200) {
      return response;
    }
    const [clientBody, auditBody] = response.body.tee();
    this.pending.push(this.inspect(auditBody, audit));
    return { ...response, body: clientBody };
  }

  private async inspect(body: ReadableStream<Uint8Array>, audit: FileAudit): Promise<void> {
    const types: Record<string, number> = {};
    const parsed = await parseTabular(body, {
      onHeaders: (headers) => {
        assert.deepEqual(headers, EXPECTED_HEADERS, 'live Eritrea header schema drifted');
        audit.headers = [...headers];
      },
      onRow: (row) => {
        for (const value of Object.values(row)) {
          const type = value === null ? 'null' : typeof value;
          types[type] = (types[type] ?? 0) + 1;
        }
      }
    });
    audit.rows = parsed.rows;
    audit.types = types;
    assert.deepEqual(types, { string: parsed.rows * EXPECTED_HEADERS.length }, 'live Eritrea value-type profile drifted');
  }
}

class BlacklistAuditedTransport implements Transport {
  status: number | undefined;
  constructor(private readonly transport = new FetchTransport()) {}

  async get(url: string, options?: GetOptions): Promise<TransportResponse> {
    assert.equal(url, countryBlacklistUrl('Eritrea'), 'live contract received an unrecognized blacklist URL');
    const response = await this.transport.get(url, options);
    this.status = response.status;
    return response;
  }
}

async function main(): Promise<void> {
  if (process.env[LIVE_GATE] !== '1') {
    process.stdout.write(`live contract excluded; set ${LIVE_GATE}=1 to run against authorized leads.cm access\n`);
    return;
  }

  const country = countries.find((item) => item.name === COUNTRY);
  assert(country !== undefined, `live contract country ${COUNTRY} is missing from the catalog`);
  assert.equal(country.fileCount, 2, 'live contract requires the fixed two-file Eritrea fixture');
  const transport = new AuditedTransport();
  const output = new AggregateOutput();
  const result = await new LeadsCmClient({ transport }).search({
    country: country.name,
    selection: { kind: 'all', startFile: 1, maxFiles: country.fileCount + 1 },
    filters: {},
    output
  });
  await Promise.all(transport.pending);

  assert.deepEqual(transport.audits.map((audit) => audit.file), [1, 2, 3], 'live pagination changed');
  assert(transport.audits.slice(0, -1).every((audit) => audit.status === 200), 'live data file returned a non-200 status');
  assert.equal(transport.audits.at(-1)?.status, 404, 'live pagination did not end in 404');
  assert.equal(result.filesCompleted, country.fileCount, 'production client did not complete every small-country file');
  assert.equal(result.rowsRead, output.written, 'production client did not emit every parsed live row');

  const blacklistTransport = new BlacklistAuditedTransport();
  const blacklist = await loadBlacklist(blacklistTransport, country.slug);
  assert.equal(blacklistTransport.status, 200, 'live country blacklist returned a non-200 status');
  assert.equal(blacklist.available, true, 'live country blacklist was unavailable');
  assert(blacklist.emails.size > 0, 'live country blacklist contained no email rows');

  for (const audit of transport.audits) {
    process.stdout.write(`file ${audit.file}: status ${audit.status}\n`);
    if (audit.headers !== undefined) process.stdout.write(`headers: ${JSON.stringify(audit.headers)}\n`);
    if (audit.rows !== undefined) process.stdout.write(`rows: ${audit.rows}\n`);
    if (audit.types !== undefined) process.stdout.write(`types: ${JSON.stringify(audit.types)}\n`);
  }
  process.stdout.write(`blacklist: status ${blacklistTransport.status}, rows ${blacklist.emails.size}\n`);
}

void main().catch(() => {
  process.stderr.write('live contract failed: authorized endpoint status, schema, or pagination drifted\n');
  process.exitCode = 1;
});
