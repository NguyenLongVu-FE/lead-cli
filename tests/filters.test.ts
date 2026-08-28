import { describe, expect, it } from 'vitest';

import { compileFilters } from '../src/filters.js';
import { normalizeLead } from '../src/normalize.js';
import type { FilterOptions, RawLead } from '../src/types.js';

function makeLead(fields: RawLead = {}) {
  return normalizeLead({
    title: 'Chief Revenue Officer',
    keywords: 'AI, SaaS',
    industry: 'Computer Software',
    managementlevel: 'C-Level',
    department: 'Sales Operations',
    technologies: 'HubSpot, Salesforce',
    state: 'California',
    city: 'San Francisco',
    email: 'ada@example.test',
    phone: '+1-555-0100',
    linkedin: 'ada-example',
    website: 'example.test',
    companyphone: '+1-555-0101',
    status: 'Verified',
    employees: '51',
    revenue: '250',
    ...fields
  }, 'Eritrea:1:1');
}

describe('compileFilters', () => {
  it.each([
    {
      name: 'normalizes accents and punctuation before matching long word prefixes',
      options: { titleInclude: ['dÉve'] },
      lead: makeLead({ title: 'Développeur — Plateforme' }),
      want: true
    },
    {
      name: 'does not match a long word prefix in the middle of another word',
      options: { titleInclude: ['chief'] },
      lead: makeLead({ title: 'Mischief Officer' }),
      want: false
    },
    {
      name: 'matches exact terms on word boundaries',
      options: { titleIncludeExact: ['chief'] },
      lead: makeLead({ title: 'Chief Revenue Officer' }),
      want: true
    },
    {
      name: 'does not let exact terms match inside larger words',
      options: { titleIncludeExact: ['chief'] },
      lead: makeLead({ title: 'Mischief Officer' }),
      want: false
    },
    {
      name: 'matches one-character terms as whole words',
      options: { keywordInclude: ['x'] },
      lead: makeLead({ keywords: 'X, strategy' }),
      want: true
    },
    {
      name: 'does not match one-character terms within words',
      options: { keywordInclude: ['x'] },
      lead: makeLead({ keywords: 'experience' }),
      want: false
    },
    {
      name: 'matches two-character terms as whole words',
      options: { keywordInclude: ['ai'] },
      lead: makeLead({ keywords: 'AI, SaaS' }),
      want: true
    },
    {
      name: 'does not match two-character terms within words',
      options: { keywordInclude: ['ai'] },
      lead: makeLead({ keywords: 'paid search' }),
      want: false
    },
    {
      name: 'matches keyword includes across the UI keyword fields',
      options: { keywordInclude: ['mining'] },
      lead: makeLead({ keywords: 'AI, SaaS', company: 'Eritrea Mining Group' }),
      want: true
    },
    {
      name: 'rejects keyword excludes across the UI keyword fields',
      options: { keywordExclude: ['mining'] },
      lead: makeLead({ keywords: 'AI, SaaS', description: 'Mining operations' }),
      want: false
    },
    {
      name: 'matches phrases as normalized substrings',
      options: { titleInclude: ['revenue officer'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'uses OR within include categories',
      options: { titleInclude: ['founder', 'chief'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'uses OR between exact and non-exact terms in one include category',
      options: { titleInclude: ['founder'], titleIncludeExact: ['chief'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'uses AND across include categories',
      options: { titleInclude: ['chief'], industryInclude: ['Financial Services'] },
      lead: makeLead(),
      want: false
    },
    {
      name: 'rejects an exclude match even when an include matches',
      options: { titleInclude: ['chief'], titleExclude: ['revenue'] },
      lead: makeLead(),
      want: false
    },
    {
      name: 'preserves comma-bearing industries as one configured value',
      options: { industryInclude: ['Leisure, Travel & Tourism'] },
      lead: makeLead({ industry: 'Leisure, Travel & Tourism' }),
      want: true
    },
    {
      name: 'does not split comma-bearing industries into separate configured values',
      options: { industryInclude: ['Leisure, Travel & Tourism'] },
      lead: makeLead({ industry: 'Leisure' }),
      want: false
    },
    {
      name: 'matches management-level include values',
      options: { managementInclude: ['C-Level'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'matches a technology in a comma-separated technology list',
      options: { technologyInclude: ['Salesforce'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'rejects a technology listed for exclusion',
      options: { technologyExclude: ['HubSpot'] },
      lead: makeLead(),
      want: false
    },
    {
      name: 'compares department as one lower-cased field',
      options: { departmentInclude: ['sales operations'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'accepts an employee-derived company-size label',
      options: { companySize: ['Small Enterprise'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'rejects a company-size label outside the employee range',
      options: { companySize: ['Small Team'] },
      lead: makeLead(),
      want: false
    },
    {
      name: 'includes both revenue bounds',
      options: { revenueMin: 250_000, revenueMax: 250_000 },
      lead: makeLead(),
      want: true
    },
    {
      name: 'rejects revenue outside an inclusive bound',
      options: { revenueMax: 249_999 },
      lead: makeLead(),
      want: false
    },
    {
      name: 'rejects revenue below the minimum bound',
      options: { revenueMin: 250_001 },
      lead: makeLead(),
      want: false
    },
    {
      name: 'requires matching state and city categories',
      options: { state: ['California'], city: ['San Francisco'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'rejects a city that does not match its location category',
      options: { city: ['Oakland'] },
      lead: makeLead(),
      want: false
    },
    {
      name: 'requires every required field to be non-empty',
      options: { required: ['email', 'linkedin'] },
      lead: makeLead({ email: '' }),
      want: false
    },
    {
      name: 'accepts leads with every required field populated',
      options: { required: ['email', 'linkedin'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'matches status when the source provides it',
      options: { status: ['Verified'] },
      lead: makeLead(),
      want: true
    },
    {
      name: 'rejects status filters when the optional source field is absent',
      options: { status: ['Verified'] },
      lead: makeLead({ status: null }),
      want: false
    }
  ] satisfies Array<{ name: string; options: FilterOptions; lead: ReturnType<typeof makeLead>; want: boolean }>)(
    '$name',
    ({ options, lead, want }) => {
      expect(compileFilters(options)(lead)).toBe(want);
    }
  );

  it.each([
    ['0-1M', '1000', '1001'],
    ['1-10M', '1000', '999'],
    ['10-50M', '10000', '9999'],
    ['50-100M', '50000', '49999'],
    ['100-250M', '100000', '99999'],
    ['250-500M', '250000', '249999'],
    ['500M-1B', '500000', '499999'],
    ['>1B', '1000000', '999999']
  ] as const)('applies the audited inclusive %s revenue band', (band, insideRevenue, outsideRevenue) => {
    const matches = compileFilters({ revenueBands: [band] });

    expect(matches(makeLead({ revenue: insideRevenue }))).toBe(true);
    expect(matches(makeLead({ revenue: outsideRevenue }))).toBe(false);
  });

  it('uses OR for repeated revenue bands and rejects the gap between them', () => {
    const matches = compileFilters({ revenueBands: ['0-1M', '>1B'] });

    expect(matches(makeLead({ revenue: '500' }))).toBe(true);
    expect(matches(makeLead({ revenue: '2000000' }))).toBe(true);
    expect(matches(makeLead({ revenue: '5000' }))).toBe(false);
  });

  it('rejects a missing revenue when a revenue band is selected', () => {
    expect(compileFilters({ revenueBands: ['0-1M'] })(makeLead({ revenue: null }))).toBe(false);
  });
});
