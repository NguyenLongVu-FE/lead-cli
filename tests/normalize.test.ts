import { describe, expect, it } from 'vitest';

import { normalizeLead } from '../src/normalize.js';

describe('normalizeLead', () => {
  it('derives numeric employee, company size, revenue, and LinkedIn values without inventing an id', () => {
    const lead = normalizeLead({ name: 'Ada Example', employees: '11', revenue: '250', linkedin: 'ada-example' }, 'Eritrea:1:42');

    expect(lead).toMatchObject({
      name: 'Ada Example',
      employees: 11,
      companysize: 'Growing Startup',
      revenue: '250',
      revenueUsd: 250_000,
      linkedin: 'http://www.linkedin.com/in/ada-example',
      sourceRef: 'Eritrea:1:42'
    });
    expect(lead).not.toHaveProperty('id');
    expect(lead).not.toHaveProperty('cfacebook');
  });

  it('normalizes the real company URL columns while preserving absolute URLs', () => {
    expect(
      normalizeLead({
        employees: null,
        revenue: null,
        clinkedin: 'example-co',
        cfacebook: 'example-co',
        cx: 'example-co',
        website: 'https://example.test'
      }, 'Eritrea:1:1')
    ).toMatchObject({
      employees: null,
      companysize: null,
      revenue: null,
      revenueUsd: null,
      clinkedin: 'http://www.linkedin.com/company/example-co',
      cfacebook: 'http://www.facebook.com/example-co',
      cx: 'http://twitter.com/example-co',
      website: 'https://example.test'
    });
  });

  it('turns non-numeric employee and revenue values into null derivations', () => {
    expect(normalizeLead({ employees: 'unknown', revenue: '' }, 'Eritrea:1:1')).toMatchObject({
      employees: null,
      companysize: null,
      revenueUsd: null
    });
  });
});
