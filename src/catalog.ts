import countryData from './data/countries.json' with { type: 'json' };

import type { Country } from './types.js';

export const countries: Country[] = countryData;

export function resolveCountry(name: string): Country | undefined {
  const normalizedName = name.trim().toLowerCase();
  return countries.find((country) => country.name.toLowerCase() === normalizedName);
}

export function countryDataUrl(slug: string, file: number): string {
  const encodedSlug = encodeURIComponent(slug).replace(/'/g, '%27');
  return `https://vorbidden.com/${encodedSlug}/${file}.json`;
}
