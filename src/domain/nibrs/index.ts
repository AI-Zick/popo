/**
 * NIBRS submission.
 *
 * Three parts, deliberately separate:
 *
 *   extract.ts   incident → named values.  National. Never varies by state.
 *   states/      which values, in what order, how wide.  Data, per state.
 *   format.ts    layout + values → a line.  Shared by every state.
 *   xml.ts       layout + values → an element.  The other transport.
 *
 * The alternative — a branch or a codebase per state — means every bug fix is
 * fifty cherry-picks and a security patch is a fifty-agency coordination
 * problem. What actually differs between states is a table of numbers, so it
 * is stored as a table of numbers.
 *
 * Everything here is a pure function so the same code runs in the browser for a
 * preview and on the server for the real file.
 */

import type { Incident } from '../types';
import type { AgencyProfile } from '../agency';
import type { MasterLocation } from '../location';
import type { PersonIndex } from '../person';
import { resolvePeople } from '../person';
import type { StateProfile } from './spec';
import { profileFor } from './states';
import { renderSegment } from './format';
import { renderElement, xmlDocument } from './xml';
import {
  administrativeValues,
  arresteeValues,
  headerValues,
  offenderValues,
  offenseValues,
  propertyValues,
  victimValues,
} from './extract';

export * from './spec';
export * from './format';
export * from './extract';
export * from './rules';
export * from './states';
export { escapeXml, renderElement, xmlDocument, xmlValue } from './xml';

export interface ExportResult {
  /** The file contents. */
  content: string;
  /** The profile that produced it. */
  profile: StateProfile;
  /** Incidents written. */
  included: string[];
  /** Incidents held back, with the reason. */
  excluded: { caseNumber: string; reason: string }[];
  segmentCount: number;
}

export interface ExportInput {
  incidents: Incident[];
  agency: AgencyProfile;
  people: PersonIndex;
  locations: Record<string, MasterLocation>;
  /** Blocking validation problems, keyed by incident id. */
  errorsByIncident: Record<string, number>;
  /**
   * State problems, keyed by incident id — the warnings the state's own
   * required-field rules raised. These do not block the report, but they do
   * hold it out of the submission.
   */
  stateIssuesByIncident?: Record<string, number>;
  /** Overrides the profile the agency's state would select. */
  profile?: StateProfile;
  at?: Date;
}

/** One incident's worth of segments, as ordered value bags. */
function segmentsFor(
  incident: Incident,
  input: ExportInput,
): { segment: keyof StateProfile['segments']; values: Record<string, string | undefined> }[] {
  const persons = resolvePeople(incident.persons, input.people);
  const location = input.locations[incident.locationId];
  const { agency } = input;

  return [
    { segment: 'administrative' as const, values: administrativeValues(incident, agency, location) },
    ...offenseValues(incident, agency).map((values) => ({ segment: 'offense' as const, values })),
    ...propertyValues(incident, agency).map((values) => ({ segment: 'property' as const, values })),
    ...victimValues(incident, agency, persons).map((values) => ({ segment: 'victim' as const, values })),
    ...offenderValues(incident, agency, persons).map((values) => ({ segment: 'offender' as const, values })),
    ...arresteeValues(incident, agency, persons).map((values) => ({ segment: 'arrestee' as const, values })),
  ];
}

/** Why an incident is not in the file, or null when it is. */
function heldBackReason(incident: Incident, input: ExportInput): string | null {
  if (incident.status !== 'approved') {
    return incident.status === 'pending_review'
      ? 'Still waiting on a supervisor'
      : incident.status === 'returned'
        ? 'Sent back for correction'
        : 'Still a draft';
  }
  if (!input.agency.ori) return 'The agency has no ORI set';

  const errors = input.errorsByIncident[incident.id] ?? 0;
  if (errors > 0) {
    return `${errors} unresolved validation ${errors === 1 ? 'problem' : 'problems'}`;
  }

  const stateIssues = input.stateIssuesByIncident?.[incident.id] ?? 0;
  if (stateIssues > 0) {
    return `${stateIssues} state ${stateIssues === 1 ? 'requirement' : 'requirements'} not met`;
  }
  return null;
}

/**
 * Builds the submission.
 *
 * Only approved reports go in. A draft is by definition unfinished, and a
 * report still in review has not been checked by anyone — submitting either to
 * the state would mean the agency's published crime figures include work
 * nobody has signed off.
 */
export function buildExport(input: ExportInput): ExportResult {
  const profile = input.profile ?? profileFor(input.agency.state);
  const at = input.at ?? new Date();

  const included: string[] = [];
  const excluded: { caseNumber: string; reason: string }[] = [];
  const bodies: string[] = [];
  let segmentCount = 0;

  for (const incident of input.incidents) {
    const reason = heldBackReason(incident, input);
    if (reason) {
      excluded.push({ caseNumber: incident.caseNumber, reason });
      continue;
    }

    for (const { segment, values } of segmentsFor(incident, input)) {
      const layout = profile.segments[segment];
      bodies.push(
        profile.transport === 'xml'
          ? renderElement(segment, layout as never, values as never)
          : renderSegment(layout as never, values as never),
      );
      segmentCount += 1;
    }
    included.push(incident.caseNumber);
  }

  let content = '';
  if (segmentCount > 0) {
    if (profile.transport === 'xml') {
      content = xmlDocument(bodies.join('\n'), {
        ori: input.agency.ori,
        state: profile.code,
        program: profile.program.split(' — ')[0],
        generated: at.toISOString(),
      });
    } else {
      const lines = [...bodies];
      // The header knows the counts, so it can only be written once they exist.
      if (profile.header) {
        lines.unshift(
          renderSegment(
            profile.header,
            headerValues(input.agency, { incidents: included.length, segments: segmentCount }, at),
          ),
        );
      }
      content = lines.join('\n') + '\n';
    }
  }

  return { content, profile, included, excluded, segmentCount };
}

/** `AL0010200_20260902.txt` — ORI and date, which is what states expect. */
export function exportFilename(
  agency: AgencyProfile,
  at = new Date(),
  profile: StateProfile = profileFor(agency.state),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${agency.ori || 'NOORI'}_${stamp}.${profile.fileExtension}`;
}
