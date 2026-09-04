import { describe, expect, it } from 'vitest';
import {
  checkStatute,
  createStatute,
  findStatute,
  gradeRank,
  isVerified,
  statuteLabel,
  statutesFor,
  unverified,
  UNVERIFIED_NOTICE,
} from '../statute';
import { AL_STATUTES } from '../statutes/al';
import { hasStatutePack, statutePack } from '../statutes';
import { emptyAgency, withStatutePack } from '../agency';
import { OFFENSE_BY_CODE } from '../codes';

const st = (partial = {}) =>
  createStatute({ id: 'x', cite: '13A-7-6', title: 'Burglary 2nd', offenseCodes: ['220'], ...partial });

/* ------------------------------------------------------------------ */
/* Narrowing, not choosing                                             */
/* ------------------------------------------------------------------ */

describe('the statutes an offence could be charged under', () => {
  it('narrows to the ones that mention that offence', () => {
    const found = statutesFor('220', AL_STATUTES).map((s) => s.cite);
    expect(found).toContain('13A-7-5');
    expect(found).toContain('13A-7-6');
    expect(found).toContain('13A-7-7');
    expect(found).not.toContain('32-5A-191');
  });

  it('does not choose between them', () => {
    /*
      Three degrees of burglary come back, and which one it is depends on
      whether anybody was home and whether the person was armed. That is a
      legal judgement about what happened, and nothing here can make it.
    */
    expect(statutesFor('220', AL_STATUTES).length).toBeGreaterThan(1);
  });

  it('puts the most serious first, because that is the decision being made', () => {
    /*
      Deliberately checked on a set where severity order and cite order
      disagree. Burglary's three degrees happen to run 13A-7-5, -6, -7 in
      severity order too, so sorting them proves nothing.
    */
    const publicOrder = statutesFor('90Z', AL_STATUTES);
    expect(publicOrder[0].grade).toMatch(/felony/i);
    expect(publicOrder[0].cite).toBe('32-10-2');
    // Which is not where sorting by cite would have put it.
    const byCite = [...publicOrder].sort((a, b) => a.cite.localeCompare(b.cite));
    expect(byCite[0].cite).not.toBe('32-10-2');

    // And the unreadable grades sink rather than being guessed at.
    expect(publicOrder[publicOrder.length - 1].grade).toMatch(/Violation/);
  });

  it('gives nothing for no offence, rather than everything', () => {
    expect(statutesFor('', AL_STATUTES)).toEqual([]);
  });

  it('lets one statute answer to several offences', () => {
    // A theft statute graded by value covers larceny, shoplifting and theft
    // from a building alike.
    const theft = AL_STATUTES.find((s) => s.cite === '13A-8-5')!;
    expect(theft.offenseCodes.length).toBeGreaterThan(1);
    for (const code of theft.offenseCodes) {
      expect(statutesFor(code, AL_STATUTES).map((s) => s.cite)).toContain('13A-8-5');
    }
  });
});

describe('ordering by how serious it is', () => {
  it('puts felonies above misdemeanors', () => {
    expect(gradeRank('Class C felony')).toBeLessThan(gradeRank('Class A misdemeanor'));
  });

  it('reads letters and degrees alike', () => {
    expect(gradeRank('Class A felony')).toBeLessThan(gradeRank('Class B felony'));
    expect(gradeRank('Felony, first degree')).toBeLessThan(gradeRank('Felony, third degree'));
  });

  it('sorts a grade it cannot read to the end rather than guessing', () => {
    // A wrong order is a smaller harm than a confident wrong answer.
    expect(gradeRank('Violation')).toBeGreaterThan(gradeRank('Class C misdemeanor'));
    expect(gradeRank('')).toBeGreaterThan(gradeRank('Violation'));
  });
});

/* ------------------------------------------------------------------ */
/* Nothing here is authority                                           */
/* ------------------------------------------------------------------ */

describe('what the table admits about itself', () => {
  it('ships every seeded entry unverified', () => {
    /*
      Not an oversight to tidy up. A statute table shipped with software is out
      of date the session after it is written, and pretending otherwise is how
      a charge gets filed under a renumbered section.
    */
    expect(unverified(AL_STATUTES)).toHaveLength(AL_STATUTES.length);
    for (const statute of AL_STATUTES) expect(isVerified(statute)).toBe(false);
  });

  it('counts one as checked once somebody has checked it', () => {
    expect(isVerified(st({ verifiedOn: '2026-09-04' }))).toBe(true);
    expect(isVerified(st({ verifiedOn: '  ' }))).toBe(false);
  });

  it('has something to say when an unchecked cite is offered', () => {
    expect(UNVERIFIED_NOTICE).toMatch(/charging document/);
  });

  it('gives every entry the line that tells one degree from the next', () => {
    // "Burglary 1st" and "Burglary 2nd" tell an officer nothing at the moment
    // they are choosing between them.
    for (const statute of AL_STATUTES) {
      expect(statute.distinguishes.trim().length).toBeGreaterThan(10);
    }
  });

  it('only points at offences that exist', () => {
    for (const statute of AL_STATUTES) {
      for (const code of statute.offenseCodes) {
        expect(OFFENSE_BY_CODE.has(code)).toBe(true);
      }
    }
  });

  it('has no duplicate cites', () => {
    const cites = AL_STATUTES.map((s) => s.cite);
    expect(new Set(cites).size).toBe(cites.length);
  });
});

/* ------------------------------------------------------------------ */
/* Finding a cite already on a report                                  */
/* ------------------------------------------------------------------ */

describe('recognising a cite somebody typed', () => {
  it('matches however it was punctuated', () => {
    // Officers write "13A-7-6", "13a 7 6" and worse; a lookup that only knows
    // the first would call a cite already on a report unrecognised.
    for (const typed of ['13A-7-6', '13a-7-6', '13A 7 6', '13a76']) {
      expect(findStatute(typed, AL_STATUTES)?.cite).toBe('13A-7-6');
    }
  });

  it('does not invent a match', () => {
    expect(findStatute('99-9-9', AL_STATUTES)).toBeUndefined();
    expect(findStatute('', AL_STATUTES)).toBeUndefined();
  });

  it('reads as the cite and then what it is', () => {
    expect(statuteLabel(st())).toBe('13A-7-6 — Burglary 2nd');
  });
});

/* ------------------------------------------------------------------ */
/* Editing the table                                                   */
/* ------------------------------------------------------------------ */

describe('adding one', () => {
  it('needs a cite, a name and at least one offence', () => {
    expect(checkStatute(st({ cite: '' })).field).toBe('cite');
    expect(checkStatute(st({ title: '' })).field).toBe('title');
    expect(checkStatute(st({ offenseCodes: [] })).field).toBe('offenseCodes');
    expect(checkStatute(st()).ok).toBe(true);
  });

  it('refuses a second copy of a cite already there', () => {
    const existing = st({ id: 'a' });
    const duplicate = st({ id: 'b', cite: '13a 7 6' });
    const check = checkStatute(duplicate, [existing]);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already in the table/);
  });

  it('does not call a statute a duplicate of itself', () => {
    const one = st({ id: 'a' });
    expect(checkStatute(one, [one]).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Seeding from the state                                              */
/* ------------------------------------------------------------------ */

describe('starting from the state pack', () => {
  it('knows which states have one', () => {
    expect(hasStatutePack('AL')).toBe(true);
    expect(hasStatutePack('al')).toBe(true);
    expect(hasStatutePack('WY')).toBe(false);
  });

  it('hands back a copy, so an agency editing theirs cannot edit the pack', () => {
    const first = statutePack('AL');
    first[0].title = 'Changed';
    expect(statutePack('AL')[0].title).not.toBe('Changed');
  });

  it('fills an empty table when the state is chosen', () => {
    const agency = withStatutePack({ ...emptyAgency(), state: 'AL' });
    expect(agency.statutes.length).toBe(AL_STATUTES.length);
  });

  it('never overwrites what an agency has already checked', () => {
    /*
      Reseeding would quietly undo somebody's afternoon. Once an agency has
      started working through these they are the agency's table, not ours.
    */
    const checked = createStatute({
      id: 'mine',
      cite: '13A-7-6',
      title: 'Burglary II — as our DA charges it',
      offenseCodes: ['220'],
      verifiedOn: '2026-09-04',
    });
    const agency = withStatutePack({ ...emptyAgency(), state: 'AL', statutes: [checked] });
    const burglary = agency.statutes.filter((s) => s.cite === '13A-7-6');
    expect(burglary).toHaveLength(1);
    expect(burglary[0].title).toMatch(/as our DA charges it/);
    // And the rest of the pack still arrived.
    expect(agency.statutes.length).toBe(AL_STATUTES.length);
  });

  it('leaves a state with no pack alone', () => {
    const agency = withStatutePack({ ...emptyAgency(), state: 'WY' });
    expect(agency.statutes).toEqual([]);
  });
});
