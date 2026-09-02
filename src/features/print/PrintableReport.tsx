import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/state/store';
import { CLEARANCE_OPTIONS, OFFENSE_BY_CODE, labelOf, LOCATION_TYPES, INJURY_TYPES, RELATIONSHIPS, PROPERTY_DESCRIPTIONS, LOSS_TYPES, VICTIM_TYPES, SEX_CODES, RACE_CODES, PERSON_ROLES, VEHICLE_INVOLVEMENT } from '@/domain/codes';
import { fullAddress } from '@/domain/location';
import { formalName } from '@/domain/person';
import { STATUS_LABEL, REVIEW_ACTION_LABEL } from '@/domain/review';
import { SUPPLEMENT_TYPE_LABEL, supplementLabel } from '@/domain/supplement';
import { currency, formatDate, formatDateTime } from '@/lib/format';
import { ageForPrint } from '@/domain/freshness';

/**
 * The paper version.
 *
 * Prosecutors, defence counsel and courts work from paper, and what they get
 * has to be the whole report — not a screenshot of whichever section happened
 * to be open. This renders every section in a fixed order with the coded values
 * spelled out, because "20" means nothing to anyone outside the system.
 *
 * PDF comes from the browser's own print-to-PDF. That keeps the layout engine
 * the same one the officer previewed, and avoids shipping a second renderer
 * whose output nobody checks.
 */
export function PrintableReport({ onClose }: { onClose: () => void }) {
  const { incident, persons, locations, agency, attachments, caseSupplements, currentUser, record } =
    useStore();

  useEffect(() => {
    if (!incident) return;
    // Printing a report is a disclosure of everything in it.
    record({
      actorId: currentUser.id,
      actorName: currentUser.name,
      action: 'report.printed',
      target: incident.caseNumber,
      detail: '',
    });

    /*
      The sheet is portalled to <body> and the app is hidden by `printing`,
      because the browser prints the whole document: an overlay drawn on top of
      the editor still puts the editor's scroll containers in the output.
    */
    document.documentElement.classList.add('printing');
    // A beat for fonts and layout, so the first page is not printed mid-reflow.
    const timer = window.setTimeout(() => window.print(), 400);
    const done = () => onClose();
    window.addEventListener('afterprint', done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.documentElement.classList.remove('printing');
    };
    // Intentionally once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!incident) return null;
  const location = locations[incident.locationId];
  const files = attachments.filter((a) => a.incidentId === incident.id && !a.retractedAt);

  return createPortal(
    <div className="print-sheet fixed inset-0 z-[100] overflow-y-auto bg-white text-black print:static print:overflow-visible">
      <div className="mx-auto max-w-[8.5in] p-8 print:p-0">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] text-white"
          >
            Print
          </button>
        </div>

        {/* ---- Header ---------------------------------------------------- */}
        <header className="border-b-2 border-black pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[17px] font-bold uppercase tracking-wide">
                {agency.name || 'Police Department'}
              </h1>
              <p className="text-[11px]">
                {agency.city}
                {agency.county && `, ${agency.county} County`} {agency.state} · ORI{' '}
                {agency.ori || '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide">Incident Report</p>
              <p className="font-mono text-[18px] font-bold">{incident.caseNumber}</p>
              <p className="text-[11px]">{STATUS_LABEL[incident.status]}</p>
            </div>
          </div>
        </header>

        <Section title="Incident">
          <Grid>
            <Field label="Reported" value={formatDateTime(incident.reportedAt)} />
            <Field
              label="Occurred"
              value={
                incident.occurredIsRange
                  ? `${formatDateTime(incident.occurredFrom)} to ${formatDateTime(incident.occurredTo)}`
                  : formatDateTime(incident.occurredFrom)
              }
            />
            <Field
              label="Location"
              value={fullAddress(location, incident.locationUnit) || '—'}
              wide
            />
            <Field
              label="Premises"
              value={location ? labelOf(LOCATION_TYPES, location.locationType) : '—'}
            />
            <Field label="Beat" value={location?.beat || '—'} />
            <Field label="Reporting officer" value={`${incident.reportingOfficer} #${incident.reportingBadge}`} />
            <Field label="Unit" value={incident.unit || '—'} />
            <Field label="Supervisor" value={incident.supervisor || '—'} />
            <Field
              label="Disposition"
              value={labelOf(CLEARANCE_OPTIONS, incident.clearanceStatus) || '—'}
            />
          </Grid>
          {(incident.isDomestic || incident.isHateCrime || incident.isGangRelated || incident.involvesJuvenile) && (
            <p className="mt-2 text-[11px]">
              <span className="font-semibold">Flags: </span>
              {[
                incident.isDomestic && 'Domestic violence',
                incident.isHateCrime && 'Bias / hate crime',
                incident.isGangRelated && 'Gang related',
                incident.involvesJuvenile && 'Involves a juvenile',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </Section>

        <Section title={`Offenses (${incident.offenses.length})`}>
          {incident.offenses.map((offense, i) => {
            const def = OFFENSE_BY_CODE.get(offense.code);
            return (
              <div key={offense.id} className="mb-2 break-inside-avoid">
                <p className="text-[12px] font-semibold">
                  {i + 1}. {def ? `${def.code} — ${def.label}` : 'Unspecified offense'}
                  {offense.statute && ` · ${offense.statute}`}
                </p>
                <p className="text-[11px]">
                  {offense.attemptCompleted === 'A' ? 'Attempted' : 'Completed'} ·{' '}
                  {labelOf(LOCATION_TYPES, offense.locationType)}
                  {offense.methodOfEntry && ` · Entry: ${offense.methodOfEntry === 'F' ? 'Force' : 'No force'}`}
                </p>
              </div>
            );
          })}
        </Section>

        <Section title={`People (${persons.length})`}>
          {persons.map((person, i) => (
            <div key={person.id} className="mb-3 break-inside-avoid">
              <p className="text-[12px] font-semibold">
                {i + 1}. {formalName(person)} —{' '}
                {PERSON_ROLES.find((r) => r.value === person.role)?.label}
                {person.role === 'victim' && person.victimType
                  ? ` (${labelOf(VICTIM_TYPES, person.victimType)})`
                  : ''}
              </p>
              <p className="text-[11px]">
                {[
                  person.dob && `DOB ${formatDate(person.dob)}`,
                  person.sex && labelOf(SEX_CODES, person.sex),
                  person.race && labelOf(RACE_CODES, person.race),
                  /*
                    Contact details carry their age on paper too. Whoever serves
                    the warrant or makes the notification is reading this sheet,
                    not the screen, and an address with no date reads as current
                    however old it is.
                  */
                  person.address &&
                    `${person.address}, ${person.city} (${ageForPrint(person.provenance?.address?.at)})`,
                  person.phone && `${person.phone} (${ageForPrint(person.provenance?.phone?.at)})`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No identifying detail recorded'}
              </p>
              {person.injuries.length > 0 && (
                <p className="text-[11px]">
                  Injuries: {person.injuries.map((c) => labelOf(INJURY_TYPES, c)).join(', ')}
                </p>
              )}
              {person.relationships.length > 0 && (
                <p className="text-[11px]">
                  Relationship:{' '}
                  {person.relationships
                    .map((r) => labelOf(RELATIONSHIPS, r.relationship))
                    .join(', ')}
                </p>
              )}
              {person.charges.length > 0 && (
                <p className="text-[11px]">
                  Charges:{' '}
                  {person.charges.map((c) => `${c.statute} ${c.description} (${c.counts})`).join('; ')}
                </p>
              )}
            </div>
          ))}
        </Section>

        {incident.property.length > 0 && (
          <Section title={`Property (${incident.property.length})`}>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-1">Type</th>
                  <th>Loss</th>
                  <th>Description</th>
                  <th className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {incident.property.map((item) => (
                  <tr key={item.id} className="border-b border-neutral-300">
                    <td className="py-1">{labelOf(PROPERTY_DESCRIPTIONS, item.descriptionCode)}</td>
                    <td>{labelOf(LOSS_TYPES, item.lossType)}</td>
                    <td>{[item.make, item.model, item.description].filter(Boolean).join(' ')}</td>
                    <td className="text-right">{item.value ? currency(item.value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {incident.vehicles.length > 0 && (
          <Section title={`Vehicles (${incident.vehicles.length})`}>
            {incident.vehicles.map((v) => (
              <p key={v.id} className="text-[11px]">
                {[v.year, v.make, v.model, v.color].filter(Boolean).join(' ')} · Plate{' '}
                {v.plate || '—'} {v.plateState} · VIN {v.vin || '—'} ·{' '}
                {labelOf(VEHICLE_INVOLVEMENT, v.involvement)}
                {v.towedTo && ` · Towed to ${v.towedTo}`}
              </p>
            ))}
          </Section>
        )}

        <Section title="Narrative">
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed">
            {incident.narrative || 'No narrative recorded.'}
          </p>
        </Section>

        {files.length > 0 && (
          <Section title={`Attachments (${files.length})`}>
            {files.map((file) => (
              <p key={file.id} className="text-[11px]">
                {file.filename}
                {file.caption && ` — ${file.caption}`} · {file.uploadedByName} ·{' '}
                {formatDateTime(file.uploadedAt)}
                {/* The digest is what lets a copy be matched to the original. */}
                <span className="block font-mono text-[9.5px]">sha256 {file.sha256}</span>
              </p>
            ))}
          </Section>
        )}

        {/*
          Approved supplements are part of the case file and print with it. A
          case handed to a prosecutor without its follow-ups is a case that
          reads as though nothing happened after the first shift.
        */}
        {caseSupplements
          .filter((s) => s.status === 'approved')
          .map((s) => (
            <Section key={s.id} title={`${supplementLabel(s)} — ${SUPPLEMENT_TYPE_LABEL[s.type]}`}>
              <p className="text-[11px]">
                {s.reportingOfficer} · approved by {s.reviewedBy} ·{' '}
                {formatDateTime(s.reviewedAt)}
              </p>
              {s.disposition && (
                <p className="mt-1 text-[11px] font-semibold">
                  Case status changed to{' '}
                  {labelOf(CLEARANCE_OPTIONS, s.disposition.clearanceStatus)} as at{' '}
                  {formatDate(s.disposition.clearedAt)}
                  {s.arrest?.personName && ` — ${s.arrest.personName}, arrested ${formatDate(s.arrest.arrestDate)}`}
                  {s.arrest?.arrestCaseNumber && ` under ${s.arrest.arrestCaseNumber}`}
                </p>
              )}
              <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed">
                {s.narrative}
              </p>
            </Section>
          ))}

        {(incident.reviewHistory?.length ?? 0) > 0 && (
          <Section title="Review history">
            {incident.reviewHistory.map((entry) => (
              <p key={entry.id} className="text-[11px]">
                {REVIEW_ACTION_LABEL[entry.action]} by {entry.actorName} ·{' '}
                {formatDateTime(entry.at)}
                {entry.note && ` — ${entry.note}`}
              </p>
            ))}
          </Section>
        )}

        <footer className="mt-6 border-t border-black pt-2 text-[10px]">
          <p>
            Printed by {currentUser.name} on {formatDateTime(new Date().toISOString())} ·{' '}
            {incident.caseNumber}
          </p>
          <p className="mt-0.5">
            This copy is a record of the report as it stood at the time of printing. The system of
            record is the case file.
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

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5">{children}</dl>;
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-3' : ''}>
      <dt className="text-[9.5px] uppercase tracking-wide text-neutral-600">{label}</dt>
      <dd className="text-[11.5px]">{value}</dd>
    </div>
  );
}
