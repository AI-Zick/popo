/**
 * Turning what an officer said into what a report should read like.
 *
 * A speech engine hands back lowercase words with no punctuation: "on the
 * above date and time i was dispatched to six twelve north marion street
 * period". Dropping that into a narrative unedited produces something a
 * defence attorney reads aloud in court, so the raw transcript is cleaned up
 * here before it reaches the field.
 *
 * The spoken commands are the ones every dictation user already knows from
 * Dragon, because officers who have dictated before will say "period" whether
 * this file handles it or not — and an officer who says "period" and gets the
 * word "period" stops using the feature that minute.
 *
 * Everything here is a pure function of a string. The microphone, the browser
 * API and the permission prompt live in the hook that calls this; none of that
 * is testable and all of this is.
 */

/**
 * Spoken words that mean punctuation.
 *
 * Matched only when the word stands alone — surrounded by whitespace or the
 * ends of the chunk, not by `\b`, which counts a hyphen as a boundary and
 * would turn "a comma-separated list" into "a, -separated list". Longer
 * commands come first so "question mark" is taken before "question" could be.
 */
const SPOKEN: [RegExp, string][] = [
  [alone('full stop|period'), '.'],
  [alone('comma'), ','],
  [alone('question mark'), '?'],
  [alone('exclamation (?:mark|point)'), '!'],
  [alone('colon'), ':'],
  [alone('semicolon'), ';'],
  [alone('new paragraph|next paragraph'), '\n\n'],
  [alone('new line|next line'), '\n'],
];

/** A phrase standing on its own, so consecutive commands still both match. */
function alone(phrase: string): RegExp {
  return new RegExp(`(?<=^|\\s)(?:${phrase})(?=\\s|$)`, 'gi');
}

/**
 * One chunk of speech, ready to drop into a narrative.
 *
 * Punctuation is pulled back onto the word before it, sentences are
 * capitalised, and the police shorthand a speech engine always gets wrong is
 * put right.
 */
export function cleanTranscript(raw: string): string {
  return capitaliseFirst(clean(raw));
}

/**
 * Everything except the opening capital.
 *
 * Split out because whether the first word gets a capital depends on where the
 * chunk lands: starting a narrative it does, carrying on after "I knocked
 * twice and" it must not.
 */
function clean(raw: string): string {
  let text = raw;
  for (const [pattern, mark] of SPOKEN) text = text.replace(pattern, mark);

  /*
    Abbreviations first. "v.i.n." has to become "VIN" while its stops are still
    joined up — a moment later the spacing pass would have made it "v. i. n.",
    and after that no rule could tell it from three sentences.
  */
  text = fixTerms(text);

  text = text
    // " ." → "." — the engine gives every token a leading space.
    .replace(/\s+([.,?!:;])/g, '$1')
    // A mark is followed by one space, and a newline by none.
    .replace(/([.,?!:;])(?=\S)/g, '$1 ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');

  return capitaliseSentences(text).trim();
}

/**
 * Joins a chunk onto what is already written.
 *
 * The join is the fiddly part: a chunk that starts mid-sentence needs a space
 * and no capital, one that starts a sentence needs the capital, and one that
 * follows a paragraph break needs neither a space nor anything stripped.
 */
export function appendTranscript(existing: string, chunk: string): string {
  const spoken = clean(chunk);
  if (!spoken) return existing;
  if (!existing.trim()) return capitaliseFirst(spoken);

  const endsSentence = /[.!?]["')\]]?\s*$/.test(existing);
  const endsBlank = /\n\s*$/.test(existing);
  // Mid-sentence the chunk carries on in whatever case it was said in, so a
  // name or an abbreviation keeps its capital and an ordinary word does not
  // gain one.
  const text = endsSentence || endsBlank ? capitaliseFirst(spoken) : spoken;

  return endsBlank ? existing + text : `${existing.replace(/\s+$/, '')} ${text}`;
}

/**
 * Puts a chunk in at the caret rather than at the end.
 *
 * Officers dictate a draft and then go back to add a sentence in the middle of
 * it. Returns the new text and where the caret should sit afterwards, so the
 * next words go after the ones just spoken and not back at the insertion point.
 */
export function insertTranscript(
  existing: string,
  chunk: string,
  at: number,
): { text: string; caret: number } {
  const cut = Math.max(0, Math.min(at, existing.length));
  if (cut >= existing.length) {
    const text = appendTranscript(existing, chunk);
    return { text, caret: text.length };
  }

  const before = existing.slice(0, cut);
  const after = existing.slice(cut);
  const head = appendTranscript(before, chunk);
  const gap = /^[\s.,?!:;]/.test(after) ? '' : ' ';
  return { text: head + gap + after, caret: head.length };
}

/**
 * Words a general speech model reliably gets wrong in police dictation.
 *
 * Deliberately short. Every entry is a word that means one thing on the radio
 * and another in a dictionary, and the cost of a wrong entry is an officer
 * finding their own words changed — so nothing goes in here that is not
 * unambiguous in a report.
 */
const WORDS: [RegExp, string][] = [
  /*
    The one that matters most, and the one every engine gets wrong. A narrative
    is written in the first person and half its sentences begin with it, so a
    transcript full of lowercase "i" is the thing an officer would have to fix
    by hand on every line — which is the same as not having dictation.
  */
  [/\bi\b/g, 'I'],
  [/\bmirandized\b/gi, 'Mirandized'],
  [/\bmiranda\b/gi, 'Miranda'],
  [/\bnarc[ao]n\b/gi, 'Narcan'],
  [/\btazer\b/gi, 'Taser'],
];

/**
 * Abbreviations, in both the forms a speech engine produces.
 *
 * Dictated letter by letter they come back with stops — "n.c.i.c." — and the
 * trailing stop is consumed with the rest, because it is part of the
 * abbreviation and not the end of a sentence: an officer ending a sentence
 * there would have said "period".
 */
const ABBREVIATIONS = ['NCIC', 'BOLO', 'DUI', 'VIN', 'CAD'];

const ABBREVIATION_PATTERNS: [RegExp, string][] = ABBREVIATIONS.flatMap((word) => [
  [new RegExp(`\\b${word.split('').join('\\.')}\\.?`, 'gi'), word],
  [new RegExp(`\\b${word}\\b`, 'gi'), word],
]);

function fixTerms(text: string): string {
  let out = text;
  for (const [pattern, replacement] of [...ABBREVIATION_PATTERNS, ...WORDS]) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Capitalises the letter that starts each sentence after the first one.
 *
 * Only ever raises a letter, never lowers one: "I met Sgt. Alvarez" must not
 * come back as "I met sgt. alvarez" because a full stop appeared mid-name.
 */
function capitaliseSentences(text: string): string {
  return text.replace(/([.!?]\s+|\n\s*)([a-z])/g, (_, lead: string, letter: string) =>
    lead + letter.toUpperCase(),
  );
}

function capitaliseFirst(text: string): string {
  return text.replace(/^([a-z])/, (letter) => letter.toUpperCase());
}
