/**
 * Reading the narrative.
 *
 * The officer types the story anyway, and nearly every structured field is
 * already in it — the time, the plate, the value of the laptop, whether the
 * door was forced. Re-typing that into boxes is most of what makes these
 * systems feel like punishment.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THE RULE THIS WHOLE MODULE EXISTS TO ENFORCE: nothing here ever writes
 *  a field.
 *
 *  A police report is evidence. A field the officer did not enter, but which
 *  appears over their name and badge number, is a statement they did not make
 *  in a document a prosecutor will rely on and a defence attorney will
 *  cross-examine them about. "The software filled that in" is not an answer
 *  anyone wants to give on a stand.
 *
 *  So: suggestions, each carrying the exact words it came from, accepted one
 *  at a time by a human. The officer remains the author of every field in
 *  their report.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { SectionId } from '../types';

/**
 * The fields a suggestion is allowed to touch.
 *
 * A closed list, and the security boundary of the whole feature. The
 * model-backed extractor returns *data*, not code, and anything naming a field
 * outside this list is dropped before it reaches the report. Nothing that comes
 * back over the wire can reach a field nobody chose to expose.
 */
export const EXTRACTABLE_FIELDS = [
  'occurredFrom',
  'occurredTo',
  'offense.methodOfEntry',
  'offense.premisesEntered',
  'offense.weapon',
  'person.add',
  'person.phone',
  'property.value',
  'vehicle.plate',
  'vehicle.vin',
  'vehicle.towedTo',
  'incident.isDomestic',
  'incident.involvesJuvenile',
] as const;

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

export function isExtractableField(value: string): value is ExtractableField {
  return (EXTRACTABLE_FIELDS as readonly string[]).includes(value);
}

/**
 * How much weight to give it.
 *
 * A VIN either matches the checksum shape or it does not; whether "the male"
 * in paragraph three is the same person as the arrestee is a judgement. The
 * two should not look alike on screen.
 */
export type Confidence = 'high' | 'medium' | 'low';

/** What an extractor proposes, before it becomes a suggestion. */
export interface Finding {
  field: ExtractableField;
  /** The value to put in the field, already in the form the field wants. */
  value: string;
  /**
   * The words in the narrative this came from, verbatim.
   *
   * Load-bearing, not decoration. A quote that does not appear in the
   * narrative means the extractor produced something the narrative does not
   * say, and the suggestion is dropped rather than shown. For a model-backed
   * extractor that is the hallucination guard: an invented fact cannot be
   * grounded in text that is not there.
   */
  quote: string;
  confidence: Confidence;
  /** Which offense, person, property item or vehicle this attaches to. */
  targetId?: string;
  /** Free text shown under the suggestion. */
  reason?: string;
}

export interface Suggestion extends Finding {
  id: string;
  origin: 'pattern' | 'model';
  /** Where in the narrative the quote sits, for highlighting. */
  span: { start: number; end: number } | null;
  section: SectionId;
  /** Short human label for the field. */
  label: string;
  /** The value as a person would read it. */
  display: string;
  /** True when the report already says this, so accepting would change nothing. */
  alreadyPresent: boolean;
}

export const FIELD_LABEL: Record<ExtractableField, string> = {
  occurredFrom: 'Time the incident began',
  occurredTo: 'Time the incident ended',
  'offense.methodOfEntry': 'Method of entry',
  'offense.premisesEntered': 'Premises entered',
  'offense.weapon': 'Weapon',
  'person.add': 'Person named in the narrative',
  'person.phone': 'Phone number',
  'property.value': 'Property value',
  'vehicle.plate': 'Licence plate',
  'vehicle.vin': 'VIN',
  'vehicle.towedTo': 'Towed to',
  'incident.isDomestic': 'Domestic violence',
  'incident.involvesJuvenile': 'Involves a juvenile',
};

export const FIELD_SECTION: Record<ExtractableField, SectionId> = {
  occurredFrom: 'incident',
  occurredTo: 'incident',
  'offense.methodOfEntry': 'offenses',
  'offense.premisesEntered': 'offenses',
  'offense.weapon': 'offenses',
  'person.add': 'persons',
  'person.phone': 'persons',
  'property.value': 'property',
  'vehicle.plate': 'vehicles',
  'vehicle.vin': 'vehicles',
  'vehicle.towedTo': 'vehicles',
  'incident.isDomestic': 'incident',
  'incident.involvesJuvenile': 'incident',
};
