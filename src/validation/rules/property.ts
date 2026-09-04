import { blank, path, type Issue, type Rule } from '../engine';
import { createProperty, createVehicle } from '@/domain/factory';
import { STRUCTURE_PROPERTY_CODES, VEHICLE_PROPERTY_CODES } from '@/domain/codes';

/**
 * What a loss type means for the vehicle's involvement.
 *
 * The two lists say the same thing in different words, and only where they
 * genuinely line up: property "seized" is not vehicle "towed", and guessing
 * would put a wrong answer in a required field where a blank asks the question.
 */
const INVOLVEMENT_FOR_LOSS: Record<string, string> = {
  stolen: 'stolen',
  recovered: 'recovered',
  burned: 'victim',
  damaged: 'victim',
};

export const propertyRules: Rule[] = [
  // ---- Offenses that require a property record ---------------------------
  (ctx) => {
    const needsProperty = ctx.offenses.filter((o) => o.def?.requiresProperty);
    if (needsProperty.length === 0 || ctx.property.length > 0) return [];

    const def = needsProperty[0].def!;
    return [
      {
        key: 'property.missing',
        ruleId: 'property.missing',
        severity: 'error',
        section: 'property',
        path: path.section('property'),
        title: `${def.label} requires a property record`,
        message: 'No property is listed, but at least one offense on this report involves property.',
        tip: 'Add what was taken, damaged or seized. If a burglar was interrupted and got nothing, add one record with loss type "None" — that is a real answer and closes the requirement.',
        quickFix: {
          label: 'Add a property record',
          apply: (draft) => {
            const item = createProperty({
              lossType: def.requiresDamagedProperty ? 'destroyed' : 'stolen',
            });
            draft.property.push(item);
            return path.property(item.id, 'descriptionCode');
          },
        },
      },
    ];
  },

  // ---- Arson / vandalism need burned or damaged property -----------------
  (ctx) => {
    const damageOffense = ctx.offenses.find((o) => o.def?.requiresDamagedProperty);
    if (!damageOffense || ctx.property.length === 0) return [];

    const isArson = damageOffense.offense.code === '200';
    const acceptable = isArson ? ['burned'] : ['destroyed', 'burned'];
    const hasMatch = ctx.property.some((p) => acceptable.includes(p.lossType));
    if (hasMatch) return [];

    const first = ctx.property[0];
    return [
      {
        key: 'property.damageLossType',
        ruleId: 'property.damageLossType',
        severity: 'error',
        section: 'property',
        path: path.property(first.id, 'lossType'),
        scope: 'Property 1',
        title: isArson ? 'Arson requires burned property' : 'Vandalism requires damaged property',
        message: `No property on this report is marked as ${isArson ? 'Burned' : 'Destroyed / Damaged / Vandalized'}.`,
        tip: isArson
          ? 'Arson always has something that burned — set the loss type to Burned on the structure or vehicle involved.'
          : 'Set the loss type to Destroyed / Damaged / Vandalized on the item that was damaged, and put the repair or replacement cost in the value field.',
        quickFix: {
          label: `Set to ${isArson ? 'Burned' : 'Damaged'}`,
          apply: (draft) => {
            const target = draft.property.find((p) => p.id === first.id);
            if (target) target.lossType = isArson ? 'burned' : 'destroyed';
          },
        },
      },
    ];
  },

  // ---- Per-item requirements ---------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];
    const needsValue = ctx.anyOffense('requiresPropertyValue');
    const hasDrugOffense = ctx.anyOffense('isDrug');

    ctx.property.forEach((item, index) => {
      const scope = `Property ${index + 1}`;
      const at = (field: Parameters<typeof path.property>[1]) => path.property(item.id, field);

      if (blank(item.lossType)) {
        issues.push({
          key: `property.${item.id}.lossType`,
          ruleId: 'property.lossType',
          severity: 'error',
          section: 'property',
          path: at('lossType'),
          scope,
          title: 'Loss type is required',
          message: 'Every property record needs to say what happened to it.',
          tip: 'Stolen for anything taken, Recovered for property found and returned, Seized for evidence and contraband, Destroyed for vandalism damage.',
        });
      }

      if (blank(item.descriptionCode)) {
        issues.push({
          key: `property.${item.id}.descriptionCode`,
          ruleId: 'property.descriptionCode',
          severity: 'error',
          section: 'property',
          path: at('descriptionCode'),
          scope,
          title: 'Property type is required',
          message: 'Pick the coded category this item falls into.',
          tip: 'Pick the closest match rather than defaulting to "Other" — the category drives the agency’s stolen property statistics. Cash goes under Money, a phone under Cell Phones, a laptop under Computer Hardware.',
        });
      }

      const isDrugItem = item.descriptionCode === '10' || item.descriptionCode === '11';

      // Value requirements
      const valueless = item.lossType === 'none' || item.lossType === 'unknown';
      if (needsValue && !valueless && !isDrugItem && blank(item.value)) {
        issues.push({
          key: `property.${item.id}.value`,
          ruleId: 'property.value',
          severity: 'error',
          section: 'property',
          path: at('value'),
          scope,
          title: 'Property value is required',
          message: 'Theft-type offenses need a dollar value for each item.',
          tip: 'Use fair replacement value at the time it was taken, not what the victim originally paid. If the victim truly cannot estimate, enter 1 — a nonzero placeholder — and note the reason in the narrative.',
        });
      }

      if (!blank(item.value) && Number(item.value.replace(/[^0-9.]/g, '')) === 0 && item.lossType === 'stolen') {
        issues.push({
          key: `property.${item.id}.zeroValue`,
          ruleId: 'property.zeroValue',
          severity: 'warning',
          section: 'property',
          path: at('value'),
          scope,
          title: 'Stolen property with a value of zero',
          message: 'A stolen item is recorded as worth $0.',
          tip: 'Zero is only correct for things with no market value, like documents or ID cards. Otherwise enter the replacement cost — this number rolls into the agency’s annual loss totals.',
        });
      }

      // Recovery
      if (item.lossType === 'recovered' && blank(item.dateRecovered)) {
        issues.push({
          key: `property.${item.id}.dateRecovered`,
          ruleId: 'property.dateRecovered',
          severity: 'error',
          section: 'property',
          path: at('dateRecovered'),
          scope,
          title: 'Recovery date is required',
          message: 'Recovered property must record when it was recovered.',
          tip: 'If the property was recovered on a different date than this incident, that date belongs here — it is how recovery rates get calculated.',
        });
      }

      // Drug detail
      if (isDrugItem || (hasDrugOffense && item.lossType === 'seized')) {
        if (blank(item.drugType)) {
          issues.push({
            key: `property.${item.id}.drugType`,
            ruleId: 'property.drugType',
            severity: 'error',
            section: 'property',
            path: at('drugType'),
            scope,
            title: 'Drug type is required',
            message: 'Seized narcotics must record which drug it is.',
            tip: 'Use your field test or observation. "Unknown Drug Type" is valid when the substance is going to the lab and has not been identified yet.',
          });
        }
        if (blank(item.drugQuantity)) {
          issues.push({
            key: `property.${item.id}.drugQuantity`,
            ruleId: 'property.drugQuantity',
            severity: 'error',
            section: 'property',
            path: at('drugQuantity'),
            scope,
            title: 'Drug quantity is required',
            message: 'Record how much of the substance was seized.',
            tip: 'Use the weight from your scale, including packaging only if that is how you weighed it. Note in the narrative which one it was.',
          });
        }
        if (blank(item.drugMeasurement)) {
          issues.push({
            key: `property.${item.id}.drugMeasurement`,
            ruleId: 'property.drugMeasurement',
            severity: 'error',
            section: 'property',
            path: at('drugMeasurement'),
            scope,
            title: 'Drug measurement unit is required',
            message: 'A quantity with no unit cannot be interpreted.',
            tip: 'Grams for most street-level seizures. Use "Dosage Unit / Item" for pills and "Number of Plants" for a grow.',
          });
        }
      }

      /*
        A vehicle on the property list with no vehicle record behind it.

        The property segment carries the loss and the value; the plate, the VIN,
        the colour and the body style live on the vehicle record, and those are
        what a stolen-vehicle hit actually matches against. So this is not a
        nag about tidiness — a car reported stolen with no plate in the system
        is a car nobody is going to find.

        The fix carries across what the property line already knows and links
        the two, so the officer types the plate once, in the place it belongs.
      */
      if (
        !blank(item.descriptionCode) &&
        VEHICLE_PROPERTY_CODES.has(item.descriptionCode) &&
        !ctx.vehicles.some((vehicle) => vehicle.id === item.vehicleId)
      ) {
        issues.push({
          key: `property.${item.id}.vehicleDetail`,
          ruleId: 'property.vehicleDetail',
          severity: 'warning',
          section: 'vehicles',
          path: path.section('vehicles'),
          title: 'Vehicle listed as property with no vehicle record',
          message: `${scope} is coded as a vehicle, but nothing in the Vehicles section describes it.`,
          tip: 'Add the vehicle so the VIN, plate and description get into the record — that is what a hit on the stolen vehicle file matches against.',
          quickFix: {
            label: 'Add it to the vehicles section',
            apply: (draft) => {
              const line = draft.property.find((entry) => entry.id === item.id);
              if (!line) return;
              const vehicle = createVehicle({
                involvement: INVOLVEMENT_FOR_LOSS[line.lossType] ?? '',
                make: line.make,
                model: line.model,
                vin: line.serialNumber,
              });
              draft.vehicles.push(vehicle);
              line.vehicleId = vehicle.id;
              return path.vehicle(vehicle.id, 'plate');
            },
          },
        });
      }

      if (
        !blank(item.descriptionCode) &&
        STRUCTURE_PROPERTY_CODES.has(item.descriptionCode) &&
        item.lossType === 'stolen'
      ) {
        issues.push({
          key: `property.${item.id}.structureStolen`,
          ruleId: 'property.structureStolen',
          severity: 'error',
          section: 'property',
          path: at('lossType'),
          scope,
          title: 'A structure cannot be stolen',
          message: 'This item is coded as a building but the loss type is Stolen.',
          tip: 'Structures can be Burned, Destroyed/Damaged or Recovered. If contents were taken from inside, list those contents as their own property records instead.',
        });
      }
    });

    return issues;
  },

  // ---- Drug offense with no drug property --------------------------------
  (ctx) => {
    if (!ctx.anyOffense('isDrug')) return [];
    const hasDrug = ctx.property.some((p) => p.descriptionCode === '10' || !blank(p.drugType));
    if (hasDrug) return [];
    if (ctx.property.length === 0) return []; // already covered by property.missing

    const first = ctx.property[0];
    return [
      {
        key: 'property.drugMissing',
        ruleId: 'property.drugMissing',
        severity: 'error',
        section: 'property',
        path: path.property(first.id, 'descriptionCode'),
        scope: 'Property 1',
        title: 'Drug offense with no narcotics recorded',
        message: 'This report has a drug/narcotic violation but no property item coded as Drugs / Narcotics.',
        tip: 'Add the seized substance as a property record with type "Drugs / Narcotics", loss type Seized, and the drug type, quantity and unit filled in.',
        quickFix: {
          label: 'Add a narcotics record',
          apply: (draft) => {
            const item = createProperty({ descriptionCode: '10', lossType: 'seized', quantity: '1' });
            draft.property.push(item);
            return path.property(item.id, 'drugType');
          },
        },
      },
    ];
  },
];
