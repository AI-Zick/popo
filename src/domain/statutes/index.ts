import type { Statute } from '../statute';
import { AL_STATUTES } from './al';

/**
 * The statute tables a new agency can start from, by state.
 *
 * One state so far, and that is deliberate rather than unfinished. A statute
 * pack is not a data-entry exercise: it is a reading of a state's criminal
 * code, mapped onto the NIBRS offences that trigger each section, and doing it
 * badly is worse than not doing it — an officer who trusts a wrong cite files
 * a charge under the wrong section, and an officer who finds two wrong ones
 * stops using the list at all.
 *
 * So the shape is the deliverable here. Adding a state is a file like `al.ts`
 * and one line below; nothing else in the system needs to know about it. An
 * agency in a state with no pack gets an empty table and can fill it in, which
 * is the same position they are in today with a free-text field, except that
 * what they type once is then offered to everybody else in the department.
 */
const PACKS: Record<string, Statute[]> = {
  AL: AL_STATUTES,
};

/** The starting table for a state, or nothing where there is no pack yet. */
export function statutePack(stateCode: string): Statute[] {
  return (PACKS[stateCode.trim().toUpperCase()] ?? []).map((statute) => ({ ...statute }));
}

/** Whether a state has a pack at all, for the setup screen to say so. */
export function hasStatutePack(stateCode: string): boolean {
  return statutePack(stateCode).length > 0;
}

/** States a pack exists for, so setup can say which. */
export const PACKED_STATES = Object.keys(PACKS);
