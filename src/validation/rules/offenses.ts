import { blank, path, type Issue, type Rule } from '../engine';
import { createOffense } from '@/domain/factory';

export const offenseRules: Rule[] = [
  // ---- At least one offense --------------------------------------------
  (ctx) => {
    if (ctx.incident.offenses.length > 0) return [];
    return [
      {
        key: 'offenses.none',
        ruleId: 'offenses.none',
        severity: 'error',
        section: 'offenses',
        path: path.section('offenses'),
        title: 'The report has no offense',
        message: 'At least one offense has to be listed before this report can be submitted.',
        tip: 'If nothing criminal occurred and you are only documenting the contact, use "90Z — All Other Offenses" or convert this to an information-only report.',
        quickFix: {
          label: 'Add an offense',
          apply: (draft) => {
            const offense = createOffense({ locationType: draft.locationType });
            draft.offenses.push(offense);
            return path.offense(offense.id, 'code');
          },
        },
      },
    ];
  },

  // ---- Per-offense field requirements -----------------------------------
  (ctx) => {
    const issues: Issue[] = [];

    for (const { offense, def, index } of ctx.offenses) {
      const scope = ctx.offenseLabel(offense, index);
      const at = (field: Parameters<typeof path.offense>[1]) => path.offense(offense.id, field);

      if (blank(offense.code)) {
        issues.push({
          key: `offense.${offense.id}.code`,
          ruleId: 'offense.code',
          severity: 'error',
          section: 'offenses',
          path: at('code'),
          scope,
          title: 'Offense type is required',
          message: 'This offense has no offense code selected.',
          tip: 'Search the picker by name — typing "burg", "theft" or "assault" is faster than remembering the numeric code. The code you pick determines which other fields this report will require.',
        });
        // Nothing else on this offense can be judged without a code.
        continue;
      }

      if (blank(offense.statute)) {
        issues.push({
          key: `offense.${offense.id}.statute`,
          ruleId: 'offense.statute',
          severity: 'warning',
          section: 'offenses',
          path: at('statute'),
          scope,
          title: 'Local statute cite is missing',
          message: 'The NIBRS code is set but there is no state or local statute number.',
          tip: 'Prosecutors charge off the statute, not the NIBRS code. Add the cite you would put on the charging document.',
        });
      }

      if (blank(offense.locationType)) {
        issues.push({
          key: `offense.${offense.id}.locationType`,
          ruleId: 'offense.locationType',
          severity: 'error',
          section: 'offenses',
          path: at('locationType'),
          scope,
          title: 'Offense location type is required',
          message: 'Each offense carries its own location code.',
          tip: 'Usually the same as the incident location. If this offense happened somewhere else — a theft at a store followed by an assault in the parking lot — code each one where it actually occurred.',
          quickFix: ctx.incident.locationType
            ? {
                label: 'Use the incident location type',
                apply: (draft) => {
                  const target = draft.offenses.find((o) => o.id === offense.id);
                  if (target) target.locationType = draft.locationType;
                },
              }
            : undefined,
        });
      }

      if (def?.completedOnly && offense.attemptCompleted === 'A') {
        issues.push({
          key: `offense.${offense.id}.attempted`,
          ruleId: 'offense.attempted',
          severity: 'error',
          section: 'offenses',
          path: at('attemptCompleted'),
          scope,
          title: `${def.label} cannot be reported as attempted`,
          message: 'This offense only exists in its completed form.',
          tip: 'An attempted homicide is reported as Aggravated Assault (13A), not as an attempted murder. Change the offense code, or mark this one Completed.',
        });
      }

      // Burglary-specific segments
      if (def?.isBurglary) {
        if (blank(offense.methodOfEntry)) {
          issues.push({
            key: `offense.${offense.id}.methodOfEntry`,
            ruleId: 'offense.methodOfEntry',
            severity: 'error',
            section: 'offenses',
            path: at('methodOfEntry'),
            scope,
            title: 'Method of entry is required for burglary',
            message: 'Burglary reports must record whether force was used to get in.',
            tip: 'Force covers anything from a pried door to a broken window or a punched lock. An unlocked door, an open garage, or entry with a stolen key is No Force.',
          });
        }
        if (blank(offense.premisesEntered)) {
          issues.push({
            key: `offense.${offense.id}.premisesEntered`,
            ruleId: 'offense.premisesEntered',
            severity: 'warning',
            section: 'offenses',
            path: at('premisesEntered'),
            scope,
            title: 'Number of premises entered is missing',
            message: 'Burglary at a hotel, storage facility or apartment building needs a count of units entered.',
            tip: 'Enter 1 for a single house or unit. Only larger counts matter — a storage facility where eight units were hit is one report with 8 here, not eight reports.',
            quickFix: {
              label: 'Set to 1',
              apply: (draft) => {
                const target = draft.offenses.find((o) => o.id === offense.id);
                if (target) target.premisesEntered = '1';
              },
            },
          });
        }
      }

      // Weapon requirements
      if (def?.requiresWeapon && offense.weapons.length === 0) {
        issues.push({
          key: `offense.${offense.id}.weapons`,
          ruleId: 'offense.weapons',
          severity: 'error',
          section: 'offenses',
          path: at('weapons'),
          scope,
          title: `Weapon or force is required for ${def.label}`,
          message: 'This offense type always records how the offender was armed.',
          tip: 'If no weapon was involved, pick "Personal Weapons (hands, feet)" — that is the correct entry for a beating, a shove or a strangling, and is not the same as leaving this blank.',
        });
      }

      // Criminal activity (drug/weapon/gambling)
      if (def?.requiresCriminalActivity && offense.criminalActivity.length === 0) {
        issues.push({
          key: `offense.${offense.id}.criminalActivity`,
          ruleId: 'offense.criminalActivity',
          severity: 'error',
          section: 'offenses',
          path: at('criminalActivity'),
          scope,
          title: 'Criminal activity type is required',
          message: `${def.label} needs at least one criminal activity type.`,
          tip: 'This is what the offender was doing with the contraband — Possessing/Concealing for simple possession, Distributing/Selling for a sale, Cultivating/Manufacturing for a grow or a lab. You can pick more than one.',
        });
      }

      if (blank(offense.biasMotivation)) {
        issues.push({
          key: `offense.${offense.id}.bias`,
          ruleId: 'offense.bias',
          severity: 'error',
          section: 'offenses',
          path: at('biasMotivation'),
          scope,
          title: 'Bias motivation is required',
          message: 'Every offense needs a bias motivation, even when there was none.',
          tip: 'Pick "None (no bias)" for the overwhelming majority of reports. Only select a bias code when there is evidence the offender chose the victim because of that characteristic — not merely that a slur was used.',
          quickFix: {
            label: 'Set to “None”',
            apply: (draft) => {
              const target = draft.offenses.find((o) => o.id === offense.id);
              if (target) target.biasMotivation = '88';
            },
          },
        });
      }
    }

    return issues;
  },

  // ---- Duplicate offenses ------------------------------------------------
  (ctx) => {
    const seen = new Map<string, number>();
    const issues: Issue[] = [];
    for (const { offense, index } of ctx.offenses) {
      if (!offense.code) continue;
      const prior = seen.get(offense.code);
      if (prior !== undefined) {
        issues.push({
          key: `offense.${offense.id}.duplicate`,
          ruleId: 'offense.duplicate',
          severity: 'warning',
          section: 'offenses',
          path: path.offense(offense.id, 'code'),
          scope: ctx.offenseLabel(offense, index),
          title: 'Same offense listed twice',
          message: `This matches offense ${prior + 1} on the report.`,
          tip: 'One offense record covers every count of that offense in the incident — three stolen laptops from one break-in is a single larceny with three property records, not three larcenies. Remove the duplicate unless these are genuinely separate events with different victims.',
        });
      } else {
        seen.set(offense.code, index);
      }
    }
    return issues;
  },
];
