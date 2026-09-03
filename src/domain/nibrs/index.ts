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
import type { SegmentLayout, SegmentName, StateProfile } from './spec';
import { profileFor } from './states';
import { renderSegment } from './format';
import { renderElement, xmlDocument } from './xml';
import { SEGMENT_KINDS, headerValues } from './extract';

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

/**
 * A segment ready to render: its layout, and the values to put in it.
 *
 * Both widened to plain strings. The pairing is correct by construction — each
 * bag comes from the extractor for that very segment — but TypeScript cannot
 * see the correlation across a union of six differently-keyed layouts, and
 * saying so once here reads better than scattering casts at the call site.
 */
interface RenderableSegment {
  name: Exclude<SegmentName, 'header'>;
  layout: SegmentLayout<string>;
  values: Record<string, string | undefined>;
}

/** One incident's worth of segments, in file order. */
function segmentsFor(
  incident: Incident,
  input: ExportInput,
  profile: StateProfile,
): RenderableSegment[] {
  const of = {
    incident,
    agency: input.agency,
    persons: resolvePeople(incident.persons, input.people),
    location: input.locations[incident.locationId],
  };

  return SEGMENT_KINDS.flatMap((kind) =>
    kind.values(of).map((values) => ({
      name: kind.name,
      layout: profile.segments[kind.name] as SegmentLayout<string>,
      values,
    })),
  );
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

    for (const { name, layout, values } of segmentsFor(incident, input, profile)) {
      bodies.push(
        profile.transport === 'xml'
          ? renderElement(name, layout, values)
          : renderSegment(layout, values),
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
