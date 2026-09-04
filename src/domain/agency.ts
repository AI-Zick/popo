/**
 * Agency configuration, set once at install.
 *
 * Two things come out of knowing where a department polices. The obvious one is
 * defaults — nobody should type "Cedar Falls, AL" four hundred times a year.
 * The useful one is that a beat can be *derived* from a point on a map instead
 * of recalled from memory, which is where it currently goes wrong.
 */

import type { GeoFeatureCollection } from './geo';
import { DEFAULT_CHECKLIST, type ChecklistItem } from './fleet';
import { DEFAULT_SCHEDULE, type RetentionRule } from './retention';
import { DEFAULT_RULES, type ExemptionRule } from './exemption';
import { defaultPolicy, type PublicRecordsPolicy } from './publicRecords';

export interface AgencyProfile {
  name: string;
  /** ORI — the FBI's identifier for the agency, required on every submission. */
  ori: string;

  /**
   * An identifier some state programs assign in addition to the ORI, and
   * require on every record. Blank where the state does not use one — the
   * state profile says whether it is needed.
   */
  stateAgencyCode: string;

  /** Jurisdiction. New locations default to these. */
  city: string;
  county: string;
  state: string;
  zip: string;

  /**
   * What this agency calls its patrol areas. Departments variously say beat,
   * zone, district or reporting district, and using the wrong word makes
   * software feel foreign on day one.
   */
  zoneLabel: string;

  /** Outer jurisdiction boundary — used to flag calls outside it. */
  boundary: GeoFeatureCollection | null;
  /** Patrol areas within the jurisdiction. */
  zones: GeoFeatureCollection | null;

  /**
   * What the daily cruiser check asks.
   *
   * Configuration rather than code, because it is the agency's business: a
   * department with rifles in the cars checks the rifle and one without does
   * not, and a fixed list would have half its users ticking a box that means
   * nothing to them. Seeded from a sensible default so the feature works on
   * day one — an empty checklist is a feature nobody turns on.
   */
  checklist: ChecklistItem[];

  /**
   * How long each kind of record is kept.
   *
   * State law, so the numbers shipped are a starting point and every one of
   * them arrives with its authority field blank — an agency that has not
   * filled that in has not yet decided. Nothing is destroyed on this
   * schedule; it decides what appears in a queue for somebody to look at.
   */
  retention: RetentionRule[];

  /**
   * What may be withheld from a public records release, and on what authority.
   *
   * Configuration rather than code for the same reason the retention schedule
   * is: the exemptions are state law and no two states agree. Federal rules
   * arrive switched on and cited because they are not the agency's to change;
   * the state templates arrive switched off with blank citations, because a
   * rule nobody has read against their own statute is a rule that redacts the
   * wrong thing.
   */
  exemptions: ExemptionRule[];

  /**
   * How long the state gives the agency to answer, and how it counts.
   *
   * The number that decides whether a request is late, which is the failure
   * agencies are actually sued for. Ships at ten business days with a blank
   * authority — a starting point, not a policy, and the setup screen says so.
   */
  publicRecords: PublicRecordsPolicy;

  /**
   * Whether a second factor is required to sign in.
   *
   * On unless an agency deliberately turns it off, and turning it off is a
   * choice to run outside CJIS rather than a convenience setting — the screen
   * says so. Defaulting this to off until somebody configures it is how an
   * installation ends up without the control it was told to have.
   */
  requireMfa: boolean;

  /** False until someone has been through setup. */
  configured: boolean;
}

export const ZONE_LABELS = ['Beat', 'Zone', 'District', 'Reporting District', 'Sector'];

export function emptyAgency(): AgencyProfile {
  return {
    name: '',
    ori: '',
    stateAgencyCode: '',
    city: '',
    county: '',
    state: '',
    zip: '',
    zoneLabel: 'Beat',
    boundary: null,
    zones: null,
    checklist: DEFAULT_CHECKLIST.map((item, i) => ({ ...item, id: `chk${i + 1}` })),
    retention: DEFAULT_SCHEDULE.map((rule) => ({ ...rule })),
    exemptions: DEFAULT_RULES.map((rule) => ({ ...rule })),
    publicRecords: defaultPolicy(),
    requireMfa: true,
    configured: false,
  };
}
