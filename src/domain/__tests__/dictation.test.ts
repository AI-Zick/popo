import { describe, expect, it } from 'vitest';
import { appendTranscript, cleanTranscript, insertTranscript } from '../dictation';

describe('spoken punctuation', () => {
  it('turns the words people say into the marks they mean', () => {
    expect(cleanTranscript('i knocked comma nobody answered period')).toBe(
      'I knocked, nobody answered.',
    );
  });

  it('does the longer command first', () => {
    expect(cleanTranscript('did you see him question mark')).toBe('Did you see him?');
  });

  it('takes new paragraph as a blank line', () => {
    expect(cleanTranscript('i cleared the scene period new paragraph i then returned')).toBe(
      'I cleared the scene.\n\nI then returned',
    );
  });

  it('leaves the word alone inside another word', () => {
    // A comma-separated list is a phrase an officer might genuinely say.
    expect(cleanTranscript('a comma-separated list')).toBe('A comma-separated list');
  });

  it('pulls the mark back onto the word before it', () => {
    expect(cleanTranscript('one period two period')).toBe('One. Two.');
  });
});

describe('capitalisation', () => {
  it('starts the text with a capital', () => {
    expect(cleanTranscript('on the above date')).toBe('On the above date');
  });

  it('starts each sentence with one', () => {
    expect(cleanTranscript('he ran period i followed period')).toBe('He ran. I followed.');
  });

  it('never lowers a letter somebody meant to capitalise', () => {
    expect(cleanTranscript('I met Sgt. Alvarez at the door')).toBe('I met Sgt. Alvarez at the door');
  });
});

describe('the words a general model gets wrong', () => {
  it('fixes the ones that are unambiguous in a report', () => {
    expect(cleanTranscript('i ran him through ncic and issued a bolo')).toBe(
      'I ran him through NCIC and issued a BOLO',
    );
    expect(cleanTranscript('he was mirandized at the scene')).toBe(
      'He was Mirandized at the scene',
    );
  });

  it('handles the letters being dictated with stops in them', () => {
    expect(cleanTranscript('the v.i.n. was obscured')).toBe('The VIN was obscured');
  });
});

describe('joining onto what is already written', () => {
  it('starts a new sentence with a capital after a full stop', () => {
    expect(appendTranscript('I knocked twice.', 'nobody answered period')).toBe(
      'I knocked twice. Nobody answered.',
    );
  });

  it('carries on in lower case mid-sentence', () => {
    expect(appendTranscript('I knocked twice and', 'nobody answered period')).toBe(
      'I knocked twice and nobody answered.',
    );
  });

  it('does not put a space after a paragraph break', () => {
    expect(appendTranscript('I cleared the scene.\n\n', 'i then returned')).toBe(
      'I cleared the scene.\n\nI then returned',
    );
  });

  it('leaves an empty field as a first sentence', () => {
    expect(appendTranscript('', 'on the above date')).toBe('On the above date');
  });

  it('adds nothing when nothing was said', () => {
    expect(appendTranscript('I knocked.', '   ')).toBe('I knocked.');
  });
});

describe('putting words in at the caret', () => {
  it('inserts mid-text and reports where the caret should land', () => {
    const { text, caret } = insertTranscript('I knocked. I left.', 'nobody answered period', 11);
    expect(text).toBe('I knocked. Nobody answered. I left.');
    expect(text.slice(0, caret)).toBe('I knocked. Nobody answered.');
  });

  it('appends when the caret is at the end', () => {
    const { text, caret } = insertTranscript('I knocked.', 'i left period', 10);
    expect(text).toBe('I knocked. I left.');
    expect(caret).toBe(text.length);
  });

  it('clamps a caret past the end rather than losing the text', () => {
    expect(insertTranscript('I knocked.', 'i left period', 999).text).toBe('I knocked. I left.');
  });

  it('does not double a space before punctuation that follows', () => {
    const { text } = insertTranscript('I knocked. I left.', 'twice', 9);
    expect(text).toBe('I knocked twice. I left.');
  });
});

describe('things that must not be mangled', () => {
  it('leaves an abbreviation that was already right alone', () => {
    expect(cleanTranscript('checked NCIC and CAD')).toBe('Checked NCIC and CAD');
  });

  it('matches two spoken commands in a row', () => {
    expect(cleanTranscript('he ran period new line i followed')).toBe('He ran.\nI followed');
  });

  it('does not find a command inside a longer word', () => {
    expect(cleanTranscript('the periodic check')).toBe('The periodic check');
    expect(cleanTranscript('vinyl siding')).toBe('Vinyl siding');
  });

  it('keeps a blank chunk blank', () => {
    expect(cleanTranscript('   ')).toBe('');
  });
});

describe('the first person', () => {
  it('capitalises a lone i, which every engine gets wrong', () => {
    expect(cleanTranscript('i knocked and i waited')).toBe('I knocked and I waited');
  });

  it('leaves it alone inside a word', () => {
    expect(cleanTranscript('the victim in the initial call')).toBe(
      'The victim in the initial call',
    );
  });

  it('does not touch a capital I that is already there', () => {
    expect(cleanTranscript('I knocked')).toBe('I knocked');
  });
});
