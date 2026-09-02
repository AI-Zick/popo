/**
 * The offline extractor.
 *
 * Regular expressions and a lookup against the Master Name Index. Deliberately
 * first, and deliberately the default:
 *
 *   - it runs in the browser with no network call, so nothing leaves the
 *     building and there is no compliance question to answer before an agency
 *     can use it;
 *   - it is deterministic, so the same narrative gives the same suggestions and
 *     a wrong one can be reproduced and fixed rather than argued about;
 *   - it costs nothing per report.
 *
 * It will not read intent, resolve "the male" to a person, or notice that
 * paragraph four describes a second offense. That is what the model-backed
 * extractor is for, and it is the harder sell — see `server/extract.ts`.
 */

import type { Incident } from '../types';
import type { PersonIndex } from '../person';
import { OFFENSE_BY_CODE, WEAPONS } from '../codes';
import type { Finding } from './types';

/** A match plus where it sat, so the suggestion can quote and highlight it. */
interface Hit {
  value: string;
  quote: string;
}

function scan(text: string, pattern: RegExp, pick: (m: RegExpExecArray) => string | null): Hit[] {
  const hits: Hit[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = pick(match);
    if (value) hits.push({ value, quote: match[0].trim() });
    // A zero-length match would spin forever.
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/**
 * "at approximately 2200 hours", "0745 hours".
 *
 * Military time followed by "hours" is close to unambiguous in a police
 * narrative, which is why this is worth pattern-matching at all — a bare "745"
 * is not.
 */
const HOURS = /\b([01]\d|2[0-3])([0-5]\d)\s*(?:hours|hrs)\b/gi;

/**
 * Combines a time from the narrative with the date the report already has.
 *
 * A time on its own cannot fill a datetime field, and guessing the date is how
 * an incident ends up filed to the wrong day. When there is no date to build
 * on, there is no suggestion.
 */
function withReportDate(incident: Incident, hh: string, mm: string): string | null {
  const base = incident.occurredFrom || incident.reportedAt;
  if (!base || base.length < 10) return null;
  return `${base.slice(0, 10)}T${hh}:${mm}`;
}

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

const PHONE = /\(?\b(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g;

/** Labelled plates only. An unlabelled alphanumeric run is not a plate. */
const PLATE = /\b(?:plate|tag|licen[cs]e plate)\s*#?\s*([A-Z0-9]{2,8})\b/gi;

/**
 * A VIN is 17 characters and never contains I, O or Q — the letters were
 * excluded precisely because they are confusable with 1 and 0. That makes a
 * false positive very unlikely, which is why this one is high confidence.
 */
const VIN = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

const MONEY = /\$\s?([\d,]+(?:\.\d{2})?)/g;

// Both apostrophes: word processors and phone keyboards produce the curly one,
// and "Halloran’s Towing" is what actually lands in the box.
const TOWED = /\btowed\s+(?:by|to)\s+([A-Z][A-Za-z'\u2019&.\- ]{2,40}?)(?=[,.]|\s+and\b|$)/g;

/* ------------------------------------------------------------------ */
/* Language that maps to a code                                        */
/* ------------------------------------------------------------------ */

/**
 * Forced entry.
 *
 * Worth doing because it is a NIBRS field an officer routinely forgets and the
 * narrative almost always describes: pry marks, a kicked door, a smashed
 * window.
 */
const FORCED_ENTRY =
  /\b(pry marks?|pried|forced (?:the )?(?:door|window|entry)|kicked in|smashed the (?:window|glass)|broke the (?:window|glass)|jimmied)\b/gi;

/**
 * Entry without force.
 *
 * Only *affirmative* statements that no force was used. "Found the door
 * standing open" is deliberately not here: it describes what the officer
 * discovered, which is exactly as consistent with a pried door as with an
 * unlocked one. A real narrative reads "I observed fresh pry marks... and
 * returned to find the rear sliding door standing open", and treating the
 * second clause as a no-force claim suppressed the finding the first clause
 * plainly supports.
 *
 * Discovery language is neutral. It votes for nothing.
 */
const NO_FORCE =
  /\b(unlocked|left (?:open|unlocked)|open (?:door|window)|no signs? of forced entry|without forcing)\b/gi;

/**
 * Weapon words mapped to their codes in `WEAPONS`. Only unambiguous ones, and
 * most specific first — "handgun" must not be caught by the generic firearm
 * pattern and filed as "type not stated".
 */
const WEAPON_WORDS: { pattern: RegExp; code: string }[] = [
  { pattern: /\b(handgun|pistol|revolver)\b/gi, code: '12' },
  { pattern: /\b(rifle)\b/gi, code: '13' },
  { pattern: /\b(shotgun)\b/gi, code: '14' },
  { pattern: /\b(firearm|gun)\b/gi, code: '11' },
  { pattern: /\b(knife|blade|box ?cutter)\b/gi, code: '20' },
  { pattern: /\b(baseball bat|crowbar|tire iron|flat bar|club)\b/gi, code: '30' },
];

const DOMESTIC =
  /\b(domestic (?:violence|dispute|disturbance)|his wife|her husband|their (?:wife|husband)|live[- ]in (?:boyfriend|girlfriend)|estranged (?:wife|husband|spouse))\b/gi;

const JUVENILE = /\b(juvenile|\b(?:1[0-7]|[1-9])[- ]year[- ]old\b|minor child|school[- ]aged)\b/gi;

/* ------------------------------------------------------------------ */
/* The extractor                                                       */
/* ------------------------------------------------------------------ */

export interface PatternInput {
  incident: Incident;
  people: PersonIndex;
}

/**
 * Everything the narrative appears to say, as findings.
 *
 * Whether any of it is new, whether it conflicts with what is already in the
 * report, and whether the officer wants it are all decided later. This function
 * only reads.
 */
export function extractByPattern({ incident, people }: PatternInput): Finding[] {
  const text = incident.narrative ?? '';
  if (!text.trim()) return [];

  const findings: Finding[] = [];

  /* ---- Times ------------------------------------------------------ */
  const times = scan(text, HOURS, (m) => `${m[1]}:${m[2]}`);
  times.forEach((hit, index) => {
    const [hh, mm] = hit.value.split(':');
    const value = withReportDate(incident, hh, mm);
    if (!value) return;
    findings.push({
      // The first time mentioned is usually when it started; a second is
      // usually when it ended. Usually is why this is not high confidence.
      field: index === 0 ? 'occurredFrom' : 'occurredTo',
      value,
      quote: hit.quote,
      confidence: index === 0 ? 'medium' : 'low',
      reason:
        index === 0
          ? 'The first time in the narrative, on the date already on the report.'
          : 'A later time in the narrative — check whether this is when it ended.',
    });
  });

  /* ---- Identifiers ------------------------------------------------ */
  for (const hit of scan(text, PHONE, (m) => `(${m[1]}) ${m[2]}-${m[3]}`)) {
    findings.push({
      field: 'person.phone',
      value: hit.value,
      quote: hit.quote,
      confidence: 'medium',
      reason: 'Looks like a phone number. Check whose it is.',
    });
  }

  for (const hit of scan(text, PLATE, (m) => m[1].toUpperCase())) {
    findings.push({
      field: 'vehicle.plate',
      value: hit.value,
      quote: hit.quote,
      confidence: 'high',
      reason: 'Written as a plate in the narrative.',
    });
  }

  for (const hit of scan(text, VIN, (m) => m[1].toUpperCase())) {
    findings.push({
      field: 'vehicle.vin',
      value: hit.value,
      quote: hit.quote,
      confidence: 'high',
      reason: 'Seventeen characters with no I, O or Q — the shape of a VIN.',
    });
  }

  for (const hit of scan(text, TOWED, (m) => m[1].trim())) {
    findings.push({
      field: 'vehicle.towedTo',
      value: hit.value,
      quote: hit.quote,
      confidence: 'medium',
      reason: 'The narrative says the vehicle was towed.',
    });
  }

  for (const hit of scan(text, MONEY, (m) => m[1].replace(/,/g, ''))) {
    findings.push({
      field: 'property.value',
      value: hit.value,
      quote: hit.quote,
      confidence: 'medium',
      reason: 'A dollar figure. Check which item it belongs to.',
    });
  }

  /* ---- Entry ------------------------------------------------------ */
  const burglary = incident.offenses.find((o) => OFFENSE_BY_CODE.get(o.code)?.isBurglary);
  if (burglary) {
    const forced = scan(text, FORCED_ENTRY, (m) => m[0])[0];
    const unforced = scan(text, NO_FORCE, (m) => m[0])[0];
    // Both kinds of language in one narrative is a question for the officer,
    // not something to resolve by picking whichever matched first.
    if (forced && !unforced) {
      findings.push({
        field: 'offense.methodOfEntry',
        value: 'F',
        quote: forced.quote,
        confidence: 'high',
        targetId: burglary.id,
        reason: 'The narrative describes force being used to get in.',
      });
    } else if (unforced && !forced) {
      findings.push({
        field: 'offense.methodOfEntry',
        value: 'N',
        quote: unforced.quote,
        confidence: 'medium',
        targetId: burglary.id,
        reason: 'The narrative describes entry without force.',
      });
    }
  }

  /* ---- Weapons ---------------------------------------------------- */
  const firstOffense = incident.offenses[0];
  if (firstOffense) {
    const seen = new Set<string>();
    let firearmNamed = false;
    for (const { pattern, code } of WEAPON_WORDS) {
      const hit = scan(text, pattern, (m) => m[0])[0];
      if (!hit || seen.has(code)) continue;
      // A narrative that says "handgun" has already told us the type; adding
      // "firearm, type not stated" alongside it is noise the officer has to
      // dismiss.
      if (code === '11' && firearmNamed) continue;
      if (['12', '13', '14'].includes(code)) firearmNamed = true;
      seen.add(code);
      findings.push({
        field: 'offense.weapon',
        value: code,
        quote: hit.quote,
        confidence: 'medium',
        targetId: firstOffense.id,
        reason: `Reads as ${WEAPONS.find((w) => w.value === code)?.label ?? 'a weapon'}. Check it was actually used, not just present.`,
      });
    }
  }

  /* ---- Flags ------------------------------------------------------ */
  const domestic = scan(text, DOMESTIC, (m) => m[0])[0];
  if (domestic) {
    findings.push({
      field: 'incident.isDomestic',
      value: 'true',
      quote: domestic.quote,
      confidence: 'medium',
      reason: 'The narrative describes a domestic relationship. The flag drives notification and reporting rules.',
    });
  }

  const juvenile = scan(text, JUVENILE, (m) => m[0])[0];
  if (juvenile) {
    findings.push({
      field: 'incident.involvesJuvenile',
      value: 'true',
      quote: juvenile.quote,
      confidence: 'low',
      reason: 'A juvenile may be involved. This changes how the record is handled and released.',
    });
  }

  /* ---- People already in the index -------------------------------- */
  findings.push(...namesFromIndex(text, incident, people));

  return findings;
}

/**
 * People the narrative names who are already in the Master Name Index.
 *
 * The highest-value pattern in here, and the one that only works because
 * identity is stored once: an officer writes "Whitfield stated" and the system
 * can offer the actual person record rather than a string. It only proposes
 * people the agency already knows, so it can never invent a human being.
 */
function namesFromIndex(text: string, incident: Incident, people: PersonIndex): Finding[] {
  const onReport = new Set(incident.persons.map((p) => p.masterId));
  const lower = text.toLowerCase();
  const findings: Finding[] = [];

  for (const master of Object.values(people)) {
    if (onReport.has(master.id)) continue;
    const last = master.lastName.trim();
    const first = master.firstName.trim();
    if (last.length < 3) continue;

    const full = `${first} ${last}`.trim().toLowerCase();
    // A full name in the text is a real signal. A bare surname is weaker but
    // is how officers actually write, so it counts at lower confidence.
    const fullAt = first ? lower.indexOf(full) : -1;
    const lastAt = lower.indexOf(last.toLowerCase());
    if (fullAt < 0 && lastAt < 0) continue;

    const at = fullAt >= 0 ? fullAt : lastAt;
    const length = fullAt >= 0 ? full.length : last.length;

    findings.push({
      field: 'person.add',
      value: master.id,
      quote: text.slice(at, at + length),
      confidence: fullAt >= 0 ? 'medium' : 'low',
      targetId: master.id,
      reason:
        fullAt >= 0
          ? 'Named in the narrative and already in the name index, but not on this report.'
          : 'A surname in the narrative matches someone in the name index. Check it is the same person.',
    });
  }

  return findings;
}
