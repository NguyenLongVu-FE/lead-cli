import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { LeadsCmClient } from './client.js';
import { CliError } from './errors.js';
import { createOutput } from './output.js';
import type { DatasetExportOptions, DatasetExportResult } from './types.js';

export async function exportDatasets(client: LeadsCmClient, options: DatasetExportOptions): Promise<DatasetExportResult> {
  validateOptions(options);
  await mkdir(options.outputDir, { recursive: true });
  const files: string[] = [];

  for (let dataset = options.startDataset; dataset <= options.endDataset; dataset += 1) {
    options.signal?.throwIfAborted();
    const path = join(options.outputDir, `dataset-${dataset}.csv`);
    const output = createOutput({ format: 'csv', fields: options.fields, outputPath: path });
    await client.search({
      country: options.country,
      selection: { kind: 'dataset', dataset, size: options.datasetSize },
      filters: options.filters,
      excludeRefs: options.excludeRefs,
      excludeBlacklist: options.excludeBlacklist,
      output,
      signal: options.signal
    });
    files.push(path);
  }

  return { completedDatasets: files.length, files };
}

function validateOptions(options: DatasetExportOptions): void {
  if (!Number.isInteger(options.startDataset) || options.startDataset < 1) {
    throw new CliError('start dataset must be at least 1');
  }
  if (!Number.isInteger(options.endDataset) || options.endDataset < options.startDataset) {
    throw new CliError('end dataset must not be less than start dataset');
  }
  if (options.datasetSize !== 2 && options.datasetSize !== 5) {
    throw new CliError('dataset size must be 2 or 5');
  }
  if (options.outputDir.trim() === '') {
    throw new CliError('output directory is required');
  }
}
