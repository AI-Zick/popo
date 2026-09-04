import { createStatute, type Statute } from '../statute';

/**
 * Alabama, Title 13A and the traffic code.
 *
 * A worked example rather than a complete code. It covers the offences a
 * municipal agency writes most weeks — the ones where an officer would
 * otherwise be typing a cite from memory — and stops well short of the whole
 * criminal code, because a table nobody has read is not made safer by being
 * longer.
 *
 * **Every entry is unverified.** These were assembled from the published code
 * and have not been checked against the current revision by anybody at any
 * agency. Alabama renumbers and re-grades like everywhere else, and the
 * `verifiedOn` field is blank on all of them for that reason; the screen says
 * so wherever one is offered. An administrator working through this list and
 * marking each one checked is the intended first-week task, and it is a real
 * one — not a formality.
 *
 * The `distinguishes` line is the field that earns its keep. "Burglary 1st"
 * and "Burglary 2nd" tell an officer nothing at the moment they are choosing
 * between them; "dwelling, and armed or someone was hurt" tells them which
 * one they are looking at.
 */
export const AL_STATUTES: Statute[] = [
  /* ---- Homicide -------------------------------------------------------- */
  s('al-13a-6-2', '13A-6-2', 'Murder', ['09A'], 'Class A felony', 'Intentional, or extreme indifference to human life.'),
  s('al-13a-6-3', '13A-6-3', 'Manslaughter', ['09A', '09B'], 'Class B felony', 'Reckless, or intentional under a sudden heat of passion caused by provocation.'),
  s('al-13a-6-4', '13A-6-4', 'Criminally negligent homicide', ['09B'], 'Class A misdemeanor', 'Death caused by criminal negligence — the usual charge on a fatal crash.'),

  /* ---- Assault --------------------------------------------------------- */
  s('al-13a-6-20', '13A-6-20', 'Assault, first degree', ['13A'], 'Class B felony', 'Serious physical injury, or injury with a deadly weapon.'),
  s('al-13a-6-21', '13A-6-21', 'Assault, second degree', ['13A'], 'Class C felony', 'Serious injury, or injury with a weapon, or injury to a police officer or first responder.'),
  s('al-13a-6-22', '13A-6-22', 'Assault, third degree', ['13B'], 'Class A misdemeanor', 'Physical injury with no weapon and no serious harm. The ordinary simple assault.'),
  s('al-13a-6-23', '13A-6-23', 'Menacing', ['13C'], 'Class B misdemeanor', 'Putting somebody in fear of imminent serious physical injury, without touching them.'),
  s('al-13a-6-24', '13A-6-24', 'Reckless endangerment', ['13C'], 'Class A misdemeanor', 'Conduct creating a substantial risk of serious injury to another person.'),
  s('al-13a-6-25', '13A-6-25', 'Criminal coercion', ['13C'], 'Class A misdemeanor', 'Compelling somebody to act by threat.'),

  /* ---- Domestic violence ----------------------------------------------- */
  s('al-13a-6-130', '13A-6-130', 'Domestic violence, first degree', ['13A'], 'Class A felony', 'First-degree assault or aggravated stalking against a household member.'),
  s('al-13a-6-131', '13A-6-131', 'Domestic violence, second degree', ['13A'], 'Class B felony', 'Second-degree assault, intimidation or burglary against a household member.'),
  s('al-13a-6-132', '13A-6-132', 'Domestic violence, third degree', ['13B'], 'Class A misdemeanor', 'Third-degree assault, menacing or harassment against a household member. Enhanced on a second conviction.'),

  /* ---- Kidnapping and stalking ----------------------------------------- */
  s('al-13a-6-43', '13A-6-43', 'Kidnapping, first degree', ['100'], 'Class A felony', 'Abduction with intent to ransom, hold hostage, injure or terrorise.'),
  s('al-13a-6-44', '13A-6-44', 'Kidnapping, second degree', ['100'], 'Class B felony', 'Abduction without the aggravating intent above.'),
  s('al-13a-6-90', '13A-6-90', 'Stalking, first degree', ['13C'], 'Class C felony', 'A repeated course of conduct that puts somebody in reasonable fear of death or serious injury.'),
  s('al-13a-6-90.1', '13A-6-90.1', 'Aggravated stalking', ['13C'], 'Class B felony', 'Stalking in violation of a court order or injunction.'),

  /* ---- Sexual offences -------------------------------------------------- */
  s('al-13a-6-61', '13A-6-61', 'Rape, first degree', ['11A'], 'Class A felony', 'By forcible compulsion, or where the victim is incapable of consent, or is under 12.'),
  s('al-13a-6-62', '13A-6-62', 'Rape, second degree', ['11A'], 'Class B felony', 'Victim aged 12 to 15 and the offender is at least 16 and two years older.'),
  s('al-13a-6-63', '13A-6-63', 'Sodomy, first degree', ['11A'], 'Class A felony', 'By forcible compulsion or where the victim is incapable of consent.'),
  s('al-13a-6-66', '13A-6-66', 'Sexual abuse, first degree', ['11B', '11D'], 'Class C felony', 'Sexual contact by forcible compulsion, or with somebody incapable of consent.'),
  s('al-13a-6-67', '13A-6-67', 'Sexual abuse, second degree', ['11D'], 'Class A misdemeanor', 'Sexual contact without the aggravating circumstances above.'),

  /* ---- Robbery --------------------------------------------------------- */
  s('al-13a-8-41', '13A-8-41', 'Robbery, first degree', ['120'], 'Class A felony', 'Armed with a deadly weapon, or causes serious physical injury.'),
  s('al-13a-8-42', '13A-8-42', 'Robbery, second degree', ['120'], 'Class B felony', 'Aided by another person actually present.'),
  s('al-13a-8-43', '13A-8-43', 'Robbery, third degree', ['120'], 'Class C felony', 'Force or the threat of force during a theft, with no weapon and nobody assisting.'),

  /* ---- Burglary -------------------------------------------------------- */
  s('al-13a-7-5', '13A-7-5', 'Burglary, first degree', ['220'], 'Class A felony', 'A dwelling, and the person was armed or caused physical injury.'),
  s('al-13a-7-6', '13A-7-6', 'Burglary, second degree', ['220'], 'Class B felony', 'A dwelling, or armed in a non-dwelling. The usual residential burglary charge.'),
  s('al-13a-7-7', '13A-7-7', 'Burglary, third degree', ['220'], 'Class C felony', 'Unlawful entry of any building with intent to commit a crime. The usual commercial burglary charge.'),
  s('al-13a-7-2', '13A-7-2', 'Criminal trespass, first degree', ['90Z'], 'Class A misdemeanor', 'Entering or remaining in a dwelling. Trespass after a warning goes here.'),
  s('al-13a-7-3', '13A-7-3', 'Criminal trespass, second degree', ['90Z'], 'Class C misdemeanor', 'Entering or remaining in a fenced or posted building or premises.'),

  /* ---- Theft ------------------------------------------------------------ */
  s('al-13a-8-3', '13A-8-3', 'Theft of property, first degree', ['23F', '23H', '23D', '23C', '23B'], 'Class B felony', 'Value over $2,500, or a firearm regardless of value.'),
  s('al-13a-8-4', '13A-8-4', 'Theft of property, second degree', ['23F', '23H', '23D', '23C', '23B'], 'Class C felony', 'Value over $1,500 and not more than $2,500.'),
  s('al-13a-8-4.1', '13A-8-4.1', 'Theft of property, third degree', ['23F', '23H', '23D', '23C', '23B', '23A'], 'Class D felony', 'Value over $500 and not more than $1,500.'),
  s('al-13a-8-5', '13A-8-5', 'Theft of property, fourth degree', ['23F', '23H', '23D', '23C', '23B', '23A'], 'Class A misdemeanor', 'Value $500 or less. Most shoplifting and thefts from vehicles.'),
  s('al-13a-8-10', '13A-8-10', 'Theft of services', ['26A', '26B'], 'Class A misdemeanor', 'Obtaining services by deception or without paying. Graded by value.'),
  s('al-13a-8-192', '13A-8-192', 'Identity theft', ['26C', '26A'], 'Class C felony', 'Using another person’s identifying information without authority.'),

  /* ---- Motor vehicle theft ---------------------------------------------- */
  s('al-13a-8-3-mv', '13A-8-3(b)', 'Theft of property, first degree — motor vehicle', ['240'], 'Class B felony', 'Theft of a motor vehicle, whatever its value.'),
  s('al-13a-8-11', '13A-8-11', 'Unauthorized use of a vehicle', ['240'], 'Class A misdemeanor', 'Taking and using without the owner’s consent but without intent to deprive permanently — the joyriding charge.'),

  /* ---- Fraud ------------------------------------------------------------ */
  s('al-13a-9-3', '13A-9-3', 'Forgery, second degree', ['250'], 'Class C felony', 'Falsely making or altering a will, deed, contract or commercial instrument.'),
  s('al-13a-9-6', '13A-9-6', 'Criminal possession of a forged instrument, second degree', ['250'], 'Class C felony', 'Possessing a forged instrument with intent to defraud.'),
  s('al-13a-9-13.1', '13A-9-13.1', 'Negotiating a worthless negotiable instrument', ['250'], 'Class A misdemeanor', 'The bad-cheque charge. Felony over $500.'),
  s('al-13a-8-198', '13A-8-198', 'Fraudulent use of a credit or debit card', ['26B'], 'Class C felony', 'Use of a card known to be stolen, forged, revoked or unauthorised.'),

  /* ---- Damage and arson -------------------------------------------------- */
  s('al-13a-7-41', '13A-7-41', 'Arson, first degree', ['200'], 'Class A felony', 'A building where somebody is present, or the fire was set to defraud an insurer with somebody present.'),
  s('al-13a-7-42', '13A-7-42', 'Arson, second degree', ['200'], 'Class B felony', 'Damaging a building by fire or explosion.'),
  s('al-13a-7-43', '13A-7-43', 'Arson, third degree', ['200'], 'Class C felony', 'Reckless damage to a building by fire or explosion.'),
  s('al-13a-7-21', '13A-7-21', 'Criminal mischief, first degree', ['290'], 'Class C felony', 'Damage over $2,500.'),
  s('al-13a-7-22', '13A-7-22', 'Criminal mischief, second degree', ['290'], 'Class A misdemeanor', 'Damage over $500 and not more than $2,500.'),
  s('al-13a-7-23', '13A-7-23', 'Criminal mischief, third degree', ['290'], 'Class B misdemeanor', 'Damage of $500 or less. Most vandalism.'),

  /* ---- Weapons ----------------------------------------------------------- */
  s('al-13a-11-61.2', '13A-11-61.2', 'Possession of a firearm on premises where prohibited', ['520'], 'Class C misdemeanor', 'Carrying where the law or a posted owner forbids it.'),
  s('al-13a-11-72', '13A-11-72', 'Certain persons forbidden to possess a firearm', ['520'], 'Class C felony', 'Possession by somebody convicted of a violent crime, or of unsound mind.'),
  s('al-13a-11-63', '13A-11-63', 'Carrying a pistol unlawfully', ['520'], 'Class A misdemeanor', 'Check the current permit rules before charging — Alabama changed these recently.'),

  /* ---- Drugs -------------------------------------------------------------- */
  s('al-13a-12-211', '13A-12-211', 'Unlawful distribution of a controlled substance', ['35A'], 'Class B felony', 'Selling, furnishing or giving away. Enhanced near a school or housing project.'),
  s('al-13a-12-212', '13A-12-212', 'Unlawful possession of a controlled substance', ['35A'], 'Class D felony', 'Simple possession of anything other than marihuana.'),
  s('al-13a-12-213', '13A-12-213', 'Unlawful possession of marihuana, first degree', ['35A'], 'Class D felony', 'For other than personal use, or a second offence after a personal-use conviction.'),
  s('al-13a-12-214', '13A-12-214', 'Unlawful possession of marihuana, second degree', ['35A'], 'Class A misdemeanor', 'Personal use only, first offence.'),
  s('al-13a-12-260', '13A-12-260', 'Drug paraphernalia', ['35B'], 'Class A misdemeanor', 'Use or possession with intent to use. Delivery is a felony.'),

  /* ---- Public order -------------------------------------------------------- */
  s('al-13a-11-7', '13A-11-7', 'Disorderly conduct', ['90C'], 'Class C misdemeanor', 'Fighting, unreasonable noise, obscene language or obstructing traffic.'),
  s('al-13a-11-8', '13A-11-8', 'Harassment or harassing communications', ['13C', '90Z'], 'Class C misdemeanor', 'Striking or touching with intent to harass, or threatening communications.'),
  s('al-13a-10-2', '13A-10-2', 'Obstructing governmental operations', ['90Z'], 'Class A misdemeanor', 'Interfering with a public servant by force or interference.'),
  s('al-13a-10-41', '13A-10-41', 'Resisting arrest', ['90Z'], 'Class B misdemeanor', 'Intentionally preventing a lawful arrest.'),
  s('al-13a-10-101', '13A-10-101', 'False reporting to law enforcement', ['90Z'], 'Class A misdemeanor', 'Reporting an offence or incident knowing it did not happen.'),
  s('al-13a-11-9', '13A-11-9', 'Loitering', ['90Z'], 'Violation', 'Check this one carefully — loitering statutes are the most often struck down.'),

  /* ---- Traffic ------------------------------------------------------------- */
  s('al-32-5a-191', '32-5A-191', 'Driving under the influence', ['90D'], 'Misdemeanor', 'Alcohol, controlled substance or any impairing substance. Felony on a fourth offence.'),
  s('al-32-5a-192', '32-5A-192', 'Chemical test refusal', ['90D'], 'Administrative', 'Implied consent. An administrative suspension rather than a charge.'),
  s('al-32-5a-171', '32-5A-171', 'Speeding — maximum limits', ['90Z'], 'Violation', 'The ordinary speeding cite.'),
  s('al-32-6-1', '32-6-1', 'Driving without a licence', ['90Z'], 'Misdemeanor', 'No licence, as opposed to a suspended or revoked one.'),
  s('al-32-6-19', '32-6-19', 'Driving while licence suspended or revoked', ['90Z'], 'Misdemeanor', 'Enhanced on repeat offences.'),
  s('al-32-10-2', '32-10-2', 'Leaving the scene of an accident', ['90Z'], 'Class C felony', 'Where there was injury or death. Property damage only is a misdemeanor under 32-10-2(b).'),
  s('al-32-5a-190', '32-5A-190', 'Reckless driving', ['90Z'], 'Misdemeanor', 'Wilful or wanton disregard for the safety of persons or property.'),
];

/**
 * A shorthand so the table above reads as a table.
 *
 * Everything arrives unverified — that is not an oversight to be tidied up
 * later, it is the honest state of a statute list nobody at the agency has
 * checked yet.
 */
function s(
  id: string,
  cite: string,
  title: string,
  offenseCodes: string[],
  grade: string,
  distinguishes: string,
): Statute {
  return createStatute({ id, cite, title, offenseCodes, grade, distinguishes });
}
