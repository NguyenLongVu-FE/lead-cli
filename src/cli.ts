#!/usr/bin/env node

import { z } from 'zod';

import { countries, countryDataUrl, DEFAULT_OUTPUT_FIELDS, FILTER_METADATA, LeadsCmClient, REVENUE_BANDS, createOutput, exportDatasets, parseSourceRef, planSelection, projectLead, resolveCountry } from './index.js';
import { AccessError, CliError, NetworkError, SchemaError } from './errors.js';
import type { FilterOptions, RevenueBand, Selection, Transport, TransportResponse } from './index.js';
import { FetchTransport } from './transport.js';

const HELP = `Usage: leads-cm <command>

Commands:
  setup
  countries [--json]
  linkedin filters [--json]
  linkedin search --country <country> [options]
  linkedin verify --country <country> [options]
  linkedin lead view <source-ref> [--format json|text]
  linkedin export datasets --country <country> [options]
`;

const SEARCH_HELP = `Usage: leads-cm linkedin search --country <country> [options]

Selection: --file <n> | --dataset <n> [--dataset-size 2|5] | --all
Window: --page <n> [--page-size <n>] | --limit <n>
Output: --format ndjson|csv|tsv [--fields <fields>] [--output <path>]
Safety: --dry-run, --exclude-ref <source-ref>, --exclude-blacklist
Filters: --revenue-band <band>; run leads-cm linkedin filters --json for all metadata
`;

const VERIFY_HELP = SEARCH_HELP.replace('linkedin search', 'linkedin verify') + '\nVerification is country blacklist-only; it does not verify mailbox deliverability.\n';
const LEAD_VIEW_HELP = 'Usage: leads-cm linkedin lead view <source-ref> [--format json|text]\n';
const EXPORT_DATASETS_HELP = `Usage: leads-cm linkedin export datasets --country <country> --start-dataset <n> --end-dataset <n> --output-dir <path> [options]

Dataset: --dataset-size 2|5
Safety: --dry-run, --exclude-ref <source-ref>, --exclude-blacklist
Output: CSV files in --output-dir; optionally select --fields <fields>
`;

const SEARCH_FLAGS = new Set([
  'country',
  'file',
  'dataset',
  'dataset-size',
  'all',
  'max-files',
  'start-file',
  'dry-run',
  'title-include',
  'title-exclude',
  'title-include-exact',
  'title-exclude-exact',
  'keyword-include',
  'keyword-exclude',
  'keyword-include-exact',
  'keyword-exclude-exact',
  'industry-include',
  'industry-exclude',
  'management-include',
  'management-exclude',
  'department-include',
  'department-exclude',
  'technology-include',
  'technology-exclude',
  'company-size',
  'revenue-min',
  'revenue-max',
  'revenue-band',
  'state',
  'city',
  'require',
  'status',
  'format',
  'fields',
  'output',
  'limit',
  'page',
  'page-size',
  'exclude-ref',
  'exclude-blacklist'
]);

const BOOLEAN_FLAGS = new Set(['all', 'dry-run', 'exclude-blacklist']);
const REPEATABLE_FLAGS = new Set([
  'title-include',
  'title-exclude',
  'title-include-exact',
  'title-exclude-exact',
  'keyword-include',
  'keyword-exclude',
  'keyword-include-exact',
  'keyword-exclude-exact',
  'industry-include',
  'industry-exclude',
  'management-include',
  'management-exclude',
  'department-include',
  'department-exclude',
  'technology-include',
  'technology-exclude',
  'company-size',
  'state',
  'city',
  'require',
  'status',
  'fields',
  'revenue-band',
  'exclude-ref'
]);

const EXPORT_FLAGS = new Set(
  [...SEARCH_FLAGS].filter((flag) => !['file', 'dataset', 'all', 'max-files', 'start-file', 'page', 'page-size', 'limit', 'format', 'output'].includes(flag))
);
for (const flag of ['start-dataset', 'end-dataset', 'output-dir']) {
  EXPORT_FLAGS.add(flag);
}

type ParsedOptions = Record<string, string | string[] | boolean | undefined>;

const searchSchema = z.object({
  country: z.string().trim().min(1, '--country is required'),
  file: positiveInteger().optional(),
  dataset: positiveInteger().optional(),
  datasetSize: z.enum(['2', '5']).transform((value): 2 | 5 => Number(value) as 2 | 5).optional(),
  all: z.boolean(),
  maxFiles: positiveInteger().optional(),
  startFile: positiveInteger().optional(),
  dryRun: z.boolean(),
  revenueMin: finiteNumber().optional(),
  revenueMax: finiteNumber().optional(),
  limit: positiveInteger().optional(),
  page: positiveInteger().optional(),
  pageSize: positiveInteger().optional(),
  revenueBands: z.array(z.enum(REVENUE_BANDS)).optional(),
  excludeBlacklist: z.boolean(),
  format: z.enum(['ndjson', 'csv', 'tsv']).default('ndjson'),
  output: z.string().min(1).optional()
});

const datasetExportSchema = z.object({
  country: z.string().trim().min(1, '--country is required'),
  startDataset: positiveInteger(),
  endDataset: positiveInteger(),
  datasetSize: z.enum(['2', '5']).default('5').transform((value): 2 | 5 => Number(value) as 2 | 5),
  outputDir: z.string().trim().min(1, '--output-dir is required'),
  dryRun: z.boolean(),
  revenueMin: finiteNumber().optional(),
  revenueMax: finiteNumber().optional(),
  revenueBands: z.array(z.enum(REVENUE_BANDS)).optional(),
  excludeBlacklist: z.boolean()
});

async function main(arguments_: readonly string[]): Promise<void> {
  if (arguments_.length === 0 || arguments_[0] === '--help' || arguments_[0] === '-h') {
    writeStdout(HELP);
    return;
  }

  if (isCommandHelp(arguments_, ['linkedin', 'search'])) {
    writeStdout(SEARCH_HELP);
    return;
  }
  if (isCommandHelp(arguments_, ['linkedin', 'verify'])) {
    writeStdout(VERIFY_HELP);
    return;
  }
  if (isCommandHelp(arguments_, ['linkedin', 'lead', 'view'])) {
    writeStdout(LEAD_VIEW_HELP);
    return;
  }
  if (isCommandHelp(arguments_, ['linkedin', 'export', 'datasets'])) {
    writeStdout(EXPORT_DATASETS_HELP);
    return;
  }

  if (arguments_[0] === 'setup' && arguments_.length === 1) {
    await setup();
    writeStdout('Setup succeeded\n');
    return;
  }

  if (arguments_[0] === 'countries') {
    const options = parseSimpleJson(arguments_.slice(1));
    const output = options.json ? JSON.stringify(countries) : countries.map((country) => `${country.name}\t${country.estimatedLeads}\t${country.fileCount}`).join('\n');
    writeStdout(`${output}\n`);
    return;
  }

  if (arguments_[0] === 'linkedin' && arguments_[1] === 'filters') {
    const options = parseSimpleJson(arguments_.slice(2));
    const metadata = { ...FILTER_METADATA, outputFields: DEFAULT_OUTPUT_FIELDS };
    writeStdout(options.json ? `${JSON.stringify(metadata)}\n` : `${formatMetadata(metadata)}\n`);
    return;
  }

  if (arguments_[0] === 'linkedin' && arguments_[1] === 'search') {
    await search(arguments_.slice(2));
    return;
  }

  if (arguments_[0] === 'linkedin' && arguments_[1] === 'verify') {
    await search(arguments_.slice(2), true);
    return;
  }

  if (arguments_[0] === 'linkedin' && arguments_[1] === 'lead' && arguments_[2] === 'view') {
    await leadView(arguments_.slice(3));
    return;
  }

  if (arguments_[0] === 'linkedin' && arguments_[1] === 'export' && arguments_[2] === 'datasets') {
    await exportDatasetRange(arguments_.slice(3));
    return;
  }

  throw new CliError(`Unknown command: ${arguments_.join(' ')}`);
}

async function setup(): Promise<void> {
  const transport = endpointTransport();
  try {
    const response = await transport.get(countryDataUrl('Eritrea', 1), { headers: { Range: 'bytes=0-511' } });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body.cancel();
      throw new AccessError('Setup probe did not receive an authorized JSON response');
    }
    const prefix = await readPrefix(response, 512);
    if (!prefix.trimStart().startsWith('{"headers"')) {
      throw new AccessError('Setup probe did not receive the expected data format');
    }
  } catch (error) {
    if (error instanceof AccessError) {
      throw error;
    }
    throw new AccessError('Setup probe failed', { cause: error });
  }
}

async function search(arguments_: readonly string[], verificationMode = false): Promise<void> {
  const options = parseSearchOptions(arguments_);
  const parsed = parseSearchSchema(options);
  const country = resolveCountry(parsed.country);
  const selection = selectionFrom(parsed, country !== undefined);
  if (country === undefined && selection.kind !== 'file') {
    throw new NetworkError(`Country ${parsed.country} is not available for multi-file searches`);
  }
  const filters = filtersFrom(options);
  const fields = splitComma(values(options, 'fields'));
  if (filters.status !== undefined && country?.hasStatus !== true) {
    throw new CliError(`Country ${parsed.country} does not provide the status field`);
  }
  const page = parsed.page === undefined ? undefined : { number: parsed.page, size: parsed.pageSize ?? 50 };
  const excludeRefs = values(options, 'exclude-ref');
  const excludeBlacklist = verificationMode || parsed.excludeBlacklist;
  validateExcludeRefs(excludeRefs, country?.slug ?? parsed.country.replaceAll(' ', '_'));

  if (parsed.dryRun) {
    const slug = country?.slug ?? parsed.country.replaceAll(' ', '_');
    const plan = planSelection(selection);
    writeStdout(`${JSON.stringify({
      country: country ?? { name: parsed.country, slug },
      selection,
      urls: Array.from({ length: plan.end - plan.start + 1 }, (_, index) => countryDataUrl(slug, plan.start + index)),
      filters,
      page,
      excludeRefsCount: excludeRefs?.length ?? 0,
      excludeBlacklist,
      output: { format: parsed.format, fields: fields.length === 0 ? undefined : fields, path: parsed.output, limit: parsed.limit }
    })}\n`);
    return;
  }

  const output = createOutput({ format: parsed.format, fields: fields.length === 0 ? undefined : fields, outputPath: parsed.output, limit: parsed.limit });
  if (selection.kind === 'all' && country !== undefined) {
    writeStderr(`warning: --all may process about ${country.estimatedLeads} leads across ${country.fileCount} files\n`);
  } else if (selection.kind === 'dataset' && country !== undefined) {
    const plan = planSelection(selection);
    const catalogFiles = Math.max(0, Math.min(plan.end, country.fileCount) - plan.start + 1);
    writeStderr(`warning: --dataset ${selection.dataset} may process up to ${catalogFiles} catalog files (about ${country.estimatedLeads} leads total catalog)\n`);
  }
  const client = new LeadsCmClient({ transport: endpointTransport() });
  const result = await client.search({
    country: parsed.country,
    selection,
    filters,
    excludeRefs,
    excludeBlacklist,
    page,
    output
  });
  if (result.blacklistAvailable === false) {
    writeStderr(`warning: no known blacklist for ${parsed.country}; no emails were excluded\n`);
  }
  writeStderr(`completed: ${result.filesCompleted} files, ${result.rowsRead} rows, ${result.leadsMatched} matched, ${result.leadsWritten} written\n`);
  if (verificationMode) {
    writeStderr(`verificationMode=blacklist-only checked=${result.blacklistChecked} excluded=${result.blacklistExcluded} written=${result.leadsWritten}\n`);
  }
}

async function leadView(arguments_: readonly string[]): Promise<void> {
  const sourceRef = arguments_[0];
  if (sourceRef === undefined || sourceRef.startsWith('--')) {
    throw new CliError('source reference is required');
  }
  let format: 'json' | 'text' = 'json';
  if (arguments_.length > 1) {
    if (arguments_.length !== 3 || arguments_[1] !== '--format' || (arguments_[2] !== 'json' && arguments_[2] !== 'text')) {
      throw new CliError('lead view supports only --format json|text');
    }
    format = arguments_[2];
  }
  const lead = await new LeadsCmClient({ transport: endpointTransport() }).getLead(sourceRef);
  const projected = projectLead(lead);
  if (format === 'json') {
    writeStdout(`${JSON.stringify(projected)}\n`);
    return;
  }
  writeStdout(`${Object.entries(projected).map(([field, value_]) => `${field}: ${value_ ?? ''}`).join('\n')}\n`);
}

async function exportDatasetRange(arguments_: readonly string[]): Promise<void> {
  const options = parseOptions(arguments_, EXPORT_FLAGS);
  const parsed = parseDatasetExportSchema(options);
  const country = resolveCountry(parsed.country);
  if (country === undefined) {
    throw new NetworkError(`Country ${parsed.country} is not available for multi-file searches`);
  }
  const filters = filtersFrom(options);
  if (filters.status !== undefined && !country.hasStatus) {
    throw new CliError(`Country ${parsed.country} does not provide the status field`);
  }
  const fields = splitComma(values(options, 'fields'));
  const excludeRefs = values(options, 'exclude-ref');
  validateExcludeRefs(excludeRefs, country.slug);
  const datasets = Array.from({ length: parsed.endDataset - parsed.startDataset + 1 }, (_, index) => {
    const dataset = parsed.startDataset + index;
    const files = planSelection({ kind: 'dataset', dataset, size: parsed.datasetSize });
    return {
      dataset,
      files: { start: files.start, end: files.end },
      urls: Array.from({ length: files.end - files.start + 1 }, (_unused, fileIndex) => countryDataUrl(country.slug, files.start + fileIndex))
    };
  });
  if (parsed.dryRun) {
    writeStdout(`${JSON.stringify({ country, datasetSize: parsed.datasetSize, datasets, filters,
      excludeRefsCount: excludeRefs?.length ?? 0, excludeBlacklist: parsed.excludeBlacklist, outputDir: parsed.outputDir })}\n`);
    return;
  }

  writeStderr(`estimate: ${datasets.length} datasets, ${datasets.length * parsed.datasetSize} source files\n`);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('cancelled'));
  process.once('SIGINT', cancel);
  try {
    const result = await exportDatasets(new LeadsCmClient({ transport: endpointTransport() }), {
      country: parsed.country,
      startDataset: parsed.startDataset,
      endDataset: parsed.endDataset,
      datasetSize: parsed.datasetSize,
      outputDir: parsed.outputDir,
      filters,
      excludeRefs,
      excludeBlacklist: parsed.excludeBlacklist,
      fields: fields.length === 0 ? undefined : fields,
      signal: controller.signal
    });
    writeStdout(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
    writeStderr('cancelled: unfinished dataset output removed\n');
    process.exitCode = 130;
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}

function parseSearchOptions(arguments_: readonly string[]): ParsedOptions {
  return parseOptions(arguments_, SEARCH_FLAGS);
}

function parseOptions(arguments_: readonly string[], allowedFlags: ReadonlySet<string>): ParsedOptions {
  const parsed: ParsedOptions = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--')) {
      throw new CliError(`Unexpected argument: ${argument}`);
    }
    const flag = argument.slice(2);
    if (!allowedFlags.has(flag)) {
      throw new CliError(`Unknown option: ${argument}`);
    }
    if (BOOLEAN_FLAGS.has(flag)) {
      if (parsed[flag] !== undefined) {
        throw new CliError(`Option may be provided only once: ${argument}`);
      }
      parsed[flag] = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliError(`Option requires a value: ${argument}`);
    }
    index += 1;
    if (REPEATABLE_FLAGS.has(flag)) {
      const existing = parsed[flag];
      parsed[flag] = [...(Array.isArray(existing) ? existing : []), value];
    } else if (parsed[flag] === undefined) {
      parsed[flag] = value;
    } else {
      throw new CliError(`Option may be provided only once: ${argument}`);
    }
  }
  return parsed;
}

function parseDatasetExportSchema(options: ParsedOptions): z.infer<typeof datasetExportSchema> {
  const result = datasetExportSchema.safeParse({
    country: value(options, 'country'),
    startDataset: value(options, 'start-dataset'),
    endDataset: value(options, 'end-dataset'),
    datasetSize: value(options, 'dataset-size'),
    outputDir: value(options, 'output-dir'),
    dryRun: options['dry-run'] === true,
    revenueMin: value(options, 'revenue-min'),
    revenueMax: value(options, 'revenue-max'),
    revenueBands: values(options, 'revenue-band'),
    excludeBlacklist: options['exclude-blacklist'] === true
  });
  if (!result.success) {
    throw new CliError(result.error.issues[0]?.message ?? 'Invalid export options');
  }
  if (result.data.endDataset < result.data.startDataset) {
    throw new CliError('--end-dataset must not be less than --start-dataset');
  }
  if (result.data.revenueMin !== undefined && result.data.revenueMax !== undefined && result.data.revenueMin > result.data.revenueMax) {
    throw new CliError('--revenue-min must not exceed --revenue-max');
  }
  if (result.data.revenueBands !== undefined && (result.data.revenueMin !== undefined || result.data.revenueMax !== undefined)) {
    throw new CliError('--revenue-band cannot be combined with --revenue-min or --revenue-max');
  }
  return result.data;
}

function parseSearchSchema(options: ParsedOptions): z.infer<typeof searchSchema> {
  if (value(options, 'country') === undefined || value(options, 'country')?.trim() === '') {
    throw new CliError('--country is required');
  }
  const result = searchSchema.safeParse({
    country: value(options, 'country'),
    file: value(options, 'file'),
    dataset: value(options, 'dataset'),
    datasetSize: value(options, 'dataset-size'),
    all: options.all === true,
    maxFiles: value(options, 'max-files'),
    startFile: value(options, 'start-file'),
    dryRun: options['dry-run'] === true,
    revenueMin: value(options, 'revenue-min'),
    revenueMax: value(options, 'revenue-max'),
    limit: value(options, 'limit'),
    page: value(options, 'page'),
    pageSize: value(options, 'page-size'),
    revenueBands: values(options, 'revenue-band'),
    excludeBlacklist: options['exclude-blacklist'] === true,
    format: value(options, 'format'),
    output: value(options, 'output')
  });
  if (!result.success) {
    throw new CliError(result.error.issues[0]?.message ?? 'Invalid options');
  }
  if (result.data.revenueMin !== undefined && result.data.revenueMax !== undefined && result.data.revenueMin > result.data.revenueMax) {
    throw new CliError('--revenue-min must not exceed --revenue-max');
  }
  if (result.data.revenueBands !== undefined && (result.data.revenueMin !== undefined || result.data.revenueMax !== undefined)) {
    throw new CliError('--revenue-band cannot be combined with --revenue-min or --revenue-max');
  }
  if (result.data.pageSize !== undefined && result.data.page === undefined) {
    throw new CliError('--page-size requires --page');
  }
  if (result.data.page !== undefined && result.data.limit !== undefined) {
    throw new CliError('--page cannot be combined with --limit');
  }
  if (options['dataset-size'] !== undefined && result.data.dataset === undefined) {
    throw new CliError('--dataset-size requires --dataset');
  }
  return result.data;
}

function selectionFrom(options: z.infer<typeof searchSchema>, isCataloguedCountry: boolean): Selection {
  const selectionCount = Number(options.file !== undefined) + Number(options.dataset !== undefined) + Number(options.all);
  if (selectionCount > 1) {
    throw new CliError('Use exactly one selection mode: --file, --dataset, or --all');
  }
  if (!options.all && (options.maxFiles !== undefined || options.startFile !== undefined)) {
    throw new CliError('--max-files and --start-file require --all');
  }
  if (options.file !== undefined) {
    return { kind: 'file', file: options.file };
  }
  if (options.dataset !== undefined) {
    return { kind: 'dataset', dataset: options.dataset, size: options.datasetSize ?? 5 };
  }
  if (options.all) {
    return { kind: 'all', startFile: options.startFile ?? 1, maxFiles: options.maxFiles };
  }
  if (!isCataloguedCountry) {
    throw new CliError('An unknown country requires an explicit --file selection');
  }
  return { kind: 'file', file: 1 };
}

function filtersFrom(options: ParsedOptions): FilterOptions {
  return omitUndefined({
    titleInclude: values(options, 'title-include'),
    titleExclude: values(options, 'title-exclude'),
    titleIncludeExact: values(options, 'title-include-exact'),
    titleExcludeExact: values(options, 'title-exclude-exact'),
    keywordInclude: values(options, 'keyword-include'),
    keywordExclude: values(options, 'keyword-exclude'),
    keywordIncludeExact: values(options, 'keyword-include-exact'),
    keywordExcludeExact: values(options, 'keyword-exclude-exact'),
    industryInclude: values(options, 'industry-include'),
    industryExclude: values(options, 'industry-exclude'),
    managementInclude: values(options, 'management-include'),
    managementExclude: values(options, 'management-exclude'),
    departmentInclude: values(options, 'department-include'),
    departmentExclude: values(options, 'department-exclude'),
    technologyInclude: values(options, 'technology-include'),
    technologyExclude: values(options, 'technology-exclude'),
    companySize: values(options, 'company-size'),
    revenueMin: numberValue(options, 'revenue-min'),
    revenueMax: numberValue(options, 'revenue-max'),
    revenueBands: values(options, 'revenue-band') as RevenueBand[] | undefined,
    state: values(options, 'state'),
    city: values(options, 'city'),
    required: splitComma(values(options, 'require')),
    status: values(options, 'status')
  });
}

function endpointTransport(): Transport {
  const endpoint = process.env.LEADS_CM_BASE_URL;
  const transport = new FetchTransport();
  if (endpoint === undefined) {
    return transport;
  }
  return {
    get(url, options) {
      const source = new URL(url);
      return transport.get(new URL(source.pathname, withTrailingSlash(endpoint)).toString(), options);
    }
  };
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseSimpleJson(arguments_: readonly string[]): { json: boolean } {
  if (arguments_.length === 0) {
    return { json: false };
  }
  if (arguments_.length === 1 && arguments_[0] === '--json') {
    return { json: true };
  }
  throw new CliError('Only --json is supported by this command');
}

async function readPrefix(response: TransportResponse, length: number): Promise<string> {
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let remaining = length;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      remaining -= value.byteLength;
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(concat(chunks, length));
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(Math.min(length, chunks.reduce((total, chunk) => total + chunk.byteLength, 0)));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, result.byteLength - offset);
    result.set(slice, offset);
    offset += slice.byteLength;
    if (offset === result.byteLength) {
      break;
    }
  }
  return result;
}

function formatMetadata(metadata: { companySizes: readonly string[]; requiredFields: readonly string[]; statusValues: readonly string[]; revenueBands: readonly string[]; outputFields: readonly string[] }): string {
  return `company sizes: ${metadata.companySizes.join(', ')}\nrevenue bands: ${metadata.revenueBands.join(', ')}\nrequired fields: ${metadata.requiredFields.join(', ')}\noutput fields: ${metadata.outputFields.join(', ')}\nstatus values: ${metadata.statusValues.join(', ')}`;
}

function isCommandHelp(arguments_: readonly string[], command: readonly string[]): boolean {
  return arguments_.length === command.length + 1 && command.every((part, index) => arguments_[index] === part) &&
    (arguments_.at(-1) === '--help' || arguments_.at(-1) === '-h');
}

function value(options: ParsedOptions, key: string): string | undefined {
  const found = options[key];
  return typeof found === 'string' ? found : undefined;
}

function values(options: ParsedOptions, key: string): string[] | undefined {
  const found = options[key];
  return Array.isArray(found) && found.length > 0 ? found : undefined;
}

function numberValue(options: ParsedOptions, key: string): number | undefined {
  const found = value(options, key);
  return found === undefined ? undefined : Number(found);
}

function splitComma(values_: readonly string[] | undefined): string[] {
  return (values_ ?? []).flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
}

function validateExcludeRefs(references: readonly string[] | undefined, slug: string): void {
  for (const reference of references ?? []) {
    let location: ReturnType<typeof parseSourceRef>;
    try {
      location = parseSourceRef(reference);
    } catch {
      throw new CliError(`Invalid source reference: ${reference}`);
    }
    if (location.slug !== slug) {
      throw new CliError(`Source reference country ${location.slug} does not match ${slug}`);
    }
  }
}

function omitUndefined<T extends Record<string, unknown>>(value_: T): T {
  return Object.fromEntries(Object.entries(value_).filter(([, value]) => value !== undefined)) as T;
}

function positiveInteger() {
  return z.coerce.number().int().positive();
}

function finiteNumber() {
  return z.coerce.number().finite();
}

function writeStdout(message: string): void {
  process.stdout.write(message);
}

function writeStderr(message: string): void {
  process.stderr.write(message);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CliError) {
    writeStderr(`${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof Error) {
    writeStderr(`${error.message}\n`);
  } else {
    writeStderr('Unexpected error\n');
  }
  process.exitCode = 1;
});
