import { blank, path, type Issue, type Rule } from '../engine';
import { createPerson } from '@/domain/factory';
import { ageAt } from '@/lib/format';
import { DOMESTIC_RELATIONSHIPS } from '@/domain/codes';

export const personRules: Rule[] = [
  // ---- Crimes against persons need an individual victim -----------------
  (ctx) => {
    const needsVictim = ctx.offenses.filter((o) => o.def?.requiresIndividualVictim);
    if (needsVictim.length === 0) return [];

    const individualVictims = ctx.victims.filter((v) => v.victimType === 'I');
    if (individualVictims.length > 0) return [];

    const first = needsVictim[0];
    const label = first.def?.label ?? 'This offense';

    if (ctx.victims.length === 0) {
      return [
        {
          key: 'persons.victim.missing',
          ruleId: 'persons.victim.missing',
          severity: 'error',
          section: 'persons',
          path: path.section('persons'),
          title: `${label} requires a victim`,
          message: 'Crimes against a person must name the person harmed, and no victim is listed on this report.',
          tip: 'If the victim refused to identify themselves, add them anyway and check "Identity unknown" — the record still has to exist. A business cannot be the victim of an assault; if the target was a store, the victim is the employee who was assaulted.',
          quickFix: {
            label: 'Add a victim',
            apply: (draft) => {
              const person = createPerson('victim', { victimType: 'I' });
              person.offenseIds = draft.offenses.map((o) => o.id);
              draft.persons.push(person);
              return path.person(person.id, 'lastName');
            },
          },
        },
      ];
    }

    // Victims exist, but none is an individual.
    const wrong = ctx.victims[0];
    return [
      {
        key: 'persons.victim.notIndividual',
        ruleId: 'persons.victim.notIndividual',
        severity: 'error',
        section: 'persons',
        path: path.person(wrong.id, 'victimType'),
        scope: ctx.personLabel(wrong),
        title: `${label} requires an individual victim`,
        message: `The only victims on this report are non-individual types, but a crime against a person needs a natural person as the victim.`,
        tip: 'Change this victim to "Individual", or add the person who was actually harmed alongside the business. A robbery of a store, for example, has the clerk as the individual victim and the business as a second victim for the property loss.',
        quickFix: {
          label: 'Change to Individual',
          apply: (draft) => {
            const target = draft.persons.find((p) => p.id === wrong.id);
            if (target) target.victimType = 'I';
          },
        },
      },
    ];
  },

  // ---- Society-only offenses should not carry individual victims --------
  (ctx) => {
    const societyOnly = ctx.offenses.filter((o) => o.def?.societyVictimOnly);
    if (societyOnly.length === 0) return [];
    // Only complain when EVERY offense is society-only; a mixed report is fine.
    if (societyOnly.length !== ctx.offenses.length) return [];

    return ctx.victims
      .filter((v) => v.victimType === 'I')
      .map<Issue>((v) => ({
        key: `persons.${v.id}.societyVictim`,
        ruleId: 'persons.societyVictim',
        severity: 'warning',
        section: 'persons',
        path: path.person(v.id, 'victimType'),
        scope: ctx.personLabel(v),
        title: 'Victimless offense has an individual victim',
        message: `Every offense on this report is a crime against society, which normally has no individual victim.`,
        tip: 'For a drug arrest or a DUI, the victim is Society/Public. If this person was actually harmed — say the DUI driver struck someone — add the assault or vehicular offense so the victim has an offense to attach to.',
        quickFix: {
          label: 'Change to Society',
          apply: (draft) => {
            const target = draft.persons.find((p) => p.id === v.id);
            if (target) target.victimType = 'S';
          },
        },
      }));
  },

  // ---- Per-person field requirements ------------------------------------
  (ctx) => {
    const issues: Issue[] = [];

    for (const person of ctx.incident.persons) {
      const scope = ctx.personLabel(person);
      const at = (field: Parameters<typeof path.person>[1]) => path.person(person.id, field);
      const isOrg = person.role === 'victim' && person.victimType !== 'I' && person.victimType !== '';

      // Identity
      if (isOrg) {
        if (blank(person.businessName)) {
          issues.push({
            key: `person.${person.id}.businessName`,
            ruleId: 'person.businessName',
            severity: 'error',
            section: 'persons',
            path: at('businessName'),
            scope,
            title: 'Business or organization name is required',
            message: 'A non-individual victim needs the name of the entity.',
            tip: 'Use the legal or operating name of the business — "Riverside Mini Mart", not "the gas station".',
          });
        }
      } else if (!person.isUnknown) {
        if (blank(person.lastName)) {
          issues.push({
            key: `person.${person.id}.lastName`,
            ruleId: 'person.lastName',
            severity: 'error',
            section: 'persons',
            path: at('lastName'),
            scope: scope === 'Unnamed person' ? undefined : scope,
            title: 'Last name is required',
            message: 'This person has no last name recorded.',
            tip: 'If you genuinely could not identify them, check "Identity unknown" instead of leaving the name blank — that tells the records clerk this was a dead end rather than an oversight.',
            quickFix: {
              label: 'Mark identity unknown',
              apply: (draft) => {
                const target = draft.persons.find((p) => p.id === person.id);
                if (target) target.isUnknown = true;
              },
            },
          });
        }
      }

      // Victim demographics
      if (person.role === 'victim' && person.victimType === 'I') {
        if (blank(person.dob) && blank(person.ageFrom)) {
          issues.push({
            key: `person.${person.id}.age`,
            ruleId: 'person.age',
            severity: 'error',
            section: 'persons',
            path: at('dob'),
            scope,
            title: 'Victim age or date of birth is required',
            message: 'Individual victims must have either a date of birth or an estimated age range.',
            tip: 'Exact DOB is best. If you only have a guess, leave DOB blank and fill the estimated age range instead — "25 to 35" is a valid answer and far better than nothing.',
          });
        }
        if (blank(person.sex)) {
          issues.push({
            key: `person.${person.id}.sex`,
            ruleId: 'person.sex',
            severity: 'error',
            section: 'persons',
            path: at('sex'),
            scope,
            title: 'Victim sex is required',
            message: 'Individual victims need a sex code.',
            tip: 'Use "Unknown" only when the victim was never seen or identified.',
          });
        }
        if (blank(person.race)) {
          issues.push({
            key: `person.${person.id}.race`,
            ruleId: 'person.race',
            severity: 'error',
            section: 'persons',
            path: at('race'),
            scope,
            title: 'Victim race is required',
            message: 'Individual victims need a race code.',
            tip: 'Record what the victim reports about themselves when you can ask. "Unknown" is acceptable when the victim was never contacted.',
          });
        }
      }

      // Everyone should be tied to at least one offense
      if (
        ctx.incident.offenses.length > 0 &&
        person.offenseIds.length === 0 &&
        (person.role === 'victim' || person.role === 'suspect' || person.role === 'arrestee')
      ) {
        issues.push({
          key: `person.${person.id}.offenseLink`,
          ruleId: 'person.offenseLink',
          severity: 'error',
          section: 'persons',
          path: at('offenseIds'),
          scope,
          title: 'Not linked to any offense',
          message: 'Victims, suspects and arrestees have to be connected to the offenses they were involved in.',
          tip: 'On a report with more than one offense this is how the system knows who was robbed versus who was assaulted. If they were involved in all of them, use "Select all".',
          quickFix:
            ctx.incident.offenses.length === 1
              ? {
                  label: 'Link to the offense',
                  apply: (draft) => {
                    const target = draft.persons.find((p) => p.id === person.id);
                    if (target) target.offenseIds = draft.offenses.map((o) => o.id);
                  },
                }
              : undefined,
        });
      }

      // Injury detail on violent offenses
      const linkedDefs = ctx.offenses.filter(
        (o) => person.offenseIds.includes(o.offense.id) || person.offenseIds.length === 0,
      );
      const collectsInjury = linkedDefs.some((o) => o.def?.collectsInjury);
      if (person.role === 'victim' && person.victimType === 'I' && collectsInjury && person.injuries.length === 0) {
        issues.push({
          key: `person.${person.id}.injuries`,
          ruleId: 'person.injuries',
          severity: 'error',
          section: 'persons',
          path: at('injuries'),
          scope,
          title: 'Injury type is required',
          message: 'A victim of a violent offense must have an injury recorded.',
          tip: 'If the victim was not hurt, select "None". Leaving it blank reads as an unanswered question and will bounce back from records.',
          quickFix: {
            label: 'Set to “None”',
            apply: (draft) => {
              const target = draft.persons.find((p) => p.id === person.id);
              if (target) target.injuries = ['N'];
            },
          },
        });
      }

      // Homicide victims cannot be uninjured
      const linkedHomicide = linkedDefs.some((o) => o.offense.code === '09A' || o.offense.code === '09B');
      if (person.role === 'victim' && linkedHomicide && person.injuries.includes('N')) {
        issues.push({
          key: `person.${person.id}.homicideInjury`,
          ruleId: 'person.homicideInjury',
          severity: 'error',
          section: 'persons',
          path: at('injuries'),
          scope,
          title: 'Homicide victim is marked as uninjured',
          message: 'This victim is linked to a homicide offense but the injury type says "None".',
          tip: 'Either the injury needs correcting, or this person is a surviving victim who should be linked to a different offense than the homicide.',
        });
      }

      // Arrestee specifics
      if (person.role === 'arrestee') {
        if (blank(person.arrestDate)) {
          issues.push({
            key: `person.${person.id}.arrestDate`,
            ruleId: 'person.arrestDate',
            severity: 'error',
            section: 'persons',
            path: at('arrestDate'),
            scope,
            title: 'Arrest date is required',
            message: 'Every arrestee needs the date they were taken into custody.',
            tip: 'For a summons or citation in lieu of arrest, use the date you issued it.',
            quickFix: {
              label: 'Use the incident date',
              apply: (draft) => {
                const target = draft.persons.find((p) => p.id === person.id);
                if (target) target.arrestDate = draft.occurredFrom.slice(0, 10) || draft.reportedAt.slice(0, 10);
              },
            },
          });
        }
        if (blank(person.arrestType)) {
          issues.push({
            key: `person.${person.id}.arrestType`,
            ruleId: 'person.arrestType',
            severity: 'error',
            section: 'persons',
            path: at('arrestType'),
            scope,
            title: 'Arrest type is required',
            message: 'Record how this person came into custody.',
            tip: 'On-View is an arrest you made at the scene. Summoned/Cited is a citation with no custody. Taken Into Custody covers warrant service and arrests off a previous report.',
          });
        }
        if (person.charges.length === 0) {
          issues.push({
            key: `person.${person.id}.charges`,
            ruleId: 'person.charges',
            severity: 'error',
            section: 'persons',
            path: at('charges'),
            scope,
            title: 'Arrestee has no charges',
            message: 'An arrest record must list at least one charge.',
            tip: 'Charges are what you booked them on, which may be narrower than the offenses on the report. Add each statute separately with its own count.',
          });
        }
      }

      // Suspect with nothing usable
      if (
        person.role === 'suspect' &&
        person.isUnknown &&
        blank(person.description) &&
        blank(person.sex) &&
        blank(person.race)
      ) {
        issues.push({
          key: `person.${person.id}.emptySuspect`,
          ruleId: 'person.emptySuspect',
          severity: 'warning',
          section: 'persons',
          path: at('description'),
          scope,
          title: 'Unknown suspect has no description at all',
          message: 'This suspect record carries no identifying information.',
          tip: 'Even partial detail has value for linking cases — approximate height, build, clothing, tattoos, accent, direction of travel. If the victim saw nothing whatsoever, say so in the narrative and delete this empty record.',
        });
      }
    }

    return issues;
  },

  // ---- Victim / offender relationships ----------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    if (ctx.offenders.length === 0) return issues;

    const violentVictims = ctx.victims.filter(
      (v) =>
        v.victimType === 'I' &&
        ctx.offenses.some(
          (o) => o.def?.requiresIndividualVictim && (v.offenseIds.includes(o.offense.id) || v.offenseIds.length === 0),
        ),
    );

    for (const victim of violentVictims) {
      const missing = ctx.offenders.filter(
        (off) => !victim.relationships.some((r) => r.offenderId === off.id && !blank(r.relationship)),
      );
      if (missing.length === 0) continue;

      issues.push({
        key: `person.${victim.id}.relationship`,
        ruleId: 'person.relationship',
        severity: 'error',
        section: 'persons',
        path: path.person(victim.id, 'relationships'),
        scope: ctx.personLabel(victim),
        title: 'Relationship to offender is missing',
        message: `No relationship recorded between this victim and ${
          missing.length === 1 ? ctx.personLabel(missing[0]) : `${missing.length} of the offenders`
        }.`,
        tip: 'Crimes against a person require the victim-to-offender relationship. Use "Victim was Stranger" when they had never met, and "Relationship Unknown" only when the victim could not say. Picking a family or partner code here is what drives the domestic violence flag.',
        quickFix: {
          label: 'Mark all as strangers',
          apply: (draft) => {
            const target = draft.persons.find((p) => p.id === victim.id);
            if (!target) return;
            for (const off of missing) {
              const existing = target.relationships.find((r) => r.offenderId === off.id);
              if (existing) existing.relationship = 'ST';
              else target.relationships.push({ offenderId: off.id, relationship: 'ST' });
            }
          },
        },
      });
    }

    return issues;
  },

  // ---- Juvenile handling -------------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    const reference = ctx.incident.occurredFrom || ctx.incident.reportedAt;

    const juveniles = ctx.incident.persons.filter((p) => {
      const age = ageAt(p.dob, reference);
      return age !== null && age < 18;
    });

    if (juveniles.length > 0 && !ctx.incident.involvesJuvenile) {
      issues.push({
        key: 'persons.juvenile.flag',
        ruleId: 'persons.juvenile.flag',
        severity: 'warning',
        section: 'incident',
        path: path.incident('involvesJuvenile'),
        title: 'A person on this report is under 18',
        message: `${juveniles.length === 1 ? ctx.personLabel(juveniles[0]) : `${juveniles.length} people`} on this report ${
          juveniles.length === 1 ? 'is' : 'are'
        } a minor, but the juvenile flag is off.`,
        tip: 'The juvenile flag controls redaction on public records requests and routes the report to the juvenile unit. Turn it on unless the date of birth is wrong.',
        quickFix: {
          label: 'Turn on the flag',
          apply: (draft) => {
            draft.involvesJuvenile = true;
          },
        },
      });
    }

    // A juvenile arrestee needs a disposition path
    for (const p of juveniles) {
      if (p.role !== 'arrestee') continue;
      if (p.arrestType === 'O' || p.arrestType === 'T') {
        issues.push({
          key: `person.${p.id}.juvenileCustody`,
          ruleId: 'person.juvenileCustody',
          severity: 'warning',
          section: 'persons',
          path: path.person(p.id, 'arrestType'),
          scope: ctx.personLabel(p),
          title: 'Juvenile taken into custody',
          message: 'This arrestee is under 18 and was taken into physical custody.',
          tip: 'Document the parent/guardian notification and the juvenile intake disposition in the narrative. Most agencies require both before this report can be approved.',
        });
      }
    }

    return issues;
  },

  // ---- Domestic relationship without domestic offense --------------------
  (ctx) => {
    const domesticVictim = ctx.victims.find((v) =>
      v.relationships.some((r) => DOMESTIC_RELATIONSHIPS.has(r.relationship)),
    );
    if (!domesticVictim) return [];
    const hasPersonOffense = ctx.offenses.some((o) => o.def?.category === 'person');
    if (hasPersonOffense) return [];

    return [
      {
        key: 'persons.domestic.noPersonOffense',
        ruleId: 'persons.domestic.noPersonOffense',
        severity: 'warning',
        section: 'offenses',
        path: path.section('offenses'),
        title: 'Domestic relationship but no crime against a person',
        message: 'A victim is related to an offender by family or intimate partnership, yet no assault, intimidation or similar offense is listed.',
        tip: 'Check whether an offense is missing. Intimidation (13C) covers threats with no physical contact and is the one most often left off a domestic report.',
      },
    ];
  },
];
