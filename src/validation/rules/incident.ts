import { blank, path, type Issue, type Rule } from '../engine';
import { parseLocal } from '@/lib/format';
import { createPerson } from '@/domain/factory';
import { DOMESTIC_RELATIONSHIPS } from '@/domain/codes';

const required = (
  ruleId: string,
  field: Parameters<typeof path.incident>[0],
  title: string,
  message: string,
  tip: string,
): Rule => (ctx) => {
  const value = ctx.incident[field];
  if (!blank(typeof value === 'string' ? value : String(value ?? ''))) return [];
  return [
    {
      key: `${ruleId}`,
      ruleId,
      severity: 'error',
      section: 'incident',
      path: path.incident(field),
      title,
      message,
      tip,
    },
  ];
};

export const incidentRules: Rule[] = [
  required(
    'incident.reportedAt',
    'reportedAt',
    'Date/time reported is required',
    'Every report needs the moment the agency was notified.',
    'This is when dispatch received the call — not when you arrived, and not when the crime happened. If you are writing this up after the fact, use the CAD time from the call sheet.',
  ),
  required(
    'incident.occurredFrom',
    'occurredFrom',
    'Date/time occurred is required',
    'The report has no occurrence date.',
    'If the victim can only narrow it to a window ("sometime overnight"), turn on “Occurred over a date range” and enter the earliest and latest possible times instead of guessing a single one.',
  ),
  required(
    'incident.address',
    'address',
    'Incident address is required',
    'The location of the incident is blank.',
    'Use the street address where the offense happened, not the address where you took the report. For a highway stop, use the nearest block or mile marker.',
  ),
  required('incident.city', 'city', 'City is required', 'The incident city is blank.', 'Enter the municipality the address falls in, even if the property sits outside city limits.'),
  required('incident.locationType', 'locationType', 'Location type is required', 'The state submission needs a coded location type.', 'Pick the option that best describes the premises — "Residence / Home" for a house or apartment, "Highway / Road / Alley / Street" for anything on a roadway.'),
  required('incident.reportingOfficer', 'reportingOfficer', 'Reporting officer is required', 'No reporting officer is on this report.', 'Enter the officer who is authoring the report. If another unit took the initial call, list them as a supplement instead.'),

  // ---- Date sanity ------------------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    const { incident } = ctx;
    const reported = parseLocal(incident.reportedAt);
    const from = parseLocal(incident.occurredFrom);
    const to = parseLocal(incident.occurredTo);
    const now = new Date();

    if (reported && reported.getTime() > now.getTime() + 60_000) {
      issues.push({
        key: 'incident.reportedAt.future',
        ruleId: 'incident.reportedAt.future',
        severity: 'error',
        section: 'incident',
        path: path.incident('reportedAt'),
        title: 'Reported date is in the future',
        message: 'The report time is later than right now.',
        tip: 'Almost always a typo in the year or an AM/PM flip. Check the month and year against the call sheet.',
      });
    }

    if (from && reported && from.getTime() > reported.getTime() + 60_000) {
      issues.push({
        key: 'incident.occurredFrom.afterReported',
        ruleId: 'incident.occurredFrom.afterReported',
        severity: 'error',
        section: 'incident',
        path: path.incident('occurredFrom'),
        title: 'Offense occurred after it was reported',
        message: 'The occurrence time is later than the time the call came in, which is not possible.',
        tip: 'Check whether the two dates got swapped. If the offense really is ongoing, set the occurrence start to when it began and use a date range for the end.',
      });
    }

    if (incident.occurredIsRange) {
      if (blank(incident.occurredTo)) {
        issues.push({
          key: 'incident.occurredTo.required',
          ruleId: 'incident.occurredTo.required',
          severity: 'error',
          section: 'incident',
          path: path.incident('occurredTo'),
          title: 'End of occurrence window is required',
          message: 'You marked this as occurring over a range but left the end time blank.',
          tip: 'Use the latest point the offense could have happened — usually when the victim discovered it.',
        });
      } else if (from && to && to.getTime() < from.getTime()) {
        issues.push({
          key: 'incident.occurredTo.beforeFrom',
          ruleId: 'incident.occurredTo.beforeFrom',
          severity: 'error',
          section: 'incident',
          path: path.incident('occurredTo'),
          title: 'Occurrence window ends before it starts',
          message: 'The end of the window is earlier than the start.',
          tip: 'Overnight windows are the usual culprit — an incident from 10pm Tuesday to 6am Wednesday needs Wednesday’s date on the end time.',
        });
      }
    }

    return issues;
  },

  // ---- Clearance --------------------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    const { incident } = ctx;

    if (incident.clearanceStatus === 'cleared_exceptional') {
      if (blank(incident.exceptionalClearanceReason)) {
        issues.push({
          key: 'incident.exceptionalReason',
          ruleId: 'incident.exceptionalReason',
          severity: 'error',
          section: 'incident',
          path: path.incident('exceptionalClearanceReason'),
          title: 'Exceptional clearance needs a reason',
          message: 'A case cleared exceptionally must record why an arrest could not be made.',
          tip: 'All four conditions have to be true to clear exceptionally: you know who did it, you have enough to charge, you know where they are, and something outside your control stops the arrest. If any one of those is not true, this case is still Open.',
        });
      }
      if (blank(incident.clearedAt)) {
        issues.push({
          key: 'incident.clearedAt',
          ruleId: 'incident.clearedAt',
          severity: 'error',
          section: 'incident',
          path: path.incident('clearedAt'),
          title: 'Clearance date is required',
          message: 'An exceptionally cleared case needs the date it was cleared.',
          tip: 'Use the date the clearing condition became true — for example, the day the prosecutor declined.',
        });
      }
    }

    if (incident.clearanceStatus === 'cleared_arrest' && ctx.arrestees.length === 0) {
      issues.push({
        key: 'incident.clearedByArrest.noArrestee',
        ruleId: 'incident.clearedByArrest.noArrestee',
        severity: 'error',
        section: 'incident',
        path: path.incident('clearanceStatus'),
        title: 'Cleared by arrest, but nobody is listed as arrested',
        message: 'This case is marked Cleared by Arrest and no person on the report has the Arrestee role.',
        tip: 'Either add the person you arrested, or — if the suspect was only identified and not taken into custody — change the disposition to Open or Cleared Exceptionally.',
        quickFix: {
          label: 'Add an arrestee',
          apply: (draft) => {
            const person = createPerson('arrestee', {
              arrestDate: draft.reportedAt.slice(0, 10),
            });
            draft.persons.push(person);
            return path.person(person.id, 'lastName');
          },
        },
      });
    }

    if (incident.clearanceStatus === 'unfounded' && incident.narrative.trim().length < 40) {
      issues.push({
        key: 'incident.unfounded.narrative',
        ruleId: 'incident.unfounded.narrative',
        severity: 'error',
        section: 'narrative',
        path: path.incident('narrative'),
        title: 'Unfounded cases need an explanation',
        message: 'The narrative does not explain why this report is unfounded.',
        tip: 'Unfounded means the offense never happened — not that it is unsolved or that the victim stopped cooperating. Write down the facts that establish it was false or baseless, because this removes the offense from the agency’s crime counts.',
      });
    }

    return issues;
  },

  // ---- Flag consistency -------------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    const { incident } = ctx;

    const hasBias = incident.offenses.some(
      (o) => o.biasMotivation && o.biasMotivation !== '88' && o.biasMotivation !== '99',
    );

    if (incident.isHateCrime && !hasBias) {
      issues.push({
        key: 'incident.hate.noBias',
        ruleId: 'incident.hate.noBias',
        severity: 'error',
        section: 'offenses',
        path: incident.offenses[0]
          ? path.offense(incident.offenses[0].id, 'biasMotivation')
          : path.section('offenses'),
        title: 'Hate crime flag set, but no bias motivation on any offense',
        message: 'You flagged this incident as bias-motivated but every offense still shows "None (no bias)".',
        tip: 'Set the bias motivation on the specific offense the bias applies to. The flag alone does not carry into the state submission.',
      });
    }

    if (!incident.isHateCrime && hasBias) {
      issues.push({
        key: 'incident.bias.noFlag',
        ruleId: 'incident.bias.noFlag',
        severity: 'warning',
        section: 'incident',
        path: path.incident('isHateCrime'),
        title: 'Bias motivation recorded but hate crime flag is off',
        message: 'An offense has a bias motivation, which normally means this report should carry the hate crime flag.',
        tip: 'Turn the flag on so the case routes to the bias-crime review queue, or clear the bias motivation on the offense if it was selected by mistake.',
        quickFix: {
          label: 'Turn on the flag',
          apply: (draft) => {
            draft.isHateCrime = true;
          },
        },
      });
    }

    const hasDomesticRelationship = incident.persons.some((p) =>
      p.relationships.some((r) => DOMESTIC_RELATIONSHIPS.has(r.relationship)),
    );

    if (incident.isDomestic && !hasDomesticRelationship && ctx.victims.length > 0) {
      issues.push({
        key: 'incident.domestic.noRelationship',
        ruleId: 'incident.domestic.noRelationship',
        severity: 'warning',
        section: 'persons',
        path: path.section('persons'),
        title: 'Domestic flag set, but no domestic relationship recorded',
        message: 'This is flagged as domestic and no victim shows a family or intimate-partner relationship to an offender.',
        tip: 'Open the victim, scroll to Relationship to Offender, and pick the code that matches — spouse, ex-spouse, boyfriend/girlfriend, parent, child, and so on. Prosecutors rely on this field to charge the domestic enhancement.',
      });
    }

    if (!incident.isDomestic && hasDomesticRelationship) {
      issues.push({
        key: 'incident.domestic.flagOff',
        ruleId: 'incident.domestic.flagOff',
        severity: 'warning',
        section: 'incident',
        path: path.incident('isDomestic'),
        title: 'Domestic relationship recorded but the domestic flag is off',
        message: 'A victim is related to an offender by family or intimate partnership, which normally makes this a domestic incident.',
        tip: 'Turning this on drives the domestic violence supplement and the victim notification requirements in most states.',
        quickFix: {
          label: 'Turn on the flag',
          apply: (draft) => {
            draft.isDomestic = true;
          },
        },
      });
    }

    return issues;
  },
];
