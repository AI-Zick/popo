import { describe, expect, it } from 'vitest';
import {
  autoLinkLocation,
  findLocations,
  parseAddress,
  scoreLocation,
  searchLocations,
} from '../locationMatching';
import { emptyLocation, type LocationIndex, type MasterLocation } from '../location';

function loc(partial: Partial<MasterLocation>): MasterLocation {
  return { ...emptyLocation(partial.id ?? 'l1'), ...partial };
}

const STORAGE = loc({
  id: 'storage',
  commonName: 'Marion Street Self Storage',
  aliases: ['Marion Storage', 'The storage place on Marion'],
  address: '612 N Marion St',
  city: 'Cedar Falls',
  state: 'AL',
  zip: '35004',
  locationType: '25',
  hasUnits: true,
  unitLabel: 'Unit',
});

const HOUSE = loc({
  id: 'house',
  address: '1142 Ashwood Ln',
  city: 'Cedar Falls',
  state: 'AL',
  locationType: '20',
});

const index = (...items: MasterLocation[]): LocationIndex =>
  Object.fromEntries(items.map((l) => [l.id, l]));

describe('parsing', () => {
  it('splits a house number from the street', () => {
    expect(parseAddress('1142 Ashwood Lane')).toMatchObject({ number: '1142', street: 'ASHWOOD LN' });
  });

  it('understands a block-level address', () => {
    expect(parseAddress('600 block N Marion Street')).toMatchObject({
      number: '600',
      street: 'N MARION ST',
    });
  });

  it('handles a location with no house number', () => {
    expect(parseAddress('US-411 at Watson Rd').number).toBe('');
  });
});

describe('one place, one record', () => {
  it('treats a differently abbreviated address as the same place', () => {
    const match = scoreLocation(
      { address: '612 North Marion Street', city: 'Cedar Falls' },
      STORAGE,
    );
    expect(match?.tier).toBe('certain');
    expect(match?.reasons).toContain('Same address');
  });

  it('links automatically on an exact address', () => {
    const matches = findLocations({ address: '612 N Marion St', city: 'Cedar Falls' }, index(STORAGE, HOUSE));
    expect(autoLinkLocation(matches)?.location.id).toBe('storage');
  });

  it('finds the facility by the name officers use for it', () => {
    const matches = findLocations({ commonName: 'Marion Storage' }, index(STORAGE, HOUSE));
    expect(matches[0].location.id).toBe('storage');
    expect(matches[0].reasons).toContain('Known by this name');
  });

  it('catches a misspelt street at the same number', () => {
    const match = scoreLocation({ address: '612 N Marrion St', city: 'Cedar Falls' }, STORAGE);
    expect(match).not.toBeNull();
    expect(match?.reasons).toContain('Same number, street spelt differently');
  });
});

describe('not over-matching', () => {
  it('does not merge two houses on the same street', () => {
    const other = loc({ id: 'other', address: '1150 Ashwood Ln', city: 'Cedar Falls' });
    const match = scoreLocation({ address: '1142 Ashwood Ln', city: 'Cedar Falls' }, other);
    expect(match?.tier ?? 'none').not.toBe('certain');
    expect(match?.tier ?? 'none').not.toBe('strong');
  });

  it('does not match the same street name in a different city', () => {
    const elsewhere = loc({ id: 'elsewhere', address: '612 N Marion St', city: 'Birmingham' });
    const match = scoreLocation({ address: '612 N Marion St', city: 'Cedar Falls' }, elsewhere);
    expect(match?.tier ?? 'none').not.toBe('certain');
  });

  it('does not match an unrelated address', () => {
    expect(scoreLocation({ address: '88 Perch St', city: 'Cedar Falls' }, STORAGE)).toBeNull();
  });

  it('returns nothing with no address or name to go on', () => {
    expect(findLocations({ city: 'Cedar Falls' }, index(STORAGE))).toEqual([]);
  });

  it('refuses to auto-link when the index already holds two identical records', () => {
    const dup = loc({ ...STORAGE, id: 'storage2' });
    const matches = findLocations(
      { address: '612 N Marion St', city: 'Cedar Falls' },
      index(STORAGE, dup),
    );
    expect(autoLinkLocation(matches)).toBeNull();
  });
});

describe('search box behaviour', () => {
  it('finds a place by part of its address', () => {
    expect(searchLocations('612 marion', index(STORAGE, HOUSE)).map((l) => l.id)).toEqual(['storage']);
  });

  it('finds a place by an alias', () => {
    expect(searchLocations('marion storage', index(STORAGE, HOUSE)).map((l) => l.id)).toEqual([
      'storage',
    ]);
  });

  it('requires every term to match, so one term does not drag in the street', () => {
    const neighbour = loc({ id: 'neighbour', address: '640 N Marion St', city: 'Cedar Falls' });
    const results = searchLocations('marion storage', index(STORAGE, neighbour));
    expect(results.map((l) => l.id)).toEqual(['storage']);
  });

  it('returns everything when the box is empty', () => {
    expect(searchLocations('', index(STORAGE, HOUSE))).toHaveLength(2);
  });
});
