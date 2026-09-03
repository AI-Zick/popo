import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildExport, exportFilename } from '..';
import { NATIONAL, NEW_HAMPSHIRE, SOUTH_CAROLINA } from '../states';
import type { SegmentLayout, StateProfile } from '../spec';
import {
  AGENCY,
  AT,
  ERRORS_BY_INCIDENT,
  INCIDENTS,
  LOCATIONS,
  PEOPLE,
  STATE_ISSUES_BY_INCIDENT,
} from './corpus';

/**
 * The export, pinned byte for byte.
 *
 * A NIBRS file is fixed-width. A field that moves by one column shifts every
 * field after it, and the state's loader either rejects the file or — much
 * worse — accepts it and reads the wrong columns, at which point the agency's
 * published figures are wrong and nothing says so.
 *
 * Assertions on a few values cannot catch that. Whole-file comparison can, so
 * the committed files under `golden/` are the specification of current
 * behaviour and this compares against them.
 *
 * **When one of these fails**, that is the point: either the change was
 * unintended, in which case fix it, or it was deliberate, in which case run
 * with `UPDATE_GOLDEN=1` and read the diff before committing it. Do not
 * regenerate without reading — the whole value here is that somebody looks.
 */
const PROFILES: [string, StateProfile][] = [
  ['NATIONAL', NATIONAL],
  ['SC', SOUTH_CAROLINA],
  ['NH', NEW_HAMPSHIRE],
];

const width = (layout: SegmentLayout<string>) =>
  layout.reduce((total, field) => total + field.width, 0);

function render(name: string, profile: StateProfile): string {
  const result = buildExport({
    incidents: INCIDENTS,
    agency: AGENCY,
    people: PEOPLE,
    locations: LOCATIONS,
    errorsByIncident: ERRORS_BY_INCIDENT,
    stateIssuesByIncident: STATE_ISSUES_BY_INCIDENT,
    profile,
    at: AT,
  });

  return [
    `profile: ${name} (code ${JSON.stringify(profile.code)})  transport: ${profile.transport}`,
    `filename: ${exportFilename(AGENCY, AT, profile)}`,
    `segments: ${result.segmentCount}`,
    `included: ${result.included.join(', ')}`,
    'excluded:',
    ...result.excluded.map((e) => `  ${e.caseNumber} — ${e.reason}`),
    '',
    '--- content ---',
    result.content,
  ].join('\n');
}

describe('the submission file, byte for byte', () => {
  for (const [name, profile] of PROFILES) {
    it(`matches the committed ${name} file`, () => {
      const path = new URL(`./golden/${name}.txt`, import.meta.url);
      const actual = render(name, profile);

      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path, actual);
        return;
      }
      expect(actual).toBe(readFileSync(path, 'utf8'));
    });
  }

  it('lines up every column, on every fixed-width line', () => {
    /*
      The failure a whole-file comparison cannot describe. If two golden files
      are both regenerated after a mistake they agree with each other and with
      nothing else — but a fixed-width layout has one true width, and every
      line of a segment must be exactly it.
    */
    for (const [name, profile] of PROFILES) {
      if (profile.transport !== 'fixed-width') continue;
      const body = render(name, profile).split('--- content ---\n')[1] ?? '';
      const lines = body.split('\n').filter(Boolean);

      // The header, when the state uses one, is the first line and its own width.
      if (profile.header) {
        expect(lines[0].length, `${name} header: ${JSON.stringify(lines[0])}`).toBe(
          width(profile.header),
        );
        lines.shift();
      }

      const bySegment: Record<string, SegmentLayout<string>> = {
        '1': profile.segments.administrative,
        '2': profile.segments.offense,
        '3': profile.segments.property,
        '4': profile.segments.victim,
        '5': profile.segments.offender,
        '6': profile.segments.arrestee,
      };
      for (const line of lines) {
        const layout = bySegment[line[0]];
        expect(layout, `${name}: no layout for segment level ${line[0]}`).toBeDefined();
        expect(line.length, `${name} segment ${line[0]}: ${JSON.stringify(line)}`).toBe(
          width(layout),
        );
      }
    }
  });
});
