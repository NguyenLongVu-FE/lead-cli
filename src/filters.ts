import type { FilterOptions, Lead, RawLeadValue, RevenueBand } from './types.js';

export const REVENUE_BANDS = ['0-1M', '1-10M', '10-50M', '50-100M', '100-250M', '250-500M', '500M-1B', '>1B'] as const satisfies readonly RevenueBand[];

const REVENUE_RANGES: Readonly<Record<RevenueBand, readonly [number, number]>> = {
  '0-1M': [0, 1_000_000],
  '1-10M': [1_000_000, 10_000_000],
  '10-50M': [10_000_000, 50_000_000],
  '50-100M': [50_000_000, 100_000_000],
  '100-250M': [100_000_000, 250_000_000],
  '250-500M': [250_000_000, 500_000_000],
  '500M-1B': [500_000_000, 1_000_000_000],
  '>1B': [1_000_000_000, Number.POSITIVE_INFINITY]
};

export const FILTER_METADATA = {
  companySizes: [
    'Solo Entrepreneur',
    'Small Team',
    'Growing Startup',
    'Emerging Business',
    'Small Enterprise',
    'Medium Enterprise',
    'Established Company',
    'Large Company',
    'Major Enterprise',
    'Leading Organization',
    'Corporate Giant',
    'Global Corporation'
  ],
  requiredFields: ['email', 'phone', 'linkedin', 'website', 'companyphone'],
  statusValues: ['Valid', 'Good', 'Risky', 'Invalid'],
  revenueBands: REVENUE_BANDS
} as const;

const REQUIRED_FIELD_ALIASES: Readonly<Record<string, string>> = {
  companyphone: 'cphone'
};

const KEYWORD_FIELDS = ['title', 'department', 'managementlevel', 'company', 'keywords', 'industry', 'description'] as const;

export function compileFilters(options: FilterOptions): (lead: Lead) => boolean {
  const title = compileTextCategory(options.titleInclude, options.titleExclude, options.titleIncludeExact, options.titleExcludeExact);
  const keyword = compileTextFieldsCategory(
    options.keywordInclude,
    options.keywordExclude,
    options.keywordIncludeExact,
    options.keywordExcludeExact
  );
  const industry = compileTextCategory(options.industryInclude, options.industryExclude);
  const management = compileTextCategory(options.managementInclude, options.managementExclude);
  const department = compileDepartmentCategory(options.departmentInclude, options.departmentExclude);
  const technology = compileTechnologyCategory(options.technologyInclude, options.technologyExclude);
  const companySize = compileExactCategory(options.companySize);
  const state = compileExactCategory(options.state);
  const city = compileExactCategory(options.city);
  const status = compileExactCategory(options.status);
  const revenueBands = compileRevenueBands(options.revenueBands);
  const required = options.required ?? [];

  return (lead) =>
    title(valueAt(lead, 'title')) &&
    keyword(KEYWORD_FIELDS.map((field) => valueAt(lead, field))) &&
    industry(valueAt(lead, 'industry')) &&
    management(valueAt(lead, 'managementlevel')) &&
    department(valueAt(lead, 'department')) &&
    technology(valueAt(lead, 'technologies')) &&
    companySize(valueAt(lead, 'companysize')) &&
    state(valueAt(lead, 'state')) &&
    city(valueAt(lead, 'city')) &&
    status(valueAt(lead, 'status')) &&
    required.every((field) => isPresent(lead[REQUIRED_FIELD_ALIASES[field] ?? field])) &&
    revenueBands(lead.revenueUsd) &&
    withinRevenueBounds(lead.revenueUsd, options.revenueMin, options.revenueMax);
}

function compileRevenueBands(bands: readonly RevenueBand[] | undefined): (revenue: number | null) => boolean {
  const ranges = (bands ?? []).map((band) => REVENUE_RANGES[band]);
  if (ranges.length === 0) {
    return () => true;
  }
  return (revenue) => revenue !== null && ranges.some(([minimum, maximum]) => revenue >= minimum && revenue <= maximum);
}

type ValueMatcher = (value: RawLeadValue | undefined) => boolean;

function compileTextCategory(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
  includeExact: readonly string[] | undefined = [],
  excludeExact: readonly string[] | undefined = []
): ValueMatcher {
  const includes = [...(include ?? [])].map(compileTextMatch);
  const exactIncludes = [...includeExact].map(compileExactTextMatch);
  const excludes = [...(exclude ?? [])].map(compileTextMatch);
  const exactExcludes = [...excludeExact].map(compileExactTextMatch);

  return (value) => {
    const text = normalizeText(value);
    return (
      (includes.length + exactIncludes.length === 0 ||
        includes.some((matches) => matches(text)) ||
        exactIncludes.some((matches) => matches(text))) &&
      !excludes.some((matches) => matches(text)) &&
      !exactExcludes.some((matches) => matches(text))
    );
  };
}

function compileTextFieldsCategory(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
  includeExact: readonly string[] | undefined = [],
  excludeExact: readonly string[] | undefined = []
): (values: readonly (RawLeadValue | undefined)[]) => boolean {
  const includes = [...(include ?? [])].map(compileTextMatch);
  const exactIncludes = [...includeExact].map(compileExactTextMatch);
  const excludes = [...(exclude ?? [])].map(compileTextMatch);
  const exactExcludes = [...excludeExact].map(compileExactTextMatch);

  return (values) => {
    const texts = values.map(normalizeText);
    return (
      (includes.length + exactIncludes.length === 0 ||
        texts.some((text) => includes.some((matches) => matches(text)) || exactIncludes.some((matches) => matches(text)))) &&
      !texts.some((text) => excludes.some((matches) => matches(text)) || exactExcludes.some((matches) => matches(text)))
    );
  };
}

function compileDepartmentCategory(include: readonly string[] | undefined, exclude: readonly string[] | undefined): ValueMatcher {
  const includes = [...(include ?? [])].map((value) => value.toLowerCase());
  const excludes = [...(exclude ?? [])].map((value) => value.toLowerCase());

  return (value) => {
    const department = stringValue(value).toLowerCase();
    return (
      (includes.length === 0 || includes.some((filter) => department.includes(filter))) &&
      !excludes.some((filter) => department.includes(filter))
    );
  };
}

function compileTechnologyCategory(include: readonly string[] | undefined, exclude: readonly string[] | undefined): ValueMatcher {
  const includes = [...(include ?? [])].map(compileTextMatch);
  const excludes = [...(exclude ??[])].map(compileTextMatch);

  return (value) => {
    const technologies = stringValue(value).split(',').map(normalizeText);
    return (
      (includes.length === 0 || includes.some((matches) => technologies.some(matches))) &&
      !excludes.some((matches) => technologies.some(matches))
    );
  };
}

function compileExactCategory(values: readonly string[] | undefined): ValueMatcher {
  const filters = new Set((values ?? []).map(normalizeText));
  return (value) => filters.size === 0 || filters.has(normalizeText(value));
}

function compileTextMatch(value: string): (text: string) => boolean {
  const term = normalizeText(value);
  if (term.includes(' ')) {
    return (text) => text.includes(term);
  }
  if (term.length <= 2) {
    return compileExactNormalizedTextMatch(term);
  }
  const prefix = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, 'u');
  return (text) => prefix.test(text);
}

function compileExactTextMatch(value: string): (text: string) => boolean {
  return compileExactNormalizedTextMatch(normalizeText(value));
}

function compileExactNormalizedTextMatch(term: string): (text: string) => boolean {
  const exact = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?:$|[^\\p{L}\\p{N}])`, 'u');
  return (text) => exact.test(text);
}

function withinRevenueBounds(revenue: number | null, minimum: number | undefined, maximum: number | undefined): boolean {
  if (minimum === undefined && maximum === undefined) {
    return true;
  }
  return revenue !== null && (minimum === undefined || revenue >= minimum) && (maximum === undefined || revenue <= maximum);
}

function valueAt(lead: Lead, field: string): RawLeadValue | undefined {
  return lead[field];
}

function isPresent(value: RawLeadValue | undefined): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

function stringValue(value: RawLeadValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function normalizeText(value: RawLeadValue | string | undefined): string {
  return stringValue(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
