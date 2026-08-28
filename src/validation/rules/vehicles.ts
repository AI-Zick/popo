import { blank, path, type Issue, type Rule } from '../engine';
import { createVehicle } from '@/domain/factory';
import { isValidVIN } from '@/lib/format';

export const vehicleRules: Rule[] = [
  // ---- Motor vehicle theft needs a vehicle -------------------------------
  (ctx) => {
    if (!ctx.anyOffense('requiresVehicle') || ctx.vehicles.length > 0) return [];
    return [
      {
        key: 'vehicles.missing',
        ruleId: 'vehicles.missing',
        severity: 'error',
        section: 'vehicles',
        path: path.section('vehicles'),
        title: 'Motor vehicle theft requires a vehicle record',
        message: 'This report has a motor vehicle theft offense but no vehicle is listed.',
        tip: 'The vehicle record is what gets entered into the stolen vehicle file. Without a plate or VIN here, no other agency can hit on it during a traffic stop.',
        quickFix: {
          label: 'Add the stolen vehicle',
          apply: (draft) => {
            const vehicle = createVehicle({ involvement: 'stolen' });
            draft.vehicles.push(vehicle);
            return path.vehicle(vehicle.id, 'plate');
          },
        },
      },
    ];
  },

  // ---- Per-vehicle requirements ------------------------------------------
  (ctx) => {
    const issues: Issue[] = [];

    ctx.vehicles.forEach((vehicle, index) => {
      const scope = `Vehicle ${index + 1}${vehicle.plate ? ` — ${vehicle.plate}` : ''}`;
      const at = (field: Parameters<typeof path.vehicle>[1]) => path.vehicle(vehicle.id, field);

      if (blank(vehicle.involvement)) {
        issues.push({
          key: `vehicle.${vehicle.id}.involvement`,
          ruleId: 'vehicle.involvement',
          severity: 'error',
          section: 'vehicles',
          path: at('involvement'),
          scope,
          title: 'Vehicle involvement is required',
          message: 'Say how this vehicle relates to the incident.',
          tip: 'Stolen, Recovered, Suspect Vehicle, Victim Vehicle or Towed. A suspect vehicle is one the offender arrived or fled in.',
        });
      }

      if (blank(vehicle.plate) && blank(vehicle.vin)) {
        issues.push({
          key: `vehicle.${vehicle.id}.identifier`,
          ruleId: 'vehicle.identifier',
          severity:
            vehicle.involvement === 'stolen' || vehicle.involvement === 'recovered' ? 'error' : 'warning',
          section: 'vehicles',
          path: at('plate'),
          scope,
          title: 'Vehicle has no plate or VIN',
          message: 'This vehicle cannot be identified without at least a plate or a VIN.',
          tip: 'A partial plate is still worth recording — put what you have in the plate field and describe the uncertainty in the notes. For a stolen vehicle, the VIN is what the insurance carrier and the recovery agency work from.',
        });
      }

      if (!blank(vehicle.vin) && !isValidVIN(vehicle.vin)) {
        issues.push({
          key: `vehicle.${vehicle.id}.vin`,
          ruleId: 'vehicle.vin',
          severity: 'warning',
          section: 'vehicles',
          path: at('vin'),
          scope,
          title: 'VIN does not look valid',
          message: `A VIN is 17 characters and never contains the letters I, O or Q. This one is ${vehicle.vin.trim().length} characters.`,
          tip: 'The letters I, O and Q are excluded precisely because they are confused with 1 and 0 — if you transcribed one, it is almost certainly a digit. Vehicles built before 1981 may have shorter VINs; if that is the case here, ignore this.',
        });
      }

      if (!blank(vehicle.plate) && blank(vehicle.plateState)) {
        issues.push({
          key: `vehicle.${vehicle.id}.plateState`,
          ruleId: 'vehicle.plateState',
          severity: 'warning',
          section: 'vehicles',
          path: at('plateState'),
          scope,
          title: 'Plate state is missing',
          message: 'A plate number without a state of issue is ambiguous.',
          tip: 'Plate numbers repeat across states. Without this, a records check can return the wrong vehicle.',
          quickFix: ctx.incident.state
            ? {
                label: `Set to ${ctx.incident.state}`,
                apply: (draft) => {
                  const target = draft.vehicles.find((v) => v.id === vehicle.id);
                  if (target) target.plateState = draft.state;
                },
              }
            : undefined,
        });
      }

      if (vehicle.involvement === 'towed' && blank(vehicle.towedTo)) {
        issues.push({
          key: `vehicle.${vehicle.id}.towedTo`,
          ruleId: 'vehicle.towedTo',
          severity: 'error',
          section: 'vehicles',
          path: at('towedTo'),
          scope,
          title: 'Tow destination is required',
          message: 'A towed vehicle must record where it went.',
          tip: 'Name the tow company and lot. This is the first thing an owner asks the front desk, and the first thing a liability claim turns on.',
        });
      }

      if (!blank(vehicle.year)) {
        const year = Number(vehicle.year);
        const nextYear = new Date().getFullYear() + 2;
        if (!Number.isInteger(year) || year < 1900 || year > nextYear) {
          issues.push({
            key: `vehicle.${vehicle.id}.year`,
            ruleId: 'vehicle.year',
            severity: 'warning',
            section: 'vehicles',
            path: at('year'),
            scope,
            title: 'Vehicle year looks wrong',
            message: `"${vehicle.year}" is not a plausible model year.`,
            tip: `Use the four-digit model year, between 1900 and ${nextYear}.`,
          });
        }
      }
    });

    return issues;
  },
];
