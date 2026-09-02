export * from './types';
export * from './patterns';
export * from './suggest';

import type { Incident } from '../types';
import type { PersonIndex } from '../person';
import { extractByPattern } from './patterns';
import { toSuggestions } from './suggest';
import type { Finding, Suggestion } from './types';

/**
 * The offline read. Always available, no network, no configuration.
 *
 * The model-backed pass is additive on top of this, never a replacement: an
 * agency that cannot or will not send narratives to a third party still gets
 * the plate, the VIN, the times and the people.
 */
export function readNarrative(incident: Incident, people: PersonIndex): Suggestion[] {
  return toSuggestions(extractByPattern({ incident, people }), incident, people, 'pattern');
}

/**
 * Merges a model's findings in with the pattern ones.
 *
 * Pattern findings go first so that where both extractors found the same
 * thing, the deterministic one wins and the suggestion is reproducible.
 */
export function mergeFindings(
  incident: Incident,
  people: PersonIndex,
  modelFindings: Finding[],
): Suggestion[] {
  const pattern = extractByPattern({ incident, people });
  return [
    ...toSuggestions(pattern, incident, people, 'pattern'),
    ...toSuggestions(modelFindings, incident, people, 'model').filter(
      (m) => !pattern.some((p) => p.field === m.field && String(p.value) === m.value),
    ),
  ];
}
