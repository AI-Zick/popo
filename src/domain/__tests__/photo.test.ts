import { describe, expect, it } from 'vitest';
import {
  canDecide,
  canRequestRemoval,
  createPhoto,
  currentPhoto,
  isVisible,
  pendingRemovals,
  photoAge,
  photosFor,
  photoWarning,
  sortPhotos,
  type PersonPhoto,
} from '../photo';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();
const yearsAgo = (n: number) => `${2026 - n}-09-03`;

function photo(partial: Partial<PersonPhoto> = {}): PersonPhoto {
  return createPhoto({ id: 'ph-1', masterId: 'mp-1', takenOn: yearsAgo(1), ...partial });
}

describe('how current a photograph is', () => {
  it('treats a face as lasting longer than a phone number', () => {
    // Eighteen months would be "aging" for an address; a face is still a face.
    expect(photoAge(photo({ takenOn: yearsAgo(1) }), NOW).worthChecking).toBe(false);
  });

  it('says something once it is old enough to mislead', () => {
    const old = photoAge(photo({ takenOn: yearsAgo(7) }), NOW);
    expect(old.worthChecking).toBe(true);
    expect(old.label).toBe('7 years old');
  });

  it('never reports an undated photograph as current', () => {
    const unknown = photoAge(photo({ takenOn: '' }), NOW);
    expect(unknown.level).toBe('unknown');
    expect(unknown.worthChecking).toBe(true);
  });
});

describe('what the officer is told', () => {
  it('says nothing about a recent one', () => {
    expect(photoWarning(photo({ takenOn: yearsAgo(1) }), NOW)).toBe('');
  });

  it('warns about an old one rather than hiding it', () => {
    expect(photoWarning(photo({ takenOn: yearsAgo(8) }), NOW)).toContain('8 years old');
  });

  it('is explicit that an undated photograph could be from any time', () => {
    expect(photoWarning(photo({ takenOn: '' }), NOW)).toContain('no date');
  });

  it('says so when there is nothing on file', () => {
    expect(photoWarning(null, NOW)).toBe('No photograph on file.');
  });
});

describe('which one goes on the record', () => {
  it('picks the most recent likeness', () => {
    const chosen = currentPhoto([
      photo({ id: 'old', takenOn: yearsAgo(6) }),
      photo({ id: 'new', takenOn: yearsAgo(1) }),
    ]);
    expect(chosen?.id).toBe('new');
  });

  it('prefers any dated photograph over an undated one', () => {
    const chosen = currentPhoto([
      photo({ id: 'undated', takenOn: '' }),
      photo({ id: 'ancient', takenOn: yearsAgo(12) }),
    ]);
    expect(chosen?.id).toBe('ancient');
  });

  it('skips one that has been taken down', () => {
    const chosen = currentPhoto([
      photo({ id: 'gone', takenOn: yearsAgo(1), removal: 'removed' }),
      photo({ id: 'standing', takenOn: yearsAgo(4) }),
    ]);
    expect(chosen?.id).toBe('standing');
  });

  it('still shows one that has only been questioned', () => {
    // A takedown request must not be a way to quietly clear a record.
    const chosen = currentPhoto([photo({ id: 'asked', removal: 'requested' })]);
    expect(chosen?.id).toBe('asked');
  });

  it('returns nothing when every one is down', () => {
    expect(currentPhoto([photo({ removal: 'removed' })])).toBeNull();
  });

  it('returns nothing when there are none', () => {
    expect(currentPhoto([])).toBeNull();
  });
});

describe('sorting', () => {
  it('breaks a tie on when it was added', () => {
    const list = sortPhotos([
      photo({ id: 'first', takenOn: yearsAgo(1), addedAt: '2026-01-01T00:00:00.000Z' }),
      photo({ id: 'second', takenOn: yearsAgo(1), addedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(list.map((p) => p.id)).toEqual(['second', 'first']);
  });

  it('does not change the array it was given', () => {
    const list = [photo({ id: 'a', takenOn: yearsAgo(5) }), photo({ id: 'b', takenOn: yearsAgo(1) })];
    sortPhotos(list);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('one person’s photographs', () => {
  it('picks out only theirs', () => {
    const list = photosFor(
      [photo({ id: 'mine', masterId: 'mp-1' }), photo({ id: 'theirs', masterId: 'mp-2' })],
      'mp-1',
    );
    expect(list.map((p) => p.id)).toEqual(['mine']);
  });

  it('includes the ones taken down, so the history is visible', () => {
    const list = photosFor([photo({ id: 'gone', removal: 'removed' })], 'mp-1');
    expect(list).toHaveLength(1);
    expect(isVisible(list[0])).toBe(false);
  });
});

describe('asking for one to come down', () => {
  it('lets anyone ask', () => {
    expect(canRequestRemoval(photo()).ok).toBe(true);
  });

  it('refuses a second request, and says who already asked', () => {
    const asked = photo({ removal: 'requested', requestedByName: 'M. Reyes' });
    const check = canRequestRemoval(asked);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('M. Reyes');
  });

  it('refuses asking about one that is already down', () => {
    expect(canRequestRemoval(photo({ removal: 'removed' })).ok).toBe(false);
  });

  it('lets it be asked about again after it was kept', () => {
    // A "no" is not permanent; the picture may be wrong for a new reason.
    expect(canRequestRemoval(photo({ removal: 'kept' })).ok).toBe(true);
  });
});

describe('deciding', () => {
  it('needs something to have been asked', () => {
    expect(canDecide(photo()).ok).toBe(false);
    expect(canDecide(photo({ removal: 'requested' })).ok).toBe(true);
  });

  it('queues what is waiting, oldest first', () => {
    const queue = pendingRemovals([
      photo({ id: 'newer', removal: 'requested', requestedAt: '2026-09-02T00:00:00.000Z' }),
      photo({ id: 'older', removal: 'requested', requestedAt: '2026-09-01T00:00:00.000Z' }),
      photo({ id: 'settled', removal: 'kept' }),
    ]);
    expect(queue.map((p) => p.id)).toEqual(['older', 'newer']);
  });
});
