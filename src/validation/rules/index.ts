import type { Rule } from '../engine';
import { incidentRules } from './incident';
import { offenseRules } from './offenses';
import { personRules } from './persons';
import { propertyRules } from './property';
import { vehicleRules } from './vehicles';
import { narrativeRules } from './narrative';

export const ALL_RULES: Rule[] = [
  ...incidentRules,
  ...offenseRules,
  ...personRules,
  ...propertyRules,
  ...vehicleRules,
  ...narrativeRules,
];
