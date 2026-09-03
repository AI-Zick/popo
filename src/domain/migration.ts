/**
 * Migrating from a previous records system.
 *
 * The feature that decides whether an agency can actually switch. Everything
 * else in here is worth nothing to a department with eleven years of history in
 * IMC if the only way to move is to retype it.
 *
 * CSV, because it is the one export every legacy RMS can produce — often the
 * only one an agency can get without paying their outgoing vendor for it.
 *
 * Three rules run through the whole thing:
 *
 *   **Nothing is written until the whole plan has been seen.** An import that
 *   half-succeeds and stops leaves an agency with a database in a state nobody
 *   can describe. Every row is decided first, shown, and only then committed.
 *
 *   **Duplicates are found on the way in, not cleaned up later.** The same
 *   tiered matching that stops a duplicate person being created during a
 *   report runs over every imported row. The alternative is importing the same
 *   human eleven times and discovering it two years later.
 *
 *   **Imported data says it was imported.** Everything lands with `import`
 *   provenance and no verification, so an address that came out of a system
 *   nobody has audited reads as exactly that rather than as something an
 *   officer confirmed.
 */

import type { MasterPerson, PersonIndex, ProvenancedField } from './person';
import { PROVENANCED_FIELDS } from './person';
import type { LocationIndex, MasterLocation } from './location';
import { findMatches } from './matching';
import { findLocations } from './locationMatching';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A CSV parser that survives real exports.
 *
 * Quoted fields containing commas, escaped quotes, and CRLF — all of which
 * turn up the moment a narrative field or an address with a comma appears. A
 * naive `split(',')` corrupts a legacy export in the first hundred rows and
 * does it quietly.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Normalise line endings first: exports arrive from Windows more often than
  // not, and a stray \r ends up inside the last field of every row.
  const input = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A trailing newline produces one empty row; nobody meant to import it.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/* ------------------------------------------------------------------ */
/* What can be imported                                                */
/* ------------------------------------------------------------------ */

export type EntityKind = 'people' | 'locations';

export interface FieldSpec {
  key: string;
  label: string;
  /** A row without this is rejected. */
  required?: boolean;
  /** Header names a legacy export is likely to use, lowercased. */
  aliases: string[];
  hint?: string;
}

export const PEOPLE_FIELDS: FieldSpec[] = [
  { key: 'lastName', label: 'Last name', required: true, aliases: ['last', 'lastname', 'last_name', 'surname', 'lname'] },
  { key: 'firstName', label: 'First name', aliases: ['first', 'firstname', 'first_name', 'given', 'fname'] },
  { key: 'middleName', label: 'Middle name', aliases: ['middle', 'middlename', 'middle_name', 'mi', 'minit'] },
  { key: 'suffix', label: 'Suffix', aliases: ['suffix', 'sfx', 'gen'] },
  { key: 'businessName', label: 'Business name', aliases: ['business', 'businessname', 'company', 'organization'] },
  { key: 'dob', label: 'Date of birth', aliases: ['dob', 'birth', 'birthdate', 'birth_date', 'dateofbirth'] },
  { key: 'sex', label: 'Sex', aliases: ['sex', 'gender'] },
  { key: 'race', label: 'Race', aliases: ['race'] },
  { key: 'address', label: 'Address', aliases: ['address', 'addr', 'street', 'address1', 'streetaddress'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
  { key: 'state', label: 'State', aliases: ['state', 'st'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'postal', 'postalcode'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'homephone', 'phone1', 'cell'] },
  { key: 'driverLicense', label: 'Driver licence', aliases: ['dl', 'oln', 'license', 'licence', 'driverlicense', 'dlnumber'] },
  { key: 'driverLicenseState', label: 'Licence state', aliases: ['dlstate', 'olnstate', 'licensestate'] },
  { key: 'ssn', label: 'SSN', aliases: ['ssn', 'social'], hint: 'Used for matching only. Never searchable.' },
];

export const LOCATION_FIELDS: FieldSpec[] = [
  { key: 'address', label: 'Address', required: true, aliases: ['address', 'addr', 'street', 'address1', 'location'] },
  { key: 'commonName', label: 'Common name', aliases: ['name', 'commonname', 'business', 'premise', 'place'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
  { key: 'state', label: 'State', aliases: ['state', 'st'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'postal'] },
  { key: 'beat', label: 'Beat / zone', aliases: ['beat', 'zone', 'district', 'rd', 'sector'] },
  { key: 'latitude', label: 'Latitude', aliases: ['lat', 'latitude', 'y'] },
  { key: 'longitude', label: 'Longitude', aliases: ['lon', 'lng', 'long', 'longitude', 'x'] },
];

export function fieldsFor(kind: EntityKind): FieldSpec[] {
  return kind === 'people' ? PEOPLE_FIELDS : LOCATION_FIELDS;
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

/** Our field key → the index of the column it comes from, or -1 for none. */
export type ColumnMap = Record<string, number>;

/**
 * A first guess at the mapping.
 *
 * Legacy exports use a small, predictable vocabulary — `LNAME`, `DOB`, `OLN` —
 * and guessing right saves a records clerk twenty dropdowns per file. Guessing
 * is all it is: every choice is shown and changeable before anything is read.
 */
export function guessMapping(headers: string[], kind: EntityKind): ColumnMap {
  const normalised = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const map: ColumnMap = {};

  for (const field of fieldsFor(kind)) {
    const exact = normalised.findIndex((h) => h === field.key.toLowerCase());
    if (exact >= 0) {
      map[field.key] = exact;
      continue;
    }
    const alias = normalised.findIndex((h) => field.aliases.includes(h));
    map[field.key] = alias;
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Normalising values                                                  */
/* ------------------------------------------------------------------ */

/**
 * Dates, as legacy systems actually write them.
 *
 * `MM/DD/YYYY` dominates American exports, `YYYY-MM-DD` turns up from anything
 * newer, and two-digit years still appear. A date that cannot be read is
 * returned empty rather than guessed — a wrong date of birth is worse than a
 * missing one, because it silently defeats the duplicate matching that depends
 * on it.
 */
export function normalizeDate(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const us = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (us) {
    const [, month, day, yearRaw] = us;
    let year = Number(yearRaw);
    if (yearRaw.length === 2) {
      // A two-digit year in a police file is a date of birth far more often
      // than a future date, so the window sits in the past.
      year += year > 30 ? 1900 : 2000;
    }
    if (Number(month) > 12 || Number(day) > 31) return '';
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return '';
}

function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}

/** `M`, `MALE`, `1` → `M`. Anything unrecognised is left out. */
export function normalizeSex(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (/^(M|MALE|1)$/.test(value)) return 'M';
  if (/^(F|FEMALE|2)$/.test(value)) return 'F';
  if (/^(U|UNKNOWN|X|0)$/.test(value)) return 'U';
  return '';
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type RowOutcome = 'create' | 'merge' | 'review' | 'reject';

export interface RowPlan {
  /** 1-based row number in the file, so a clerk can find it. */
  row: number;
  outcome: RowOutcome;
  /** What was read out of the row, already normalised. */
  values: Record<string, string>;
  /** Why it was rejected, or what it matched. */
  reason: string;
  /** The existing record it matched, when it did. */
  matchedId?: string;
  matchedLabel?: string;
  /**
   * Values the row had that could not be read, and so were left blank.
   *
   * A legacy export contains dates like `13/45/1988` and sexes like `UNK`, and
   * the honest answer to those is to leave the field empty rather than guess.
   * But dropping them silently is how an agency discovers, two years on, that
   * four hundred dates of birth never made it across. So they are counted and
   * shown.
   */
  warnings?: string[];
}

export interface ImportPlan {
  kind: EntityKind;
  /** Data rows read, not counting the header. */
  rows: number;
  create: RowPlan[];
  merge: RowPlan[];
  review: RowPlan[];
  reject: RowPlan[];
}

export interface PlanInput {
  kind: EntityKind;
  rows: string[][];
  /** True when the first row is a header. */
  hasHeader: boolean;
  mapping: ColumnMap;
  people: PersonIndex;
  locations: LocationIndex;
}

/**
 * Decides every row without writing anything.
 *
 * The output is what a records clerk approves before a single record is
 * created — which is the whole point. An import that has to be judged after it
 * has run is one nobody can safely undo.
 */
export function planImport(input: PlanInput): ImportPlan {
  const { kind, mapping, hasHeader } = input;
  const dataRows = hasHeader ? input.rows.slice(1) : input.rows;
  const fields = fieldsFor(kind);

  const plan: ImportPlan = { kind, rows: dataRows.length, create: [], merge: [], review: [], reject: [] };

  /*
    Records created earlier in this same file are matched against too.
    A legacy export routinely contains the same person on twenty rows — once
    per report they appeared on — and matching only against what was already in
    the database would import twenty copies of them.
  */
  const pending: MasterPerson[] = [];
  const pendingLocations: MasterLocation[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + (hasHeader ? 2 : 1);
    const values: Record<string, string> = {};

    const warnings: string[] = [];

    for (const field of fields) {
      const column = mapping[field.key];
      const raw = column >= 0 ? (row[column] ?? '') : '';
      values[field.key] = normalizeValue(field.key, raw);
      if (raw.trim() && !values[field.key]) {
        warnings.push(`${field.label} "${raw.trim()}" could not be read and was left blank`);
      }
    }

    const missing = fields.filter((f) => f.required && !values[f.key]).map((f) => f.label);
    if (missing.length > 0) {
      plan.reject.push({
        row: rowNumber,
        outcome: 'reject',
        values,
        warnings,
        reason: `No ${missing.map(sentenceCase).join(' or ')}`,
      });
      return;
    }

    if (kind === 'people') {
      const index: PersonIndex = { ...input.people };
      for (const p of pending) index[p.id] = p;

      const matches = findMatches(
        {
          lastName: values.lastName,
          firstName: values.firstName,
          middleName: values.middleName,
          dob: values.dob,
          address: values.address,
          phone: values.phone,
          ssn: values.ssn,
          driverLicense: values.driverLicense,
        },
        index,
        { limit: 3 },
      );

      const best = matches[0];
      /*
        A contradicting hard identifier is never swept into an automatic
        merge, however well the names and dates line up. Exact name plus exact
        date of birth on top of a different licence number is precisely the
        pair a human should look at — and rare enough that asking costs
        nothing, unlike the clean duplicates `sameOnImport` exists to absorb.
      */
      const clean = best ? best.conflicts.length === 0 : false;
      if (best && clean && (best.tier === 'certain' || best.tier === 'strong' || sameOnImport(values, best.master))) {
        plan.merge.push({
          row: rowNumber,
          outcome: 'merge',
          values,
          warnings,
          reason: mergeReason(best.reasons),
          matchedId: best.master.id,
          matchedLabel: `${best.master.lastName}, ${best.master.firstName}`.trim(),
        });
        return;
      }
      if (best) {
        // Neither confident enough to merge nor clean enough to create. A
        // human decides, because both wrong answers are expensive: a merged
        // pair of different people, or a duplicated one.
        plan.review.push({
          row: rowNumber,
          outcome: 'review',
          values,
          warnings,
          reason: best.conflicts[0] ?? reviewReason(best.reasons),
          matchedId: best.master.id,
          matchedLabel: `${best.master.lastName}, ${best.master.firstName}`.trim(),
        });
        return;
      }

      /*
        Nothing scored high enough to be a candidate — but a name is not
        nothing. Somebody already in the database with exactly this first and
        last name, where neither record carries enough else to tell them
        apart, is the one collision an import must not resolve on its own:
        creating the duplicate is silent and permanent.

        Only records already in the database count. Rows earlier in this same
        file came out of one system, where the same name on twenty rows is the
        same person listed once per report — merging those is the point.
      */
      const collision = nameCollision(values, input.people);
      if (collision) {
        plan.review.push({
          row: rowNumber,
          outcome: 'review',
          values,
          warnings,
          reason: 'Same name as someone already on file, with nothing else to tell them apart',
          matchedId: collision.id,
          matchedLabel: `${collision.lastName}, ${collision.firstName}`.trim(),
        });
        return;
      }

      pending.push(asPerson(values, `pending-${rowNumber}`));
      plan.create.push({ row: rowNumber, outcome: 'create', values, warnings, reason: 'New to the index' });
      return;
    }

    /* ---- Locations --------------------------------------------------- */
    const index: LocationIndex = { ...input.locations };
    for (const l of pendingLocations) index[l.id] = l;

    const matches = findLocations(
      {
        address: values.address,
        commonName: values.commonName,
        city: values.city,
        state: values.state,
      },
      index,
      { limit: 3 },
    );
    const best = matches[0];

    if (best?.tier === 'certain' || best?.tier === 'strong') {
      plan.merge.push({
        row: rowNumber,
        outcome: 'merge',
        values,
        warnings,
        reason: best.reasons[0] ?? 'Matches a place already known',
        matchedId: best.location.id,
        matchedLabel: best.location.commonName || best.location.address,
      });
      return;
    }
    if (best?.tier === 'possible') {
      plan.review.push({
        row: rowNumber,
        outcome: 'review',
        values,
        warnings,
        reason: best.reasons[0] ?? 'Looks similar to a place already known',
        matchedId: best.location.id,
        matchedLabel: best.location.commonName || best.location.address,
      });
      return;
    }

    pendingLocations.push(asLocation(values, `pending-${rowNumber}`));
    plan.create.push({ row: rowNumber, outcome: 'create', values, warnings, reason: 'New to the index' });
  });

  return plan;
}

/**
 * The extra merge rule that applies only to an import.
 *
 * The interactive threshold is deliberately cautious: when an officer is
 * linking a person to a live case, a wrong merge puts one person's history on
 * another's report, so anything short of strong evidence is put to a human.
 *
 * An import is a different problem with a different failure mode. A legacy
 * export of eleven years lists the same person once per report they appeared
 * on, and an exact match on full name *and* exact date of birth is about as
 * good as record linkage gets. Sending those to review produces tens of
 * thousands of rows nobody will ever work through — at which point the clerk
 * approves the lot unread, and the review step has made things worse rather
 * than better.
 *
 * So: full name plus date of birth, all exact, merges. Anything less still goes
 * to a human.
 */
function sameOnImport(values: Record<string, string>, master: MasterPerson): boolean {
  const eq = (a: string, b: string) => Boolean(a) && a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    Boolean(values.dob) &&
    values.dob === master.dob &&
    eq(values.lastName, master.lastName) &&
    eq(values.firstName, master.firstName)
  );
}

/**
 * Somebody already on file with exactly this name, where neither record has
 * anything else to separate them.
 *
 * "Nothing else" is the important half. Two Samuel Okafors with different dates
 * of birth are two people and the matcher already says so; two with no date of
 * birth on either side are a question, and a question is for a human.
 */
function nameCollision(values: Record<string, string>, index: PersonIndex): MasterPerson | null {
  const first = values.firstName?.trim().toLowerCase();
  const last = values.lastName?.trim().toLowerCase();
  if (!first || !last) return null;

  for (const master of Object.values(index)) {
    if (master.lastName.trim().toLowerCase() !== last) continue;
    if (master.firstName.trim().toLowerCase() !== first) continue;
    // A date of birth on both sides means the matcher had its say already.
    if (values.dob && master.dob) continue;
    return master;
  }
  return null;
}

/**
 * Why a row merged, in a clerk's terms.
 *
 * `reasons` comes back weakest-first from the matcher — "Same last name" ahead
 * of "Same date of birth" — and a merge justified as "same last name" reads
 * like a mistake even when it is not. Lead with the evidence that carried it.
 */
function mergeReason(reasons: string[]): string {
  const strongest = ['Same SSN', 'Same driver licence', 'Same state ID', 'Same date of birth'];
  for (const reason of strongest) {
    if (reasons.includes(reason)) {
      const rest = reasons.filter((r) => r !== reason);
      return rest.length > 0 ? `${reason}, ${rest.join(', ').toLowerCase()}` : reason;
    }
  }
  return reasons.join(', ') || 'Matches an existing record';
}

function reviewReason(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join(', ') : 'Looks similar to an existing record';
}

/** "Last name" → "last name", but "ZIP" and "SSN" are left alone. */
function sentenceCase(label: string): string {
  return label[1] && label[1] === label[1].toLowerCase()
    ? label[0].toLowerCase() + label.slice(1)
    : label;
}

function normalizeValue(key: string, raw: string): string {
  const value = raw.trim();
  if (key === 'dob') return normalizeDate(value);
  if (key === 'sex') return normalizeSex(value);
  if (key === 'state' || key === 'driverLicenseState') return value.toUpperCase().slice(0, 2);
  return value;
}

/* ------------------------------------------------------------------ */
/* Turning a planned row into a record                                 */
/* ------------------------------------------------------------------ */

/**
 * Provenance for imported fields.
 *
 * `import` with `verified: false` and the date the migration ran. That is what
 * makes the freshness strip tell the truth afterwards: contact details that
 * came out of a system nobody has audited read as exactly that, rather than as
 * something an officer confirmed at a scene.
 */
export function importProvenance(at: string): Partial<Record<ProvenancedField, { source: 'import'; verified: false; at: string }>> {
  const provenance: Partial<Record<ProvenancedField, { source: 'import'; verified: false; at: string }>> = {};
  for (const field of PROVENANCED_FIELDS) {
    provenance[field] = { source: 'import', verified: false, at };
  }
  return provenance;
}

/** Shapes a planned row as a person, for matching within the same file. */
function asPerson(values: Record<string, string>, id: string): MasterPerson {
  return {
    id,
    lastName: values.lastName ?? '',
    firstName: values.firstName ?? '',
    middleName: values.middleName ?? '',
    suffix: values.suffix ?? '',
    businessName: values.businessName ?? '',
    aliases: [],
    dob: values.dob ?? '',
    sex: values.sex ?? '',
    race: values.race ?? '',
    ethnicity: '',
    height: '',
    weight: '',
    eyeColor: '',
    hairColor: '',
    scarsMarksTattoos: '',
    address: values.address ?? '',
    city: values.city ?? '',
    state: values.state ?? '',
    zip: values.zip ?? '',
    phone: values.phone ?? '',
    email: '',
    ssn: values.ssn ?? '',
    driverLicense: values.driverLicense ?? '',
    driverLicenseState: values.driverLicenseState ?? '',
    stateId: '',
    cautions: [],
    provenance: {},
    mergedFrom: [],
    createdAt: '',
    updatedAt: '',
  };
}

function asLocation(values: Record<string, string>, id: string): MasterLocation {
  return {
    id,
    commonName: values.commonName ?? '',
    aliases: [],
    address: values.address ?? '',
    city: values.city ?? '',
    state: values.state ?? '',
    zip: values.zip ?? '',
    locationType: '',
    beat: values.beat ?? '',
    latitude: Number(values.latitude) || 0,
    longitude: Number(values.longitude) || 0,
    geoSource: values.latitude ? 'import' : '',
    hasUnits: false,
    unitLabel: '',
    notes: [],
    createdAt: '',
    updatedAt: '',
  } as MasterLocation;
}

export { asPerson, asLocation };

/** A one-line summary, for the screen and for the audit entry. */
/** Every row in the plan, whatever the outcome, in file order. */
export function allRows(plan: ImportPlan): RowPlan[] {
  return [...plan.create, ...plan.merge, ...plan.review, ...plan.reject].sort((a, b) => a.row - b.row);
}

/**
 * Rows carrying a value that could not be read, worst first.
 *
 * Shown before the import runs rather than discovered afterwards: a clerk who
 * sees "forty dates of birth could not be read" goes back to the export and
 * fixes the date format, which is a five-minute job now and a reconciliation
 * project later.
 */
export function unreadableValues(plan: ImportPlan): { count: number; rows: RowPlan[] } {
  const rows = allRows(plan).filter((r) => (r.warnings?.length ?? 0) > 0);
  return { count: rows.reduce((n, r) => n + (r.warnings?.length ?? 0), 0), rows };
}

export function describePlan(plan: ImportPlan): string {
  return [
    `${plan.create.length} new`,
    `${plan.merge.length} matched`,
    `${plan.review.length} to check`,
    `${plan.reject.length} rejected`,
  ].join(' · ');
}
