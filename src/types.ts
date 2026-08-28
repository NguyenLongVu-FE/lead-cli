export interface Country {
  name: string;
  slug: string;
  estimatedLeads: number;
  fileCount: number;
  hasStatus: boolean;
}

export type Selection =
  | { kind: 'file'; file: number }
  | { kind: 'dataset'; dataset: number; size?: 2 | 5 }
  | { kind: 'all'; startFile: number; maxFiles?: number };

export interface SourceLocation {
  slug: string;
  file: number;
  row: number;
}

export interface BlacklistLoadResult {
  available: boolean;
  emails: ReadonlySet<string>;
}

export interface FilePlan {
  start: number;
  end: number;
  stopOn404: boolean;
}

export type RawLeadValue = string | number | boolean | null;

export type RawLead = Record<string, RawLeadValue>;

export type Lead = RawLead & {
  sourceRef: string;
  employees: number | null;
  companysize: string | null;
  revenueUsd: number | null;
};

export interface FilterOptions {
  titleInclude?: readonly string[];
  titleExclude?: readonly string[];
  titleIncludeExact?: readonly string[];
  titleExcludeExact?: readonly string[];
  keywordInclude?: readonly string[];
  keywordExclude?: readonly string[];
  keywordIncludeExact?: readonly string[];
  keywordExcludeExact?: readonly string[];
  industryInclude?: readonly string[];
  industryExclude?: readonly string[];
  managementInclude?: readonly string[];
  managementExclude?: readonly string[];
  departmentInclude?: readonly string[];
  departmentExclude?: readonly string[];
  technologyInclude?: readonly string[];
  technologyExclude?: readonly string[];
  companySize?: readonly string[];
  revenueMin?: number;
  revenueMax?: number;
  revenueBands?: readonly RevenueBand[];
  state?: readonly string[];
  city?: readonly string[];
  required?: readonly string[];
  status?: readonly string[];
}

export type RevenueBand = '0-1M' | '1-10M' | '10-50M' | '50-100M' | '100-250M' | '250-500M' | '500M-1B' | '>1B';

export interface ParseStats {
  rows: number;
}

export interface ParseCallbacks {
  onHeaders(headers: readonly string[]): void;
  onRow(row: RawLead): void;
  onChunkComplete?: () => Promise<void>;
}

export type OutputFormat = 'ndjson' | 'csv' | 'tsv';

export interface OutputOptions {
  format?: OutputFormat;
  fields?: readonly string[];
  limit?: number;
  outputPath?: string;
  stream?: import('node:stream').Writable;
}

export interface Output {
  readonly written: number;
  readonly limitReached: boolean;
  readonly rollbackable: boolean;
  write(lead: Lead): void;
  flush(): Promise<void>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface SearchOptions {
  country: string;
  selection?: Selection;
  filters: FilterOptions;
  excludeBlacklist?: boolean;
  excludeRefs?: readonly string[];
  page?: { number: number; size: number };
  signal?: AbortSignal;
  output: Output;
}

export interface SearchResult {
  filesCompleted: number;
  rowsRead: number;
  leadsMatched: number;
  leadsExcluded: number;
  blacklistChecked: number;
  blacklistExcluded: number;
  blacklistAvailable: boolean | undefined;
  leadsWritten: number;
}

export interface DatasetExportOptions {
  country: string;
  startDataset: number;
  endDataset: number;
  datasetSize: 2 | 5;
  outputDir: string;
  filters: FilterOptions;
  excludeRefs?: readonly string[];
  excludeBlacklist?: boolean;
  fields?: readonly string[];
  signal?: AbortSignal;
}

export interface DatasetExportResult {
  completedDatasets: number;
  files: string[];
}
