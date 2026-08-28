import { countryDataUrl, resolveCountry } from './catalog.js';
import { loadBlacklist, normalizeEmail } from './blacklist.js';
import { CliError, PartialOutputError, NetworkError } from './errors.js';
import { compileFilters } from './filters.js';
import { normalizeLead } from './normalize.js';
import { parseTabular } from './parser.js';
import { planSelection } from './planner.js';
import { createSourceRef, parseSourceRef } from './source-ref.js';
import { FetchTransport, type Transport } from './transport.js';
import type { Lead, SearchOptions, SearchResult, Selection } from './types.js';

export interface LeadsCmClientOptions {
  transport?: Transport;
}

export class LeadsCmClient {
  private readonly transport: Transport;

  constructor(options: LeadsCmClientOptions = {}) {
    this.transport = options.transport ?? new FetchTransport();
  }

  async getLead(sourceRef: string): Promise<Lead> {
    let location: ReturnType<typeof parseSourceRef>;
    try {
      location = parseSourceRef(sourceRef);
    } catch {
      throw new CliError(`Invalid source reference: ${sourceRef}`);
    }

    const controller = new AbortController();
    const response = await this.transport.get(countryDataUrl(location.slug, location.file), { signal: controller.signal });
    if (response.status === 404) {
      await response.body.cancel();
      throw new NetworkError(`Data file ${location.file} was not found`);
    }
    if (response.status !== 200) {
      await response.body.cancel();
      throw new NetworkError(`Data file ${location.file} returned HTTP ${response.status}`);
    }

    let row = 0;
    let found: Lead | undefined;
    try {
      await parseTabular(response.body, {
        onHeaders: () => undefined,
        onRow: (raw) => {
          row += 1;
          if (row === location.row) {
            found = normalizeLead(raw, createSourceRef(location.slug, location.file, row));
            controller.abort();
          }
        }
      });
    } catch (error) {
      if (!(controller.signal.aborted && found !== undefined)) {
        throw error;
      }
    }

    if (found === undefined) {
      throw new NetworkError(`Source row ${location.row} was not found`);
    }
    return found;
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const country = resolveCountry(options.country);
    if (country === undefined && options.selection === undefined) {
      throw new NetworkError(`Country ${options.country} requires an explicit file selection`);
    }
    const selection = options.selection ?? { kind: 'file', file: 1 } satisfies Selection;
    if (country === undefined && selection.kind !== 'file') {
      throw new NetworkError(`Country ${options.country} is not available for multi-file searches`);
    }

    const slug = country?.slug ?? options.country.trim().replaceAll(' ', '_');
    const plan = planSelection(selection);
    const matches = compileFilters(options.filters);
    const excludedRefs = validateExcludedRefs(options.excludeRefs ?? [], slug);
    const page = validatePage(options.page);
    const pageOffset = page === undefined ? 0 : (page.number - 1) * page.size;
    let filesCompleted = 0;
    let rowsRead = 0;
    let leadsMatched = 0;
    let leadsExcluded = 0;
    let blacklistChecked = 0;
    let blacklistExcluded = 0;
    let blacklistAvailable: boolean | undefined;
    let blacklistEmails: ReadonlySet<string> = new Set();
    let pageWritten = 0;
    let pageComplete = false;

    try {
      options.signal?.throwIfAborted();
      if (options.excludeBlacklist === true) {
        const blacklist = await loadBlacklist(this.transport, slug, options.signal);
        blacklistAvailable = blacklist.available;
        blacklistEmails = blacklist.emails;
      }
      for (let file = plan.start; file <= plan.end && !options.output.limitReached && !pageComplete; file += 1) {
        options.signal?.throwIfAborted();
        const controller = new AbortController();
        const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
        const response = await this.transport.get(countryDataUrl(slug, file), { signal });

        if (response.status === 404) {
          await response.body.cancel();
          if (plan.stopOn404 && filesCompleted > 0) {
            break;
          }
          throw new NetworkError(`Data file ${file} was not found`);
        }
        if (response.status !== 200) {
          await response.body.cancel();
          throw new NetworkError(`Data file ${file} returned HTTP ${response.status}`);
        }

        try {
          let rowsReadInFile = 0;
          await parseTabular(response.body, {
            onHeaders: () => undefined,
            onRow: (raw) => {
              if (options.output.limitReached || pageComplete) {
                return;
              }
              rowsReadInFile += 1;
              rowsRead += 1;
              const lead = normalizeLead(raw, createSourceRef(slug, file, rowsReadInFile));
              if (!matches(lead)) {
                return;
              }
              if (blacklistAvailable === true && typeof lead.email === 'string' && lead.email.trim() !== '') {
                blacklistChecked += 1;
                if (blacklistEmails.has(normalizeEmail(lead.email))) {
                  blacklistExcluded += 1;
                  return;
                }
              }
              if (excludedRefs.has(lead.sourceRef)) {
                leadsExcluded += 1;
                return;
              }
              leadsMatched += 1;
              if (leadsMatched <= pageOffset) {
                return;
              }
              options.output.write(lead);
              pageWritten += 1;
              pageComplete = page !== undefined && pageWritten >= page.size;
              if (options.output.limitReached || pageComplete) {
                controller.abort();
              }
            },
            onChunkComplete: () => options.output.flush()
          });
          filesCompleted += 1;
        } catch (error) {
          if (!(controller.signal.aborted && (options.output.limitReached || pageComplete))) {
            throw error;
          }
        }
      }

      await options.output.flush();
      await options.output.commit();
      return {
        filesCompleted,
        rowsRead,
        leadsMatched,
        leadsExcluded,
        blacklistChecked,
        blacklistExcluded,
        blacklistAvailable,
        leadsWritten: options.output.written
      };
    } catch (error) {
      await options.output.abort();
      if (options.output.written > 0 && !options.output.rollbackable) {
        throw new PartialOutputError('Search failed after partial output', { cause: error });
      }
      throw error;
    }
  }
}

function validateExcludedRefs(references: readonly string[], slug: string): ReadonlySet<string> {
  const validated = new Set<string>();
  for (const reference of references) {
    let location: ReturnType<typeof parseSourceRef>;
    try {
      location = parseSourceRef(reference);
    } catch {
      throw new CliError(`Invalid source reference: ${reference}`);
    }
    if (location.slug !== slug) {
      throw new CliError(`Source reference country ${location.slug} does not match ${slug}`);
    }
    validated.add(createSourceRef(location.slug, location.file, location.row));
  }
  return validated;
}

function validatePage(page: SearchOptions['page']): SearchOptions['page'] {
  if (page === undefined) {
    return undefined;
  }
  if (!Number.isInteger(page.number) || page.number < 1) {
    throw new CliError('page number must be at least 1');
  }
  if (!Number.isInteger(page.size) || page.size < 1) {
    throw new CliError('page size must be at least 1');
  }
  return page;
}
