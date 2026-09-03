/**
 * Agency configuration, set once at install.
 *
 * Two things come out of knowing where a department polices. The obvious one is
 * defaults — nobody should type "Cedar Falls, AL" four hundred times a year.
 * The useful one is that a beat can be *derived* from a point on a map instead
 * of recalled from memory, which is where it currently goes wrong.
 */

import type { GeoFeatureCollection } from './geo';

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
    configured: false,
  };
}
