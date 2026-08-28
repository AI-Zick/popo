/**
 * Reference data. Offense codes carry the structural flags that the validation
 * rules read, so "what does this case type require?" is data, not a switch
 * statement buried in a form component.
 */

export interface CodeOption {
  value: string;
  label: string;
  hint?: string;
}

export type OffenseCategory = 'person' | 'property' | 'society';

export interface OffenseCode {
  code: string;
  label: string;
  category: OffenseCategory;
  /** Group used for the picker's section headers */
  group: string;
  /** Requires at least one victim, and that victim must be a real person */
  requiresIndividualVictim?: boolean;
  /** Requires at least one property record */
  requiresProperty?: boolean;
  /** Property must carry a dollar value (theft-type offenses) */
  requiresPropertyValue?: boolean;
  /** Burglary: premises entered + method of entry apply */
  isBurglary?: boolean;
  /** Motor vehicle theft: requires a vehicle record */
  requiresVehicle?: boolean;
  /** Drug offense: requires drug type/quantity/measurement on property */
  isDrug?: boolean;
  /** Weapon must be recorded */
  requiresWeapon?: boolean;
  /** Criminal-activity type required (drug/weapon/gambling) */
  requiresCriminalActivity?: boolean;
  /** Arson / damage: requires a damaged or burned property record */
  requiresDamagedProperty?: boolean;
  /** Victim injury detail applies */
  collectsInjury?: boolean;
  /** Society is the only permitted victim type (victimless offenses) */
  societyVictimOnly?: boolean;
  /** Attempted is not a valid completion for this offense */
  completedOnly?: boolean;
}

export const OFFENSE_CODES: OffenseCode[] = [
  // ---- Crimes against person -------------------------------------------
  { code: '09A', label: 'Murder / Non-negligent Manslaughter', category: 'person', group: 'Homicide', requiresIndividualVictim: true, collectsInjury: true, requiresWeapon: true, completedOnly: true },
  { code: '09B', label: 'Negligent Manslaughter', category: 'person', group: 'Homicide', requiresIndividualVictim: true, collectsInjury: true, completedOnly: true },
  { code: '100', label: 'Kidnapping / Abduction', category: 'person', group: 'Violent', requiresIndividualVictim: true, collectsInjury: true },
  { code: '11A', label: 'Rape', category: 'person', group: 'Sex Offenses', requiresIndividualVictim: true, collectsInjury: true },
  { code: '11B', label: 'Sodomy', category: 'person', group: 'Sex Offenses', requiresIndividualVictim: true, collectsInjury: true },
  { code: '11D', label: 'Fondling', category: 'person', group: 'Sex Offenses', requiresIndividualVictim: true, collectsInjury: true },
  { code: '120', label: 'Robbery', category: 'property', group: 'Violent', requiresIndividualVictim: true, requiresProperty: true, requiresPropertyValue: true, collectsInjury: true, requiresWeapon: true },
  { code: '13A', label: 'Aggravated Assault', category: 'person', group: 'Assault', requiresIndividualVictim: true, collectsInjury: true, requiresWeapon: true },
  { code: '13B', label: 'Simple Assault', category: 'person', group: 'Assault', requiresIndividualVictim: true, collectsInjury: true },
  { code: '13C', label: 'Intimidation', category: 'person', group: 'Assault', requiresIndividualVictim: true },

  // ---- Crimes against property -----------------------------------------
  { code: '200', label: 'Arson', category: 'property', group: 'Arson & Damage', requiresDamagedProperty: true, requiresProperty: true },
  { code: '220', label: 'Burglary / Breaking & Entering', category: 'property', group: 'Burglary', isBurglary: true, requiresProperty: true },
  { code: '23A', label: 'Pocket-picking', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '23B', label: 'Purse-snatching', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '23C', label: 'Shoplifting', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '23D', label: 'Theft From Building', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '23F', label: 'Theft From Motor Vehicle', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '23H', label: 'All Other Larceny', category: 'property', group: 'Larceny / Theft', requiresProperty: true, requiresPropertyValue: true },
  { code: '240', label: 'Motor Vehicle Theft', category: 'property', group: 'Vehicle', requiresVehicle: true, requiresProperty: true, requiresPropertyValue: true },
  { code: '250', label: 'Counterfeiting / Forgery', category: 'property', group: 'Fraud', requiresProperty: true },
  { code: '26A', label: 'False Pretenses / Swindle / Con Game', category: 'property', group: 'Fraud', requiresProperty: true, requiresPropertyValue: true },
  { code: '26B', label: 'Credit Card / ATM Fraud', category: 'property', group: 'Fraud', requiresProperty: true, requiresPropertyValue: true },
  { code: '26C', label: 'Impersonation', category: 'property', group: 'Fraud' },
  { code: '270', label: 'Embezzlement', category: 'property', group: 'Fraud', requiresProperty: true, requiresPropertyValue: true },
  { code: '280', label: 'Stolen Property Offenses', category: 'property', group: 'Fraud', requiresProperty: true },
  { code: '290', label: 'Destruction / Damage / Vandalism', category: 'property', group: 'Arson & Damage', requiresDamagedProperty: true, requiresProperty: true },

  // ---- Crimes against society ------------------------------------------
  { code: '35A', label: 'Drug / Narcotic Violations', category: 'society', group: 'Drugs', isDrug: true, requiresProperty: true, requiresCriminalActivity: true, societyVictimOnly: true },
  { code: '35B', label: 'Drug Equipment Violations', category: 'society', group: 'Drugs', requiresProperty: true, requiresCriminalActivity: true, societyVictimOnly: true },
  { code: '39A', label: 'Betting / Wagering', category: 'society', group: 'Gambling', requiresCriminalActivity: true, societyVictimOnly: true },
  { code: '520', label: 'Weapon Law Violations', category: 'society', group: 'Weapons', requiresWeapon: true, requiresCriminalActivity: true, societyVictimOnly: true },
  { code: '90A', label: 'Bad Checks', category: 'society', group: 'Group B' },
  { code: '90C', label: 'Disorderly Conduct', category: 'society', group: 'Group B' },
  { code: '90D', label: 'Driving Under the Influence', category: 'society', group: 'Group B', societyVictimOnly: true },
  { code: '90F', label: 'Family Offenses, Nonviolent', category: 'society', group: 'Group B' },
  { code: '90Z', label: 'All Other Offenses', category: 'society', group: 'Group B' },
];

export const OFFENSE_BY_CODE = new Map(OFFENSE_CODES.map((o) => [o.code, o]));

export function offenseLabel(code: string): string {
  const o = OFFENSE_BY_CODE.get(code);
  return o ? `${o.code} — ${o.label}` : code || 'Unspecified offense';
}

/* ------------------------------------------------------------------ */

export const LOCATION_TYPES: CodeOption[] = [
  { value: '01', label: 'Air / Bus / Train Terminal' },
  { value: '02', label: 'Bank / Savings & Loan' },
  { value: '03', label: 'Bar / Nightclub' },
  { value: '04', label: 'Church / Synagogue / Temple' },
  { value: '05', label: 'Commercial / Office Building' },
  { value: '07', label: 'Convenience Store' },
  { value: '08', label: 'Department / Discount Store' },
  { value: '09', label: 'Drug Store / Doctor Office / Hospital' },
  { value: '13', label: 'Highway / Road / Alley / Street' },
  { value: '14', label: 'Hotel / Motel' },
  { value: '15', label: 'Jail / Prison' },
  { value: '16', label: 'Lake / Waterway' },
  { value: '17', label: 'Liquor Store' },
  { value: '18', label: 'Parking Lot / Garage' },
  { value: '20', label: 'Residence / Home' },
  { value: '21', label: 'Restaurant' },
  { value: '22', label: 'School / College' },
  { value: '23', label: 'Service / Gas Station' },
  { value: '24', label: 'Specialty Store' },
  { value: '25', label: 'Other / Unknown' },
];

export const STATES: CodeOption[] = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
].map((s) => ({ value: s, label: s }));

export const VICTIM_TYPES: CodeOption[] = [
  { value: 'I', label: 'Individual', hint: 'A natural person' },
  { value: 'B', label: 'Business' },
  { value: 'F', label: 'Financial Institution' },
  { value: 'G', label: 'Government' },
  { value: 'L', label: 'Law Enforcement Officer' },
  { value: 'R', label: 'Religious Organization' },
  { value: 'S', label: 'Society / Public', hint: 'Used for victimless offenses' },
  { value: 'O', label: 'Other' },
];

export const INJURY_TYPES: CodeOption[] = [
  { value: 'N', label: 'None' },
  { value: 'M', label: 'Apparent Minor Injury' },
  { value: 'B', label: 'Apparent Broken Bones' },
  { value: 'I', label: 'Possible Internal Injury' },
  { value: 'L', label: 'Severe Laceration' },
  { value: 'T', label: 'Loss of Teeth' },
  { value: 'O', label: 'Other Major Injury' },
  { value: 'U', label: 'Unconsciousness' },
];

export const WEAPONS: CodeOption[] = [
  { value: '11', label: 'Firearm (type not stated)' },
  { value: '12', label: 'Handgun' },
  { value: '13', label: 'Rifle' },
  { value: '14', label: 'Shotgun' },
  { value: '15', label: 'Other Firearm' },
  { value: '20', label: 'Knife / Cutting Instrument' },
  { value: '30', label: 'Blunt Object' },
  { value: '35', label: 'Motor Vehicle' },
  { value: '40', label: 'Personal Weapons (hands, feet)' },
  { value: '50', label: 'Poison' },
  { value: '60', label: 'Explosives' },
  { value: '65', label: 'Fire / Incendiary Device' },
  { value: '70', label: 'Drugs / Narcotics / Sleeping Pills' },
  { value: '85', label: 'Asphyxiation' },
  { value: '90', label: 'Other' },
  { value: '95', label: 'Unknown' },
  { value: '99', label: 'None' },
];

export const RELATIONSHIPS: CodeOption[] = [
  { value: 'SE', label: 'Victim was Spouse' },
  { value: 'CS', label: 'Victim was Common-Law Spouse' },
  { value: 'PA', label: 'Victim was Parent' },
  { value: 'SB', label: 'Victim was Sibling' },
  { value: 'CH', label: 'Victim was Child' },
  { value: 'GP', label: 'Victim was Grandparent' },
  { value: 'GC', label: 'Victim was Grandchild' },
  { value: 'IL', label: 'Victim was In-Law' },
  { value: 'SP', label: 'Victim was Stepparent' },
  { value: 'SC', label: 'Victim was Stepchild' },
  { value: 'SS', label: 'Victim was Stepsibling' },
  { value: 'OF', label: 'Victim was Other Family Member' },
  { value: 'BG', label: 'Victim was Boyfriend / Girlfriend' },
  { value: 'XS', label: 'Victim was Ex-Spouse' },
  { value: 'FR', label: 'Victim was Friend' },
  { value: 'NE', label: 'Victim was Neighbor' },
  { value: 'BE', label: 'Victim was Babysittee' },
  { value: 'AQ', label: 'Victim was Acquaintance' },
  { value: 'CF', label: 'Victim was Child of Boyfriend/Girlfriend' },
  { value: 'HR', label: 'Homosexual Relationship' },
  { value: 'OK', label: 'Victim was Otherwise Known' },
  { value: 'RU', label: 'Relationship Unknown' },
  { value: 'ST', label: 'Victim was Stranger' },
];

/** Relationship codes that mark an incident as domestic violence. */
export const DOMESTIC_RELATIONSHIPS = new Set([
  'SE', 'CS', 'PA', 'SB', 'CH', 'GP', 'GC', 'IL', 'SP', 'SC', 'SS', 'OF', 'BG', 'XS', 'CF',
]);

export const PROPERTY_DESCRIPTIONS: CodeOption[] = [
  { value: '01', label: 'Aircraft' },
  { value: '03', label: 'Automobile' },
  { value: '04', label: 'Bicycle' },
  { value: '05', label: 'Buses' },
  { value: '06', label: 'Clothes / Furs' },
  { value: '07', label: 'Computer Hardware / Software' },
  { value: '08', label: 'Consumable Goods' },
  { value: '09', label: 'Credit / Debit Cards' },
  { value: '10', label: 'Drugs / Narcotics' },
  { value: '11', label: 'Drug / Narcotic Equipment' },
  { value: '12', label: 'Farm Equipment' },
  { value: '13', label: 'Firearms' },
  { value: '14', label: 'Gambling Equipment' },
  { value: '15', label: 'Heavy Construction / Industrial Equipment' },
  { value: '16', label: 'Household Goods' },
  { value: '17', label: 'Jewelry / Precious Metals' },
  { value: '18', label: 'Livestock' },
  { value: '20', label: 'Money' },
  { value: '21', label: 'Negotiable Instruments' },
  { value: '22', label: 'Nonnegotiable Instruments' },
  { value: '23', label: 'Office-Type Equipment' },
  { value: '24', label: 'Other Motor Vehicles' },
  { value: '26', label: 'Radios / TVs / VCRs / Cameras' },
  { value: '27', label: 'Recordings — Audio / Visual' },
  { value: '28', label: 'Recreational Vehicles' },
  { value: '29', label: 'Structures — Single Occupancy Dwelling' },
  { value: '30', label: 'Structures — Other Dwellings' },
  { value: '31', label: 'Structures — Commercial / Business' },
  { value: '35', label: 'Structures — Other' },
  { value: '36', label: 'Tools' },
  { value: '37', label: 'Trucks' },
  { value: '38', label: 'Vehicle Parts / Accessories' },
  { value: '39', label: 'Watercraft' },
  { value: '41', label: 'Cell Phones' },
  { value: '77', label: 'Other' },
  { value: '88', label: 'Pending Inventory' },
];

/** Property description codes that represent a vehicle. */
export const VEHICLE_PROPERTY_CODES = new Set(['03', '05', '24', '28', '37']);
/** Property description codes that represent a structure (arson/damage). */
export const STRUCTURE_PROPERTY_CODES = new Set(['29', '30', '31', '35']);

export const LOSS_TYPES: CodeOption[] = [
  { value: 'none', label: 'None' },
  { value: 'burned', label: 'Burned' },
  { value: 'counterfeit', label: 'Counterfeited / Forged' },
  { value: 'destroyed', label: 'Destroyed / Damaged / Vandalized' },
  { value: 'recovered', label: 'Recovered' },
  { value: 'seized', label: 'Seized' },
  { value: 'stolen', label: 'Stolen' },
  { value: 'unknown', label: 'Unknown' },
];

export const DRUG_TYPES: CodeOption[] = [
  { value: 'A', label: 'Crack Cocaine' },
  { value: 'B', label: 'Cocaine (all forms except crack)' },
  { value: 'C', label: 'Hashish' },
  { value: 'D', label: 'Heroin' },
  { value: 'E', label: 'Marijuana' },
  { value: 'F', label: 'Morphine' },
  { value: 'G', label: 'Opium' },
  { value: 'H', label: 'Other Narcotics' },
  { value: 'I', label: 'LSD' },
  { value: 'J', label: 'PCP' },
  { value: 'K', label: 'Other Hallucinogens' },
  { value: 'L', label: 'Amphetamines / Methamphetamines' },
  { value: 'M', label: 'Other Stimulants' },
  { value: 'N', label: 'Barbiturates' },
  { value: 'O', label: 'Other Depressants' },
  { value: 'P', label: 'Other Drugs' },
  { value: 'U', label: 'Unknown Drug Type' },
];

export const DRUG_MEASUREMENTS: CodeOption[] = [
  { value: 'GM', label: 'Gram' },
  { value: 'KG', label: 'Kilogram' },
  { value: 'OZ', label: 'Ounce' },
  { value: 'LB', label: 'Pound' },
  { value: 'ML', label: 'Milliliter' },
  { value: 'LT', label: 'Liter' },
  { value: 'FO', label: 'Fluid Ounce' },
  { value: 'GL', label: 'Gallon' },
  { value: 'DU', label: 'Dosage Unit / Item' },
  { value: 'NP', label: 'Number of Plants' },
  { value: 'XX', label: 'Not Reported' },
];

export const CRIMINAL_ACTIVITY: CodeOption[] = [
  { value: 'B', label: 'Buying / Receiving' },
  { value: 'C', label: 'Cultivating / Manufacturing / Publishing' },
  { value: 'D', label: 'Distributing / Selling' },
  { value: 'E', label: 'Exploiting Children' },
  { value: 'O', label: 'Operating / Promoting / Assisting' },
  { value: 'P', label: 'Possessing / Concealing' },
  { value: 'T', label: 'Transporting / Transmitting / Importing' },
  { value: 'U', label: 'Using / Consuming' },
];

export const BIAS_MOTIVATION: CodeOption[] = [
  { value: '88', label: 'None (no bias)' },
  { value: '11', label: 'Anti-White' },
  { value: '12', label: 'Anti-Black or African American' },
  { value: '13', label: 'Anti-American Indian or Alaska Native' },
  { value: '14', label: 'Anti-Asian' },
  { value: '15', label: 'Anti-Multiple Races, Group' },
  { value: '21', label: 'Anti-Jewish' },
  { value: '22', label: 'Anti-Catholic' },
  { value: '23', label: 'Anti-Protestant' },
  { value: '24', label: 'Anti-Islamic' },
  { value: '32', label: 'Anti-Hispanic or Latino' },
  { value: '41', label: 'Anti-Gay' },
  { value: '42', label: 'Anti-Lesbian' },
  { value: '44', label: 'Anti-Heterosexual' },
  { value: '45', label: 'Anti-Transgender' },
  { value: '51', label: 'Anti-Physical Disability' },
  { value: '52', label: 'Anti-Mental Disability' },
  { value: '61', label: 'Anti-Male' },
  { value: '62', label: 'Anti-Female' },
  { value: '99', label: 'Unknown (offender motivation not known)' },
];

export const METHOD_OF_ENTRY: CodeOption[] = [
  { value: 'F', label: 'Force' },
  { value: 'N', label: 'No Force' },
];

export const PREMISES_ENTERED: CodeOption[] = Array.from({ length: 50 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

export const SEX_CODES: CodeOption[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'U', label: 'Unknown' },
];

export const RACE_CODES: CodeOption[] = [
  { value: 'W', label: 'White' },
  { value: 'B', label: 'Black or African American' },
  { value: 'I', label: 'American Indian or Alaska Native' },
  { value: 'A', label: 'Asian' },
  { value: 'P', label: 'Native Hawaiian or Other Pacific Islander' },
  { value: 'U', label: 'Unknown' },
];

export const ETHNICITY_CODES: CodeOption[] = [
  { value: 'H', label: 'Hispanic or Latino' },
  { value: 'N', label: 'Not Hispanic or Latino' },
  { value: 'U', label: 'Unknown' },
];

export const PERSON_ROLES: CodeOption[] = [
  { value: 'victim', label: 'Victim' },
  { value: 'suspect', label: 'Suspect' },
  { value: 'arrestee', label: 'Arrestee' },
  { value: 'witness', label: 'Witness' },
  { value: 'complainant', label: 'Complainant / Reporting Party' },
  { value: 'other', label: 'Other' },
];

export const VEHICLE_INVOLVEMENT: CodeOption[] = [
  { value: 'stolen', label: 'Stolen' },
  { value: 'recovered', label: 'Recovered' },
  { value: 'suspect', label: 'Suspect Vehicle' },
  { value: 'victim', label: 'Victim Vehicle' },
  { value: 'towed', label: 'Towed' },
  { value: 'other', label: 'Other' },
];

export const CLEARANCE_OPTIONS: CodeOption[] = [
  { value: 'open', label: 'Open / Active' },
  { value: 'cleared_arrest', label: 'Cleared by Arrest' },
  { value: 'cleared_exceptional', label: 'Cleared Exceptionally' },
  { value: 'unfounded', label: 'Unfounded' },
  { value: 'inactive', label: 'Inactive / Suspended' },
];

export const EXCEPTIONAL_CLEARANCE_REASONS: CodeOption[] = [
  { value: 'A', label: 'Death of Offender' },
  { value: 'B', label: 'Prosecution Declined' },
  { value: 'C', label: 'In Custody of Other Jurisdiction' },
  { value: 'D', label: 'Victim Refused to Cooperate' },
  { value: 'E', label: 'Juvenile / No Custody' },
];

export const ARREST_TYPES: CodeOption[] = [
  { value: 'O', label: 'On-View Arrest' },
  { value: 'S', label: 'Summoned / Cited' },
  { value: 'T', label: 'Taken Into Custody (warrant / previous report)' },
];

export function labelOf(options: CodeOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
