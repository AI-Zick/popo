/**
 * New Hampshire — NHIBRS.
 *
 * New Hampshire's program is run by the Department of Safety / State Police,
 * which collects from agencies statewide and forwards to the FBI.
 *
 * This profile exists to prove a specific point about the architecture: the
 * transport is a renderer, not a fork. New Hampshire takes XML here and South
 * Carolina takes fixed width, and the two packs share every line of extraction,
 * every validation rule, and the whole rest of the system. The only thing that
 * differs is a field in a config object.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  UNVERIFIED, and in two distinct ways.
 *
 *  1. The layouts below carry element names and ordering, not column
 *     positions — but they have not been checked against NH's published
 *     specification.
 *
 *  2. Real NIBRS XML is a NIEM IEPD: namespaced (`nc:`, `j:`, `cjis:`),
 *     deeply nested, with structural references between elements rather than
 *     the flat sequence-number links the fixed-width format uses. The
 *     renderer in `../xml.ts` emits flat, readable XML derived from the same
 *     layouts. That is the right *shape* for this architecture and is NOT a
 *     valid IEPD instance document.
 *
 *  Finishing this profile means mapping these field names onto IEPD element
 *  paths. That is a real piece of work and it lands in `xml.ts` plus this
 *  file — not across the application.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { SegmentLayout, StateProfile, VictimField } from '../spec';
import { ADMINISTRATIVE, ARRESTEE, OFFENDER, OFFENSE, PROPERTY, VICTIM } from './national';

/**
 * Widths are documentation in an XML profile — nothing is padded to a column.
 * They are kept so that one layout can serve both transports, and so a state
 * that later switches from XML to fixed width is a one-word change.
 */
const VICTIM_NH: SegmentLayout<VictimField> = [
  ...VICTIM,
  // Resident status is collected by a number of state programs and is not in
  // the national record. Adding it is a line, because extraction already
  // produces the value.
  { field: 'residentStatus', width: 1 },
];

export const NEW_HAMPSHIRE: StateProfile = {
  code: 'NH',
  name: 'New Hampshire',
  program: 'NHIBRS — New Hampshire Department of Safety, Division of State Police',
  transport: 'xml',
  fileExtension: 'xml',
  verified: false,
  specReference: 'NH Department of Safety — NHIBRS submission specification / FBI NIBRS XML IEPD',
  specVersion: '',
  segments: {
    administrative: ADMINISTRATIVE,
    offense: OFFENSE,
    property: PROPERTY,
    victim: VICTIM_NH,
    offender: OFFENDER,
    arrestee: ARRESTEE,
  },
  rules: [],
};
