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
import {
  administrativeValues,
  arresteeValues,
  offenderValues,
  offenseValues,
  propertyValues,
  victimValues,
} from './extract';

/** Which part of the report a segment's fields are edited in. */
const SEGMENT_SECTION: Record<string, SectionId> = {
  administrative: 'incident',
  offense: 'offenses',
  property: 'property',
  victim: 'persons',
  offender: 'persons',
  arrestee: 'persons',
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

    report('administrative', missing(profile.segments.administrative, administrativeValues(incident, agency, location ?? undefined)));

    offenseValues(incident, agency).forEach((values, i) => {
      report('offense', missing(profile.segments.offense, values), `Offense ${i + 1}`);
    });

    propertyValues(incident, agency).forEach((values, i) => {
      report('property', missing(profile.segments.property, values), `Property ${i + 1}`);
    });

    victimValues(incident, agency, persons).forEach((values, i) => {
      report('victim', missing(profile.segments.victim, values), `Victim ${i + 1}`);
    });

    offenderValues(incident, agency, persons).forEach((values, i) => {
      report('offender', missing(profile.segments.offender, values), `Offender ${i + 1}`);
    });

    arresteeValues(incident, agency, persons).forEach((values, i) => {
      report('arrestee', missing(profile.segments.arrestee, values), `Arrestee ${i + 1}`);
    });

    return issues;
  };
}

/** Everything a state pack contributes to validation. */
export function stateRules(profile: StateProfile): Rule[] {
  return [requiredFieldRules(profile), ...profile.rules];
}
