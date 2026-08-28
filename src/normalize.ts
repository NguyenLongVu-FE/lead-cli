import type { Lead, RawLead, RawLeadValue } from './types.js';

const URL_PREFIXES: Readonly<Record<string, string>> = {
  linkedin: 'http://www.linkedin.com/in/',
  clinkedin: 'http://www.linkedin.com/company/',
  cfacebook: 'http://www.facebook.com/',
  cx: 'http://twitter.com/',
  website: 'http://'
};

export function normalizeLead(raw: RawLead, sourceRef: string): Lead {
  const employees = numberOrNull(raw.employees);
  const revenue = numberOrNull(raw.revenue);
  const lead: Lead = {
    ...raw,
    sourceRef,
    employees,
    companysize: companySize(employees),
    revenueUsd: revenue === null ? null : revenue * 1_000
  };

  for (const [field, prefix] of Object.entries(URL_PREFIXES)) {
    if (field in lead) {
      lead[field] = prefixedUrl(lead[field], prefix);
    }
  }
  return lead;
}

function numberOrNull(value: RawLeadValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function companySize(employees: number | null): string | null {
  if (employees === null || employees < 1) {
    return null;
  }
  if (employees === 1) return 'Solo Entrepreneur';
  if (employees <= 10) return 'Small Team';
  if (employees <= 20) return 'Growing Startup';
  if (employees <= 50) return 'Emerging Business';
  if (employees <= 100) return 'Small Enterprise';
  if (employees <= 200) return 'Medium Enterprise';
  if (employees <= 500) return 'Established Company';
  if (employees <= 1_000) return 'Large Company';
  if (employees <= 2_000) return 'Major Enterprise';
  if (employees <= 5_000) return 'Leading Organization';
  if (employees <= 10_000) return 'Corporate Giant';
  return 'Global Corporation';
}

function prefixedUrl(value: RawLeadValue | undefined, prefix: string): RawLeadValue {
  if (typeof value !== 'string' || value === '' || /^https?:\/\//i.test(value)) {
    return value ?? null;
  }
  return `${prefix}${value}`;
}
