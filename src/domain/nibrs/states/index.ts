/**
 * The state registry.
 *
 * Adding a state is: write the pack, add one line here. Nothing else in the
 * system learns about it.
 */

import type { StateProfile } from '../spec';
import { NATIONAL } from './national';
import { SOUTH_CAROLINA } from './sc';
import { NEW_HAMPSHIRE } from './nh';

export const STATE_PROFILES: StateProfile[] = [SOUTH_CAROLINA, NEW_HAMPSHIRE];

/**
 * The profile for an agency's state, or the national baseline.
 *
 * Falling back rather than refusing is deliberate: an agency in a state with no
 * pack yet can still produce a federal-shape file and see what is in it. The
 * export screen says plainly which profile it used, so nobody mistakes the
 * fallback for a state submission.
 */
export function profileFor(stateCode: string): StateProfile {
  const code = (stateCode || '').trim().toUpperCase();
  return STATE_PROFILES.find((p) => p.code === code) ?? NATIONAL;
}

/** True when the state has a pack of its own rather than the fallback. */
export function hasProfile(stateCode: string): boolean {
  const code = (stateCode || '').trim().toUpperCase();
  return STATE_PROFILES.some((p) => p.code === code);
}

export { NATIONAL, SOUTH_CAROLINA, NEW_HAMPSHIRE };
