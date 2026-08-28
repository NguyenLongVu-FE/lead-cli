import { describe, expect, it } from 'vitest';

import { countries, countryDataUrl, resolveCountry } from '../src/catalog.js';

describe('country catalog', () => {
  it('resolves a trimmed country name without regard to case', () => {
    expect(resolveCountry(' united states ')).toMatchObject({
      slug: 'United_States',
      hasStatus: true
    });
  });

  it('resolves India when the runtime locale applies Turkish casing', () => {
    const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
    Object.defineProperty(String.prototype, 'toLocaleLowerCase', {
      configurable: true,
      value(this: string) {
        return originalToLocaleLowerCase.call(this, 'tr');
      }
    });

    try {
      expect(resolveCountry('INDIA')).toMatchObject({ name: 'India' });
    } finally {
      Object.defineProperty(String.prototype, 'toLocaleLowerCase', {
        configurable: true,
        value: originalToLocaleLowerCase
      });
    }
  });

  it('encodes a country slug as one URL path segment', () => {
    expect(countryDataUrl("Côte_d'Ivoire", 2)).toBe(
      'https://vorbidden.com/C%C3%B4te_d%27Ivoire/2.json'
    );
  });

  it('keeps the audited catalog internally consistent and preserves audited values', () => {
    expect(new Set(countries.map((country) => country.slug)).size).toBe(countries.length);
    expect(countries.every((country) => Number.isInteger(country.fileCount) && country.fileCount > 0)).toBe(true);
    expect(resolveCountry('United States')).toMatchObject({ estimatedLeads: 33_400_000, fileCount: 670 });
    expect(resolveCountry('India')).toMatchObject({ estimatedLeads: 6_000_000, fileCount: 120 });
    expect(resolveCountry('Eritrea')).toMatchObject({ estimatedLeads: 680, fileCount: 2 });
  });
});
