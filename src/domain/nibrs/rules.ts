/**
 * Validation generated from the layouts.
 *
 * A state's required fields are already written down — in the `required` flags
 * on its segment layouts. Writing them a second time as hand-maintained rules
 * would guarantee the two drift, and the direction they drift in is the bad
 * one: the file gets a column the officer was never asked to fill.
 *
 * So the rules are derived. Marking a field `required: true` in a state pack is
 * the entire act of adding the check, and the officer finds out while the
 * report is open rather than the records clerk finding out from a rejection
 * report six weeks later.
 */

import type { Rule, Issue } from '@/validation/engine';
import type { SectionId } from '../types';
import type { SegmentLayout, StateProfile } from './spec';
import { SEGMENT_KINDS } from './extract';

/** Which part of the report a segment's fields are edited in. */
const SEGMENT_SECTION: Record<string, SectionId> = {
  administrative: 'incident',
  offense: 'offenses',
  property: 'property',
  victim: 'persons',
  offender: 'persons',
  arrestee: 'persons',
};

/**
 * How a repeated segment is named in an issue: "Offense 2", "Victim 1".
 *
 * Absent for the administrative segment, which occurs exactly once, so its
 * issues are scoped to the state's name instead of "Administrative 1".
 */
const SEGMENT_LABEL: Record<string, string> = {
  offense: 'Offense',
  property: 'Property',
  victim: 'Victim',
  offender: 'Offender',
  arrestee: 'Arrestee',
};

function missing<K extends string>(
  layout: SegmentLayout<K>,
  values: Partial<Record<K, string>>,
): { field: K; label: string }[] {
  return layout
    .filter((spec) => spec.required && !String(values[spec.field] ?? '').trim())
    .map((spec) => ({ field: spec.field, label: spec.label ?? spec.field }));
}

/**
 * Builds the state's required-field rule.
 *
 * Severity is `warning`, not `error`. The state's requirement is real, but it
 * is the *state's*, and a national NIBRS report that is complete by federal
 * standards should not be blocked from being written because South Carolina
 * wants a statute cite. It is blocked from being *exported* — `buildExport`
 * holds back anything with unresolved problems — which is the right place for
 * it. An officer can still finish and file the report.
 */
export function requiredFieldRules(profile: StateProfile): Rule {
  return (ctx): Issue[] => {
    const issues: Issue[] = [];
    const { incident, agency, persons, location } = ctx;
    if (!agency) return issues;

    const report = (
      segment: keyof StateProfile['segments'],
      gaps: { field: string; label: string }[],
      scope?: string,
    ) => {
      for (const gap of gaps) {
        const section = SEGMENT_SECTION[segment] ?? 'incident';
        issues.push({
          key: `nibrs.${profile.code}.${segment}.${scope ?? ''}.${gap.field}`,
          ruleId: `nibrs.${profile.code}.required`,
          severity: 'warning',
          section,
          path: section,
          scope: scope ?? profile.name,
          title: `${profile.name} needs the ${gap.label}`,
          message: `The ${segment} record in ${profile.program.split(' — ')[0]} requires the ${gap.label}, and it is blank.`,
          tip: `The report can be filed without it, but it will be held back from the ${profile.name} submission until it is filled in.`,
        });
      }
    };

    /*
      The same list the exporter renders from. Checking anything else would
      let a segment be written to the file that nothing ever validated.
    */
    const of = { incident, agency, persons, location: location ?? undefined };
    for (const kind of SEGMENT_KINDS) {
      const layout = profile.segments[kind.name] as SegmentLayout<string>;
      const label = SEGMENT_LABEL[kind.name];
      kind.values(of).forEach((values, i) => {
        report(kind.name, missing(layout, values), label ? `${label} ${i + 1}` : undefined);
      });
    }

    return issues;
  };
}

/** Everything a state pack contributes to validation. */
export function stateRules(profile: StateProfile): Rule[] {
  return [requiredFieldRules(profile), ...profile.rules];
}
