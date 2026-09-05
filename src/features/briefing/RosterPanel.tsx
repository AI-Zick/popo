import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Car, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import { api } from '@/state/api';
import {
  beatsOf,
  check,
  coverage,
  createEntry,
  onDuty,
  STANDING_LABEL,
  type Roster,
  type RosterEntry,
  type RosterProblem,
  type Standing,
} from '@/domain/roster';
import type { Shift } from '@/domain/shift';
import { Badge, Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const STANDINGS: Standing[] = ['on', 'off', 'leave', 'training', 'court'];

/**
 * Who is working this shift, on what beat, in what.
 *
 * First on the briefing, above what is still live and well above what
 * happened, because it is what the room is looking at when the sergeant starts
 * talking. Everything else on this screen is context for the people named
 * here.
 *
 * The one thing it does that a whiteboard cannot is name the beats nobody is
 * on. On a board an uncovered beat is a blank space among blank spaces, which
 * is to say invisible until a call drops there.
 */
export function RosterPanel({ shift }: { shift: Shift }) {
  const { agency, users, can, currentUser } = useStore();
  const mayEdit = can('roster.set');

  const [roster, setRoster] = useState<Roster | null>(null);
  const [suggested, setSuggested] = useState(false);
  const [problems, setProblems] = useState<RosterProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RosterEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed('');
    return api.roster(shift.start, shift.name).then(
      (r) => {
        setRoster(r.roster);
        setSuggested(r.suggested);
        setProblems(r.problems);
        setLoading(false);
      },
      () => {
        setFailed('The roster could not be read.');
        setLoading(false);
      },
    );
  }, [shift.start, shift.name]);

  useEffect(() => {
    let cancelled = false;
    setEditing(false);
    void load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const beats = useMemo(() => beatsOf(agency.zones), [agency.zones]);
  const zone = agency.zoneLabel || 'Beat';

  /*
    Checked here as well as on the server, so a warning appears while somebody
    is still typing rather than after they press save. The server's answer is
    the one that counts; this is the one that is useful.
  */
  const live = useMemo(
    () => (editing ? check({ ...(roster ?? { entries: [] }), entries: draft } as Roster) : problems),
    [editing, draft, roster, problems],
  );

  const shown = editing ? draft : (roster?.entries ?? []);
  const cover = useMemo(
    () => coverage({ ...(roster ?? {}), entries: shown } as Roster, beats),
    [roster, shown, beats],
  );
  const working = onDuty({ ...(roster ?? {}), entries: shown } as Roster);

  const start = () => {
    setDraft((roster?.entries ?? []).map((e) => ({ ...e })));
    setEditing(true);
  };

  const save = async () => {
    if (!roster) return;
    setSaving(true);
    try {
      const saved = await api.setRoster({ ...roster, entries: draft });
      setRoster(saved.roster);
      setSuggested(saved.suggested);
      setProblems(saved.problems);
      setEditing(false);
      setFailed('');
    } catch (problem) {
      setFailed(problem instanceof Error ? problem.message : 'The roster could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const change = (id: string, patch: Partial<RosterEntry>) =>
    setDraft((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const add = () =>
    setDraft((rows) => [
      ...rows,
      createEntry({ id: `new-${rows.length}-${Date.now()}`, standing: 'on' }),
    ]);

  const blocking = live.filter((p) => p.severity === 'error');

  return (
    <section className="mt-5 break-inside-avoid">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Users size={15} className="text-muted" aria-hidden />
          <div className="mr-auto min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Who is on</h2>
            <p className="text-[12px] text-muted">
              {working.length} on duty
              {shown.length > working.length && ` · ${shown.length - working.length} listed and elsewhere`}
              {roster?.updatedByName && !suggested && ` · set by ${roster.updatedByName}`}
            </p>
          </div>

          {mayEdit && !editing && !loading && (
            <Button onClick={start} className="print:hidden">
              {shown.length === 0 ? 'Fill it in' : 'Edit'}
            </Button>
          )}
          {editing && (
            <>
              <Button onClick={() => setEditing(false)} className="print:hidden">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={saving || blocking.length > 0}
                className="print:hidden"
              >
                {saving ? 'Saving…' : 'Save roster'}
              </Button>
            </>
          )}
        </header>

        <div className="px-4 py-3">
          {loading ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Reading the roster…
            </p>
          ) : failed ? (
            <p className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {failed} Do not brief the line-up off this screen until it reads — an empty roster
              here does not mean nobody is working.
            </p>
          ) : (
            <>
              {/*
                Said plainly, because a filled-in sheet nobody has confirmed
                looks exactly like a filled-in sheet somebody has.
              */}
              {suggested && shown.length > 0 && !editing && (
                <p className="mb-3 rounded-lg border border-warn/35 bg-warn/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink/80">
                  Nothing has been saved for this shift. This is the last {shift.name} squad, shown
                  so somebody can correct it rather than type it out.
                </p>
              )}

              {editing ? (
                <Editor
                  rows={draft}
                  zone={zone}
                  beats={beats}
                  officers={users
                    .filter((u) => u.active)
                    .map((u) => ({ id: u.id, name: u.name, badge: u.badge }))}
                  onChange={change}
                  onRemove={(id) => setDraft((rows) => rows.filter((r) => r.id !== id))}
                  onAdd={add}
                  mine={currentUser.id}
                />
              ) : shown.length === 0 ? (
                <p className="text-[13px] text-muted">
                  Nobody is on the roster for this shift.
                  {mayEdit
                    ? ' Fill it in and the next one starts from it.'
                    : ' A supervisor or dispatch sets it.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {shown.map((entry) => (
                    <li
                      key={entry.id}
                      className={cn(
                        'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
                        entry.standing === 'on'
                          ? 'border-line bg-canvas'
                          : 'border-line/60 bg-canvas/50 text-muted',
                      )}
                    >
                      <span className="font-medium text-ink">
                        {entry.officerName || 'Unnamed'}
                      </span>
                      {entry.badge && <span className="text-[12px] text-faint">#{entry.badge}</span>}
                      {entry.beat && (
                        <Badge tone="accent">
                          {zone} {entry.beat}
                        </Badge>
                      )}
                      {entry.vehicle && (
                        <span className="flex items-center gap-1 text-[12.5px] text-muted">
                          <Car size={12} aria-hidden />
                          {entry.vehicle}
                        </span>
                      )}
                      {entry.callSign && (
                        <span className="text-[12.5px] text-muted">{entry.callSign}</span>
                      )}
                      {entry.standing !== 'on' && (
                        <Badge tone="warn">{STANDING_LABEL[entry.standing]}</Badge>
                      )}
                      {entry.note && (
                        <span className="w-full text-[12px] leading-relaxed text-muted">
                          {entry.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/*
                The reason this panel exists. An uncovered beat on a whiteboard
                is a blank space, and a blank space among blank spaces is
                nothing anybody sees until a call drops there.
              */}
              {(cover.uncovered.length > 0 || cover.covered.length > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  {cover.covered.length > 0 && (
                    <span className="text-muted">
                      <span className="font-medium text-ink">Covered: </span>
                      {cover.covered.map((c) => `${c.beat} (${c.who.join(', ')})`).join(' · ')}
                    </span>
                  )}
                  {cover.uncovered.length > 0 && (
                    <span className="text-danger">
                      <span className="font-semibold">Nobody on: </span>
                      {cover.uncovered.join(' · ')}
                    </span>
                  )}
                </div>
              )}

              {live.length > 0 && (
                <ul className="mt-3 space-y-1.5 print:hidden">
                  {live.map((problem, index) => (
                    <li
                      key={`${problem.entryId}:${index}`}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
                        problem.severity === 'error'
                          ? 'border-danger/35 bg-danger-soft text-danger'
                          : 'border-warn/35 bg-warn/5 text-ink/80',
                      )}
                    >
                      <span className="font-semibold">{problem.title}. </span>
                      {problem.message} <span className="text-muted">{problem.tip}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The sheet, editable.
 *
 * A row of small inputs rather than a form per officer, because the person
 * filling it in is standing up, is late, and is changing three fields across
 * twelve rows. Every field is optional except the name: an agency with no
 * assigned cars leaves the car blank and an agency with no beats leaves the
 * beat blank, and neither of them should meet a required-field error for
 * having a different shape of department.
 */
function Editor({
  rows,
  zone,
  beats,
  officers,
  onChange,
  onRemove,
  onAdd,
  mine,
}: {
  rows: RosterEntry[];
  zone: string;
  beats: string[];
  officers: { id: string; name: string; badge: string }[];
  onChange: (id: string, patch: Partial<RosterEntry>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  mine: string;
}) {
  const cell =
    'w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink placeholder:text-faint';

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-line bg-canvas/60 p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
            <label className="sm:col-span-3">
              <span className="sr-only">Officer</span>
              <select
                value={row.officerId || '__free'}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id === '__free') {
                    onChange(row.id, { officerId: '' });
                    return;
                  }
                  const chosen = officers.find((o) => o.id === id);
                  onChange(row.id, {
                    officerId: id,
                    officerName: chosen?.name ?? '',
                    badge: chosen?.badge ?? '',
                  });
                }}
                className={cell}
              >
                {/*
                  A reserve, a cadet or a mutual-aid unit from the next town
                  has no account here and still stands a beat. Refusing to put
                  them on the sheet would send that name back to the
                  whiteboard, and with it the whole roster.
                */}
                <option value="__free">Somebody without an account…</option>
                {officers.map((officer) => (
                  <option key={officer.id} value={officer.id}>
                    {officer.name}
                    {officer.badge ? ` · ${officer.badge}` : ''}
                    {officer.id === mine ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {!row.officerId && (
              <label className="sm:col-span-3">
                <span className="sr-only">Name</span>
                <input
                  value={row.officerName}
                  onChange={(e) => onChange(row.id, { officerName: e.target.value })}
                  placeholder="Name"
                  className={cell}
                />
              </label>
            )}

            <label className={row.officerId ? 'sm:col-span-2' : 'sm:col-span-1'}>
              <span className="sr-only">{zone}</span>
              <input
                value={row.beat}
                onChange={(e) => onChange(row.id, { beat: e.target.value })}
                placeholder={zone}
                list={`beats-${row.id}`}
                className={cell}
              />
              <datalist id={`beats-${row.id}`}>
                {beats.map((beat) => (
                  <option key={beat} value={beat} />
                ))}
              </datalist>
            </label>

            <label className="sm:col-span-2">
              <span className="sr-only">Vehicle</span>
              <input
                value={row.vehicle}
                onChange={(e) => onChange(row.id, { vehicle: e.target.value })}
                placeholder="Car"
                className={cell}
              />
            </label>

            <label className="sm:col-span-2">
              <span className="sr-only">Call sign</span>
              <input
                value={row.callSign}
                onChange={(e) => onChange(row.id, { callSign: e.target.value })}
                placeholder="Call sign"
                className={cell}
              />
            </label>

            {/* Wide enough to read the word. A select showing "O…" is a
                control somebody has to open to find out what it says. */}
            <label className="sm:col-span-2">
              <span className="sr-only">Standing</span>
              <select
                value={row.standing}
                onChange={(e) => onChange(row.id, { standing: e.target.value as Standing })}
                className={cell}
              >
                {STANDINGS.map((standing) => (
                  <option key={standing} value={standing}>
                    {STANDING_LABEL[standing]}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-start justify-end sm:col-span-1">
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                aria-label={`Take ${row.officerName || 'this row'} off the roster`}
                className="flex size-8 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          </div>

          <input
            value={row.note}
            onChange={(e) => onChange(row.id, { note: e.target.value })}
            placeholder="Held over, riding with, back at ten…"
            className={cn(cell, 'mt-2')}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-[12.5px] text-muted transition hover:border-accent/45 hover:text-ink"
      >
        <Plus size={14} aria-hidden />
        Add somebody
      </button>
    </div>
  );
}
