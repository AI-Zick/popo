/**
 * The state's own offence statutes, keyed to the NIBRS codes they answer to.
 *
 * The problem this solves is small and constant: an officer picks "Burglary"
 * from a national list of two hundred codes, and then has to type the state
 * cite a prosecutor will actually charge under from memory, at three in the
 * morning, into a field with no help in it. They mostly get it right. The
 * times they do not are the times a charge is filed under a repealed section
 * or the wrong degree, and nobody notices until court.
 *
 * **The mapping is many-to-many and that is the whole difficulty.** One NIBRS
 * code covers several statutes — burglary is first, second and third degree,
 * and which one it is depends on whether anybody was home and whether the
 * person was armed. Picking the offence therefore cannot pick the statute; it
 * can only narrow the list to the ones worth looking at. That is what this
 * does, and it stops there, because choosing between second and third degree
 * is a legal judgement about what happened.
 *
 * **Nothing here is authority.** Legislatures renumber, repeal and re-grade
 * offences every session, and a statute table shipped with software is out of
 * date the moment it is written. So every entry arrives `verifiedOn: ''` —
 * meaning nobody at this agency has yet checked it against the current code —
 * and the screen says so wherever an unverified cite is offered. That is the
 * same bargain as the retention schedule and the exemption rules: useful
 * numbers on day one, and no pretence that they have been checked.
 *
 * An agency edits, adds and removes these like any other schedule. Local
 * ordinances belong here too, which is why the picker never refuses a cite
 * that is not on the list: a municipal noise ordinance is a real charge and no
 * state pack will ever contain it.
 */

/* ------------------------------------------------------------------ */
/* One statute                                                         */
/* ------------------------------------------------------------------ */

export interface Statute {
  id: string;

  /** The cite as it goes on a charging document — "13A-7-6". */
  cite: string;

  /** What it is called — "Burglary, second degree". */
  title: string;

  /**
   * The NIBRS codes this statute can be charged under.
   *
   * More than one is ordinary: a single theft statute graded by value answers
   * to larceny, shoplifting and theft from a building alike.
   */
  offenseCodes: string[];

  /**
   * How the state grades it — "Class B felony", "Class A misdemeanor".
   *
   * Free text because states do not agree on the vocabulary, and it is shown
   * beside the cite because the grade is most of what an officer is choosing
   * between when two degrees of the same offence are on screen.
   */
  grade: string;

  /**
   * What separates this degree from the one next to it, in a sentence.
   *
   * The single most useful field here. "Burglary 1st" and "Burglary 2nd" tell
   * an officer nothing; "dwelling, and armed or someone was injured" tells
   * them which one they are looking at.
   */
  distinguishes: string;

  /**
   * When somebody at this agency last checked this against the published code.
   *
   * Blank means never. Surfaced wherever the cite is offered rather than kept
   * in a settings screen, because the failure it prevents — a charge filed
   * under a section that was renumbered two sessions ago — is invisible at the
   * moment it happens and expensive afterwards.
   */
  verifiedOn: string;

  /** Who checked it. */
  verifiedBy: string;

  /** Anything the agency wants said about when this applies. */
  note: string;
}

export function createStatute(partial: Partial<Statute> = {}): Statute {
  return {
    id: '',
    cite: '',
    title: '',
    offenseCodes: [],
    grade: '',
    distinguishes: '',
    verifiedOn: '',
    verifiedBy: '',
    note: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Finding the ones worth looking at                                   */
/* ------------------------------------------------------------------ */

/**
 * The statutes that could apply to an offence, best-graded first.
 *
 * Ordered by grade rather than by cite, because an officer reading three
 * degrees of burglary is deciding how serious this one was, and reading them
 * in severity order is how that decision is actually made. Within a grade,
 * by cite, so the list is stable.
 */
export function statutesFor(offenseCode: string, statutes: Statute[]): Statute[] {
  if (!offenseCode) return [];
  return statutes
    .filter((statute) => statute.offenseCodes.includes(offenseCode))
    .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.cite.localeCompare(b.cite));
}

/**
 * Roughly how serious a grade is, for ordering only.
 *
 * Deliberately rough. Every state words this differently and some have grades
 * this cannot read at all — those sort last rather than being guessed at,
 * because a wrong order is a smaller harm than a confident wrong answer.
 */
export function gradeRank(grade: string): number {
  const text = grade.toLowerCase();
  if (!text.trim()) return 99;
  const felony = text.includes('felony');
  const misdemeanor = text.includes('misdemeanor') || text.includes('misdemeanour');
  if (!felony && !misdemeanor) return 98;

  /*
    Class A is worse than Class B nearly everywhere that uses letters, and
    first degree is worse than second everywhere that uses degrees. A state
    that inverts this gets its list in the wrong order and nothing else.
  */
  const letter = text.match(/class\s+([a-e])/)?.[1] ?? '';
  const level = text.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th|[1-5])\b/)?.[1] ?? '';
  const order = letter
    ? 'abcde'.indexOf(letter)
    : ['first', '1st', '1'].includes(level)
      ? 0
      : ['second', '2nd', '2'].includes(level)
        ? 1
        : ['third', '3rd', '3'].includes(level)
          ? 2
          : ['fourth', '4th', '4'].includes(level)
            ? 3
            : 4;

  return (felony ? 0 : 10) + Math.max(order, 0);
}

/** Whether anybody here has checked this against the published code. */
export function isVerified(statute: Statute): boolean {
  return statute.verifiedOn.trim().length > 0;
}

/** How a statute reads in a picker: the cite, then what it is. */
export function statuteLabel(statute: Statute): string {
  return [statute.cite, statute.title].filter(Boolean).join(' — ');
}

/**
 * The statute a cite refers to, where the table knows it.
 *
 * Matched loosely on purpose: officers write "13A-7-6", "13A‑7‑6" and
 * "13a 7 6", and a lookup that only recognises the first of those would show
 * a cite already on a report as unrecognised.
 */
export function findStatute(cite: string, statutes: Statute[]): Statute | undefined {
  const wanted = normalise(cite);
  if (!wanted) return undefined;
  return statutes.find((statute) => normalise(statute.cite) === wanted);
}

const normalise = (cite: string): string => cite.toLowerCase().replace(/[^a-z0-9]/g, '');

/* ------------------------------------------------------------------ */
/* What the screen has to say about an unchecked table                 */
/* ------------------------------------------------------------------ */

export const UNVERIFIED_NOTICE =
  'Nobody here has checked this against the published code yet. Legislatures renumber and re-grade offences every session — confirm the cite before it goes on a charging document.';

export const TABLE_NOTICE =
  'These are a starting point, not authority. An administrator checks each one against the state’s published code and marks it verified; anything unchecked is flagged wherever it is offered.';

/* ------------------------------------------------------------------ */
/* Checking the table itself                                           */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
}

const good: Check = { ok: true, reason: '', field: '' };

export function checkStatute(statute: Statute, others: Statute[] = []): Check {
  if (!statute.cite.trim()) {
    return { ok: false, reason: 'A statute needs its cite.', field: 'cite' };
  }
  if (!statute.title.trim()) {
    return {
      ok: false,
      reason: 'What is this offence called?',
      field: 'title',
    };
  }
  const clash = others.find(
    (other) => other.id !== statute.id && normalise(other.cite) === normalise(statute.cite),
  );
  if (clash) {
    return {
      ok: false,
      reason: `${clash.cite} is already in the table. Add the NIBRS codes to that one rather than a second copy.`,
      field: 'cite',
    };
  }
  if (statute.offenseCodes.length === 0) {
    return {
      ok: false,
      reason: 'Which offences can be charged under this?',
      field: 'offenseCodes',
    };
  }
  return good;
}

/** Entries nobody has checked, which is what the setup screen counts. */
export function unverified(statutes: Statute[]): Statute[] {
  return statutes.filter((statute) => !isVerified(statute));
}
