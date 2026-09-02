/**
 * Findings to suggestions, and suggestions to the report.
 *
 * Between the two sits everything that decides whether this feature is helpful
 * or infuriating: dropping what the narrative does not actually say, marking
 * what the report already contains, and never touching a field the officer did
 * not click.
 */

import type { Incident } from '../types';
import type { PersonIndex } from '../person';
import { displayName } from '../person';
import { createIncidentPerson, createVehicle, createProperty } from '../factory';
import { labelOf, WEAPONS } from '../codes';
import { formatDateTime } from '@/lib/format';
import {
  FIELD_LABEL,
  FIELD_SECTION,
  isExtractableField,
  type Finding,
  type Suggestion,
} from './types';

/**
 * Turns raw findings into reviewable suggestions.
 *
 * Three things happen here, and all three are the point:
 *
 *  1. **Grounding.** A finding whose quote does not appear in the narrative is
 *     discarded. For the pattern extractor this is a tautology; for a
 *     model-backed one it is the guard that stops an invented fact reaching an
 *     evidentiary document.
 *  2. **Field allowlisting.** A finding naming a field outside
 *     `EXTRACTABLE_FIELDS` is discarded, so nothing arriving over the wire can
 *     reach a field nobody chose to expose.
 *  3. **Already-present marking.** A suggestion matching what the report
 *     already says is kept but flagged, so the officer sees the system agreed
 *     with them rather than a list that silently shrinks.
 */
export function toSuggestions(
  findings: Finding[],
  incident: Incident,
  people: PersonIndex,
  origin: Suggestion['origin'],
): Suggestion[] {
  const narrative = incident.narrative ?? '';
  const lower = narrative.toLowerCase();
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    if (!isExtractableField(finding.field)) continue;

    const quote = (finding.quote ?? '').trim();
    if (!quote) continue;
    const start = lower.indexOf(quote.toLowerCase());
    // Not in the narrative: the extractor is reporting something the officer
    // did not write.
    if (start < 0) continue;

    const value = String(finding.value ?? '').trim();
    if (!value) continue;

    // One suggestion per field-and-value. Two mentions of the same plate is
    // one thing to accept, not two.
    const key = `${finding.field}:${value}:${finding.targetId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...finding,
      value,
      quote,
      id: `sug_${origin}_${out.length}_${key.replace(/[^a-z0-9]/gi, '')}`.slice(0, 80),
      origin,
      span: { start, end: start + quote.length },
      section: FIELD_SECTION[finding.field],
      label: FIELD_LABEL[finding.field],
      display: describe(finding.field, value, people),
      alreadyPresent: isPresent(finding, value, incident),
    });
  }

  // Highest confidence first; within that, the order the narrative mentions
  // them, so working down the list reads like re-reading the report.
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort(
    (a, b) =>
      Number(a.alreadyPresent) - Number(b.alreadyPresent) ||
      rank[a.confidence] - rank[b.confidence] ||
      (a.span?.start ?? 0) - (b.span?.start ?? 0),
  );
}

/** The value as a person reads it, not as the file stores it. */
function describe(field: string, value: string, people: PersonIndex): string {
  switch (field) {
    case 'occurredFrom':
    case 'occurredTo':
      return formatDateTime(value);
    case 'offense.methodOfEntry':
      return value === 'F' ? 'Force used' : 'No force used';
    case 'offense.weapon':
      return labelOf(WEAPONS, value);
    case 'person.add': {
      const master = people[value];
      return master ? displayName(master) : 'A person in the name index';
    }
    case 'property.value':
      return `$${Number(value).toLocaleString()}`;
    case 'incident.isDomestic':
    case 'incident.involvesJuvenile':
      return 'Yes';
    default:
      return value;
  }
}

/** True when accepting this would change nothing. */
function isPresent(finding: Finding, value: string, incident: Incident): boolean {
  switch (finding.field) {
    case 'occurredFrom':
      return incident.occurredFrom === value;
    case 'occurredTo':
      return incident.occurredTo === value;
    case 'offense.methodOfEntry':
      return incident.offenses.some((o) => o.id === finding.targetId && o.methodOfEntry === value);
    case 'offense.premisesEntered':
      return incident.offenses.some((o) => o.id === finding.targetId && o.premisesEntered === value);
    case 'offense.weapon':
      return incident.offenses.some((o) => o.weapons.includes(value));
    case 'person.add':
      return incident.persons.some((p) => p.masterId === value);
    case 'person.phone':
      return false; // Whose phone it is, is the officer's call.
    case 'property.value':
      return incident.property.some((p) => p.value === value);
    case 'vehicle.plate':
      return incident.vehicles.some((v) => v.plate.toUpperCase() === value.toUpperCase());
    case 'vehicle.vin':
      return incident.vehicles.some((v) => v.vin.toUpperCase() === value.toUpperCase());
    case 'vehicle.towedTo':
      return incident.vehicles.some((v) => v.towedTo === value);
    case 'incident.isDomestic':
      return incident.isDomestic;
    case 'incident.involvesJuvenile':
      return incident.involvesJuvenile;
  }
}

/**
 * Writes one accepted suggestion into a draft.
 *
 * Only ever called from a click. Returns the field path to focus, so accepting
 * takes the officer to what changed — a suggestion applied somewhere they
 * cannot see is indistinguishable from the silent autofill this whole module
 * exists to avoid.
 */
export function applySuggestion(
  draft: Incident,
  people: PersonIndex,
  suggestion: Suggestion,
): string | void {
  const { field, value, targetId } = suggestion;

  switch (field) {
    case 'occurredFrom':
      draft.occurredFrom = value;
      return 'incident.occurredFrom';

    case 'occurredTo':
      draft.occurredTo = value;
      draft.occurredIsRange = true;
      return 'incident.occurredTo';

    case 'offense.methodOfEntry': {
      const offense = draft.offenses.find((o) => o.id === targetId) ?? draft.offenses[0];
      if (!offense) return;
      offense.methodOfEntry = value;
      return `offense.${offense.id}.methodOfEntry`;
    }

    case 'offense.premisesEntered': {
      const offense = draft.offenses.find((o) => o.id === targetId) ?? draft.offenses[0];
      if (!offense) return;
      offense.premisesEntered = value;
      return `offense.${offense.id}.premisesEntered`;
    }

    case 'offense.weapon': {
      const offense = draft.offenses.find((o) => o.id === targetId) ?? draft.offenses[0];
      if (!offense || offense.weapons.includes(value)) return;
      offense.weapons.push(value);
      return `offense.${offense.id}.weapons`;
    }

    case 'person.add': {
      if (!people[value] || draft.persons.some((p) => p.masterId === value)) return;
      // Role is deliberately left blank-ish: the narrative naming someone says
      // nothing about whether they were the victim or the suspect, and picking
      // one for the officer is exactly the guess this module does not make.
      const link = createIncidentPerson('witness', value);
      draft.persons.push(link);
      return `person.${link.id}.role`;
    }

    case 'person.phone': {
      // Attached to nobody in particular — the officer picks. Taking them to
      // the section is the honest outcome.
      return 'persons';
    }

    case 'property.value': {
      const item = draft.property.find((p) => p.id === targetId) ?? draft.property[0];
      if (item) {
        item.value = value;
        return `property.${item.id}.value`;
      }
      const created = createProperty({ value, lossType: 'stolen' });
      draft.property.push(created);
      return `property.${created.id}.descriptionCode`;
    }

    case 'vehicle.plate':
    case 'vehicle.vin':
    case 'vehicle.towedTo': {
      const key = field.split('.')[1] as 'plate' | 'vin' | 'towedTo';
      const vehicle = draft.vehicles.find((v) => v.id === targetId) ?? draft.vehicles[0];
      if (vehicle) {
        vehicle[key] = value;
        return `vehicle.${vehicle.id}.${key}`;
      }
      const created = createVehicle({ [key]: value });
      draft.vehicles.push(created);
      return `vehicle.${created.id}.${key}`;
    }

    case 'incident.isDomestic':
      draft.isDomestic = true;
      return 'incident.isDomestic';

    case 'incident.involvesJuvenile':
      draft.involvesJuvenile = true;
      return 'incident.involvesJuvenile';
  }
}
