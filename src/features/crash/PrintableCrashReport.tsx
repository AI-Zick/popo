import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/state/store';
import {
  CONTRIBUTING_FACTORS,
  CRASH_MANNERS,
  LIGHT_CONDITIONS,
  OCCUPANT_SEATS,
  RESTRAINTS,
  ROAD_SURFACE,
  SEVERITIES,
  WEATHER,
  unitLabel,
} from '@/domain/crash';
import { STATUS_LABEL } from '@/domain/review';
import { formalName } from '@/domain/person';
import { labelOf } from '@/domain/codes';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * The crash report on paper.
 *
 * This one leaves the building more than any other document in the system: to
 * the drivers, to two insurers, to a lawyer, and to the state. So it carries
 * everything an adjuster asks for — units, occupants, restraints, insurance,
 * tow — laid out unit by unit, which is the order everyone reads it in.
 */
export function PrintableCrashReport({ onClose }: { onClose: () => void }) {
  const { crash, people, agency, currentUser } = useStore();

  useEffect(() => {
    document.documentElement.classList.add('printing');
    const timer = window.setTimeout(() => window.print(), 400);
    const done = () => onClose();
    window.addEventListener('afterprint', done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.documentElement.classList.remove('printing');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!crash) return null;
  const nameOf = (masterId: string) => {
    const master = people[masterId];
    return master ? formalName(master) : 'Unnamed';
  };

  return createPortal(
    <div className="print-sheet fixed inset-0 z-[100] overflow-y-auto bg-white text-black print:static print:overflow-visible">
      <div className="mx-auto max-w-[8.5in] p-8 print:p-0">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px]">
            Close
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] text-white">
            Print
          </button>
        </div>

        <header className="border-b-2 border-black pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[17px] font-bold uppercase tracking-wide">
                {agency.name || 'Police Department'}
              </h1>
              <p className="text-[11px]">
                {agency.city}
                {agency.county && `, ${agency.county} County`} {agency.state} · ORI {agency.ori || '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide">Motor vehicle crash</p>
              <p className="font-mono text-[18px] font-bold">{crash.caseNumber}</p>
              <p className="text-[11px]">{STATUS_LABEL[crash.status]}</p>
              {crash.stateCrashNumber && (
                <p className="text-[11px]">State no. {crash.stateCrashNumber}</p>
              )}
            </div>
          </div>
        </header>

        <Section title="The crash">
          <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <Field label="Occurred" value={formatDateTime(crash.occurredAt)} />
            <Field label="Reported" value={formatDateTime(crash.reportedAt)} />
            <Field label="Severity" value={labelOf(SEVERITIES, crash.severity)} />
            <Field
              label="Location"
              value={[crash.onRoad, crash.crossStreet && `at ${crash.crossStreet}`, crash.milepost && `MP ${crash.milepost}`]
                .filter(Boolean)
                .join(' ')}
              wide
            />
            <Field label="Manner" value={labelOf(CRASH_MANNERS, crash.manner)} />
            <Field label="Light" value={labelOf(LIGHT_CONDITIONS, crash.lightCondition)} />
            <Field label="Weather" value={labelOf(WEATHER, crash.weather)} />
            <Field label="Road surface" value={labelOf(ROAD_SURFACE, crash.roadSurface)} />
            <Field label="Officer" value={`${crash.reportingOfficer} #${crash.reportingBadge}`} />
            <Field label="Dispatch call" value={crash.callNumber || '—'} />
          </dl>
          {(crash.workZone || crash.schoolZone) && (
            <p className="mt-2 text-[11px]">
              <span className="font-semibold">Zones: </span>
              {[crash.workZone && 'Work zone', crash.schoolZone && 'School zone'].filter(Boolean).join(' · ')}
            </p>
          )}
        </Section>

        {crash.units.map((unit) => (
          <Section key={unit.id} title={unitLabel(unit)}>
            <dl className="grid grid-cols-4 gap-x-4 gap-y-1.5">
              <Field label="Plate" value={`${unit.plate || '—'} ${unit.plateState}`} />
              <Field label="VIN" value={unit.vin || '—'} />
              <Field label="Colour / style" value={[unit.color, unit.style].filter(Boolean).join(' ') || '—'} />
              <Field label="Travelling" value={unit.direction || '—'} />
              <Field label="Registered owner" value={unit.ownerMasterId ? nameOf(unit.ownerMasterId) : '—'} wide />
              <Field label="Insurance" value={[unit.insuranceCarrier, unit.insurancePolicy].filter(Boolean).join(' · ') || 'None recorded'} wide />
              <Field label="Posted / estimated speed" value={[unit.postedSpeed, unit.estimatedSpeed].filter(Boolean).join(' / ') || '—'} />
              <Field label="Towed" value={unit.towed ? `${unit.towedBy || 'Yes'} → ${unit.towedTo || 'destination not recorded'}` : 'No'} />
            </dl>

            {unit.contributingFactors.length > 0 && (
              <p className="mt-1.5 text-[11px]">
                <span className="font-semibold">Contributing: </span>
                {unit.contributingFactors.map((f) => labelOf(CONTRIBUTING_FACTORS, f)).join(' · ')}
              </p>
            )}

            {unit.occupants.length > 0 && (
              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="border-b border-neutral-400 text-left">
                    <th className="py-1 pr-2 font-semibold">Occupant</th>
                    <th className="px-1.5 py-1 font-semibold">Seat</th>
                    <th className="px-1.5 py-1 font-semibold">Restraint</th>
                    <th className="px-1.5 py-1 font-semibold">Injury</th>
                    <th className="px-1.5 py-1 font-semibold">Taken to</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.occupants.map((occupant) => (
                    <tr key={occupant.id} className="border-b border-neutral-200">
                      <td className="py-1 pr-2">
                        {nameOf(occupant.masterId)}
                        {unit.driverOccupantId === occupant.id && (
                          <span className="font-semibold"> (driver)</span>
                        )}
                        {people[occupant.masterId]?.dob && (
                          <span> · DOB {formatDate(people[occupant.masterId].dob)}</span>
                        )}
                      </td>
                      <td className="px-1.5 py-1">{labelOf(OCCUPANT_SEATS, occupant.seat)}</td>
                      <td className="px-1.5 py-1">{labelOf(RESTRAINTS, occupant.restraint)}</td>
                      <td className="px-1.5 py-1">
                        {labelOf(SEVERITIES, occupant.injury)}
                        {occupant.ejected && ' · ejected'}
                        {occupant.airbagDeployed && ' · airbag'}
                      </td>
                      <td className="px-1.5 py-1">{occupant.transportedTo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        ))}

        <Section title="Narrative">
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed">
            {crash.narrative || 'No narrative recorded.'}
          </p>
        </Section>

        <footer className="mt-6 border-t border-black pt-2 text-[10px]">
          <p>
            Printed by {currentUser.name} on {formatDateTime(new Date().toISOString())} ·{' '}
            {crash.caseNumber}
          </p>
          <p className="mt-0.5">
            Identity and vehicle details taken from registry returns are what those systems reported
            at the time and are not, by themselves, confirmation by the officer.
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid">
      <h2 className="border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">
        {title}
      </h2>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[9.5px] uppercase tracking-wide text-neutral-600">{label}</dt>
      <dd className="text-[11.5px]">{value || '—'}</dd>
    </div>
  );
}
