import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileWarning,
  KeyRound,
  Megaphone,
  Moon,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api, type PostedBulletin } from '@/state/api';
import {
  briefing as build,
  callCount,
  LOOSE_LABEL,
  officersOn,
  type Loose,
} from '@/domain/briefing';
import {
  currentShift,
  DEFAULT_PATTERN,
  describe as describeShift,
  outgoingShift,
  shiftAfter,
  shiftBefore,
  type Shift,
} from '@/domain/shift';
import {
  CONCERN_LABEL,
  hoursHeld,
  isUrgent,
  sortConcerns,
  type Booking,
} from '@/domain/booking';
import type { FieldContact } from '@/domain/fieldContact';
import type { Citation } from '@/domain/citation';
import { KIND_LABEL } from '@/domain/bulletin';
import { Badge, Button, EmptyState, Panel } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The shift briefing.
 *
 * Three sections in a fixed order, because that order is the argument. What is
 * still live goes first — somebody in a cell, a BOLO nobody has cleared —
 * since it is the only part that changes what the next eight hours look like.
 * What happened goes second, read for context. What nobody finished goes last,
 * and is the part currently kept on a sticky note.
 *
 * Nothing here is saved. The briefing is worked out from the records every
 * time it is drawn, because one written at seven in the morning is wrong by
 * eight — a report amended, a person released, a lookout cleared — and a stale
 * briefing is worse than none, since it is read aloud with authority.
 */
export function Briefing({ onClose }: { onClose: () => void }) {
  const { agency, incidents, arrests, crashes, stops, can } = useStore();
  /*
    Field contacts and citations across the whole agency are a supervisor and
    records view. An officer opening the briefing sees their own, and is told
    so — asking for everybody's and showing them a permission error would make
    an ordinary screen look broken.
  */
  const wholeAgency = can('audit.view') || can('reports.approve');
  const pattern = agency.shifts ?? DEFAULT_PATTERN;

  /*
    Defaults to the shift that has just ended, which is the one being briefed.
    Somebody arriving at ten past seven wants last night, not the ten minutes
    of this morning they have been at work.
  */
  const [shift, setShift] = useState<Shift>(() => outgoingShift(pattern));
  /*
    Reports, arrests, crashes and stops are already in the store. Custody,
    contacts, citations and the board are not, and a briefing that quietly
    omitted them would be a briefing that reads as complete and is not — so
    each failure is tracked and said out loud rather than showing as an empty
    section.
  */
  const [board, setBoard] = useState<PostedBulletin[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<FieldContact[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const note = (what: string) =>
      setMissing((current) => (current.includes(what) ? current : [...current, what]));

    api.bulletins().then(
      (r) => !cancelled && setBoard(r.bulletins),
      () => !cancelled && note('The board'),
    );
    api.bookings().then(
      (r) => !cancelled && setBookings(r.bookings),
      () => !cancelled && note('Custody'),
    );
    api.myContacts(wholeAgency ? 'all' : 'mine').then(
      (r) => !cancelled && setContacts(r.contacts),
      () => !cancelled && note('Field contacts'),
    );
    api.citations(wholeAgency ? 'all' : 'mine').then(
      (r) => !cancelled && setCitations(r.citations),
      () => !cancelled && note('Citations'),
    );
    return () => {
      cancelled = true;
    };
  }, [wholeAgency]);

  const result = useMemo(
    () =>
      build(
        {
          incidents,
          arrests,
          crashes,
          stops,
          contacts,
          citations,
          bookings,
          bulletins: board,
        },
        shift,
      ),
    [incidents, arrests, crashes, stops, contacts, citations, bookings, board, shift],
  );

  const isCurrent = shift.start === currentShift(pattern).start;
  const total = callCount(result.happened);
  const officers = officersOn(result.happened);
  const nothingLive = result.live.inCustody.length === 0 && result.live.board.length === 0;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2.5 print:hidden">
        <Button variant="ghost" onClick={onClose}>
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Moon size={17} aria-hidden />
          Shift briefing
        </span>
        <div className="flex-1" />
        <Button onClick={() => setShift(shiftBefore(pattern, shift))}>
          <ChevronLeft size={14} aria-hidden />
          Earlier
        </Button>
        <Button onClick={() => setShift(outgoingShift(pattern))}>Last shift</Button>
        <Button onClick={() => setShift(shiftAfter(pattern, shift))} disabled={isCurrent}>
          Later
          <ChevronRight size={14} aria-hidden />
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={14} aria-hidden />
          Print
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto max-w-3xl p-5 print:max-w-none print:p-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">
            {describeShift(shift)}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {result.quiet
              ? 'Nothing was recorded during this shift.'
              : `${total} ${total === 1 ? 'thing' : 'things'} recorded${
                  officers.length > 0 ? ` · ${officers.join(', ')}` : ''
                }`}
            {isCurrent && ' · this shift is still running'}
          </p>

          {/* ---- Still live ---- */}
          <Section title="Still live" hint="True right now, whenever it happened.">
            {missing.length > 0 && (
              <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                {missing.join(' and ')} could not be read, so anything there is missing from this
                briefing. Check it separately before briefing the shift — an empty section here does
                not mean there was nothing.
              </p>
            )}

            {nothingLive && missing.length === 0 ? (
              <p className="text-[13px] text-muted">Nobody in custody and nothing on the board.</p>
            ) : (
              <>
                {result.live.board.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
                      <Megaphone size={12} aria-hidden />
                      On the board
                    </h3>
                    <ul className="space-y-2">
                      {result.live.board.map((entry) => (
                        <li
                          key={entry.id}
                          className={cn(
                            'rounded-lg border px-3 py-2',
                            entry.kind === 'officerSafety'
                              ? 'border-danger/40 bg-danger-soft/50'
                              : 'border-line bg-surface',
                          )}
                        >
                          <p className="flex flex-wrap items-center gap-2">
                            <Badge tone={entry.kind === 'officerSafety' ? 'danger' : 'neutral'}>
                              {KIND_LABEL[entry.kind]}
                            </Badge>
                            <span className="text-[13.5px] font-medium text-ink">
                              {entry.headline}
                            </span>
                          </p>
                          {entry.lookFor && (
                            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                              {entry.lookFor}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.live.inCustody.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
                      <KeyRound size={12} aria-hidden />
                      In custody
                    </h3>
                    <ul className="space-y-2">
                      {result.live.inCustody.map((held) => {
                        /*
                          Urgent concerns come with the row. A roster that makes
                          somebody click into each person to find out who is
                          diabetic is a roster nobody reads.
                        */
                        const urgent = sortConcerns(held.concerns ?? []).filter(isUrgent);
                        const hours = hoursHeld(held);
                        return (
                          <li
                            key={held.id}
                            className="rounded-lg border border-line bg-surface px-3 py-2"
                          >
                            <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">
                              <span className="font-medium">{held.personName || 'Unnamed'}</span>
                              {hours !== null && (
                                <span className="text-[12px] text-muted">
                                  {Math.floor(hours)} hours
                                </span>
                              )}
                              {urgent.length > 0 && (
                                <Badge tone="danger">
                                  <span className="flex items-center gap-1">
                                    <ShieldAlert size={11} aria-hidden />
                                    {urgent.map((c) => CONCERN_LABEL[c.kind]).join(', ')}
                                  </span>
                                </Badge>
                              )}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* ---- What happened ---- */}
          <Section title="What happened" hint="Bounded by the shift.">
            {result.quiet ? (
              <p className="text-[13px] text-muted">A quiet shift — nothing was recorded.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <Count label="Reports" value={result.happened.incidents.length} />
                  <Count label="Arrests" value={result.happened.arrests.length} />
                  <Count label="Crashes" value={result.happened.crashes.length} />
                  <Count label="Traffic stops" value={result.happened.stops.length} />
                  <Count label="Citations" value={result.happened.citations.length} />
                  <Count label="Field contacts" value={result.happened.contacts.length} />
                </div>

                {!wholeAgency && (
                  <p className="mb-3 text-[12px] leading-relaxed text-faint">
                    Citations and field contacts here are yours only — reading the whole
                    agency&apos;s is a supervisor and records view.
                  </p>
                )}

                {result.offenses.length > 0 && (
                  <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
                    <span className="font-medium text-ink">Offenses: </span>
                    {result.offenses
                      .map((o) => `${o.label}${o.count > 1 ? ` ×${o.count}` : ''}`)
                      .join(' · ')}
                  </p>
                )}

                {result.happened.incidents.length > 0 && (
                  <ul className="space-y-1.5">
                    {result.happened.incidents.map((incident) => (
                      <li
                        key={incident.id}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]"
                      >
                        <span className="font-mono text-ink">
                          {incident.caseNumber || 'No number yet'}
                        </span>
                        <span className="text-muted">
                          {' · '}
                          {formatDateTime(incident.reportedAt)}
                          {incident.reportingOfficer && ` · ${incident.reportingOfficer}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          {/* ---- Not finished ---- */}
          <Section
            title="Not finished"
            hint="What somebody has to chase. Sent-back reports are listed however old they are."
          >
            {result.loose.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nothing outstanding — every report from this shift has gone up.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.loose.map((item) => (
                  <LooseRow key={`${item.kind}:${item.id}`} item={item} />
                ))}
              </ul>
            )}
          </Section>

          {result.quiet && nothingLive && (
            <div className="mt-6 print:hidden">
              <EmptyState
                icon={<Clock size={22} aria-hidden />}
                title="A quiet shift"
                body="Nothing recorded, nobody in custody, and the board is clear. Step back to an earlier shift with the buttons above."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 break-inside-avoid">
      <Panel title={title} description={hint}>
        {children}
      </Panel>
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      {/* A zero is a fact, not a gap — the rule the activity report already keeps. */}
      <p className="text-[18px] font-semibold tabular text-ink">{value}</p>
      <p className="text-[11.5px] text-muted">{label}</p>
    </div>
  );
}

function LooseRow({ item }: { item: Loose }) {
  return (
    <li className="rounded-lg border border-warn/35 bg-warn/5 px-3 py-2">
      <p className="flex flex-wrap items-center gap-2">
        <FileWarning size={13} className="shrink-0 text-warn" aria-hidden />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-warn">
          {LOOSE_LABEL[item.kind]}
        </span>
        <span className="font-mono text-[13px] text-ink">{item.label}</span>
        {item.who && <span className="text-[12.5px] text-muted">{item.who}</span>}
      </p>
      <p className="mt-0.5 pl-5 text-[12px] leading-relaxed text-muted">{item.note}</p>
    </li>
  );
}
