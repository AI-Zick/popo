import { useMemo, useState } from 'react';
import { BookCheck, CheckCircle2, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  checkStatute,
  createStatute,
  isVerified,
  unverified,
  type Statute,
  TABLE_NOTICE,
} from '@/domain/statute';
import { hasStatutePack, PACKED_STATES, statutePack } from '@/domain/statutes';
import { OFFENSE_BY_CODE, OFFENSE_CODES } from '@/domain/codes';
import { Badge, Button, EmptyState, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The agency's statute table.
 *
 * Mostly a checking screen rather than a typing one. The state pack gives an
 * agency sixty-odd cites on the first day; the work is somebody sitting with
 * the published code and confirming each one, which is why the only prominent
 * action here is "checked" and the counter at the top counts what is left.
 *
 * That counter is the point. An unverified table still works — officers get
 * the list, narrowed to their offence, with the line that tells one degree
 * from the next — but every cite carries a warning at the moment it is
 * offered, and those warnings only go away one at a time, by somebody reading
 * the code.
 */
export function StatuteTable() {
  const { agency, updateAgency, currentUser, can } = useStore();
  const mayEdit = can('agency.configure');
  const statutes = useMemo(() => agency.statutes ?? [], [agency.statutes]);

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);

  const set = (id: string, patch: Partial<Statute>) =>
    updateAgency({
      statutes: statutes.map((statute) => (statute.id === id ? { ...statute, ...patch } : statute)),
    });

  const remove = (id: string) =>
    updateAgency({ statutes: statutes.filter((statute) => statute.id !== id) });

  const left = unverified(statutes);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return statutes
      .filter((statute) => !onlyUnchecked || !isVerified(statute))
      .filter(
        (statute) =>
          !q ||
          statute.cite.toLowerCase().includes(q) ||
          statute.title.toLowerCase().includes(q) ||
          statute.grade.toLowerCase().includes(q) ||
          statute.offenseCodes.some((code) =>
            (OFFENSE_BY_CODE.get(code)?.label ?? code).toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => a.cite.localeCompare(b.cite, undefined, { numeric: true }));
  }, [statutes, query, onlyUnchecked]);

  const packAvailable = hasStatutePack(agency.state);

  return (
    <div className="space-y-4">
      <Panel
        title="Statutes an officer can pick from"
        description={TABLE_NOTICE}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{statutes.length} in the table</Badge>
          {left.length > 0 ? (
            <Badge tone="warn">{left.length} not checked yet</Badge>
          ) : statutes.length > 0 ? (
            <Badge tone="ok">All checked</Badge>
          ) : null}
        </div>

        {left.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {left.length === 1 ? 'One cite has' : `${left.length} cites have`} not been checked
              against the published code. {left.length === 1 ? 'It is' : 'They are'} still offered
              to officers — with this warning attached — because a list with a caveat beats no list
              at all. Working through them is a real first-week job, not a formality.
            </span>
          </p>
        )}

        {statutes.length === 0 && (
          <div className="mt-3">
            <EmptyState
              icon={<BookCheck size={20} />}
              title="No statutes yet"
              body={
                packAvailable
                  ? `There is a starting table for ${agency.state}. Choosing the state again on the Jurisdiction tab brings it in.`
                  : `No starting table exists for ${agency.state || 'this state'} yet — packs so far: ${PACKED_STATES.join(', ')}. Add the cites your officers use most and they are offered to everybody from then on.`
              }
              action={
                mayEdit && packAvailable ? (
                  <Button
                    variant="primary"
                    onClick={() =>
                      updateAgency({ statutes: statutePack(agency.state) })
                    }
                  >
                    Load the {agency.state} starting table
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </Panel>

      {statutes.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cite, offence name, grade…"
                aria-label="Search the statute table"
                className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <input
                type="checkbox"
                checked={onlyUnchecked}
                onChange={(e) => setOnlyUnchecked(e.target.checked)}
              />
              Only the unchecked ones
            </label>
            {mayEdit && (
              <Button onClick={() => setAdding(true)}>
                <Plus size={15} aria-hidden />
                Add a statute
              </Button>
            )}
          </div>

          {adding && (
            <NewStatute
              existing={statutes}
              onDone={(statute) => {
                if (statute) updateAgency({ statutes: [...statutes, statute] });
                setAdding(false);
              }}
            />
          )}

          <ul className="space-y-2">
            {shown.map((statute) => (
              <StatuteRow
                key={statute.id}
                statute={statute}
                mayEdit={mayEdit}
                onChange={set}
                onRemove={() => remove(statute.id)}
                checkedBy={currentUser?.name ?? ''}
              />
            ))}
          </ul>

          {shown.length === 0 && (
            <p className="text-[13px] leading-relaxed text-muted">Nothing matches that.</p>
          )}
        </>
      )}
    </div>
  );
}

const field =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint disabled:opacity-60';

function StatuteRow({
  statute,
  mayEdit,
  onChange,
  onRemove,
  checkedBy,
}: {
  statute: Statute;
  mayEdit: boolean;
  onChange: (id: string, patch: Partial<Statute>) => void;
  onRemove: () => void;
  checkedBy: string;
}) {
  const [open, setOpen] = useState(false);
  const checked = isVerified(statute);

  return (
    /*
      Unchecked is the ordinary state of this table on day one, so it is not
      tinted. Colouring all sixty-eight rows amber would make the colour mean
      nothing — the count at the top carries that, and the row carries the
      action. What a row shows is the confirmation once somebody has done it.
    */
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[13px] font-medium text-ink">{statute.cite}</span>
            <span className="text-[13.5px] text-ink">{statute.title}</span>
            {statute.grade && <span className="text-[12px] text-muted">{statute.grade}</span>}
          </p>
          {statute.distinguishes && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              {statute.distinguishes}
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-faint">
            {statute.offenseCodes
              .map((code) => OFFENSE_BY_CODE.get(code)?.label ?? code)
              .join(' · ') || 'No offences linked'}
          </p>
          {checked && (
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ok">
              <CheckCircle2 size={12} aria-hidden />
              Checked {statute.verifiedOn}
              {statute.verifiedBy && ` by ${statute.verifiedBy}`}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {mayEdit &&
            (checked ? (
              <Button
                size="sm"
                onClick={() => onChange(statute.id, { verifiedOn: '', verifiedBy: '' })}
                title="Mark it unchecked again"
              >
                Unmark
              </Button>
            ) : (
              /*
                The one prominent action on this screen. Everything else here
                is editing; this is the thing that has to actually happen, and
                it happens sixty times.
              */
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  onChange(statute.id, {
                    verifiedOn: new Date().toISOString().slice(0, 10),
                    verifiedBy: checkedBy,
                  })
                }
              >
                <CheckCircle2 size={13} aria-hidden />
                Mark checked
              </Button>
            ))}
          {mayEdit && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-canvas hover:text-ink"
            >
              {open ? 'Close' : 'Edit'}
            </button>
          )}
          {mayEdit && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${statute.cite}`}
              className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-danger"
            >
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {open && mayEdit && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <input
            value={statute.cite}
            onChange={(e) => onChange(statute.id, { cite: e.target.value })}
            placeholder="Cite"
            className={cn(field, 'font-mono')}
          />
          <input
            value={statute.title}
            onChange={(e) => onChange(statute.id, { title: e.target.value })}
            placeholder="What it is called"
            className={field}
          />
          <input
            value={statute.grade}
            onChange={(e) => onChange(statute.id, { grade: e.target.value })}
            placeholder="Class B felony"
            className={field}
          />
          <input
            value={statute.note}
            onChange={(e) => onChange(statute.id, { note: e.target.value })}
            placeholder="Anything your officers should know"
            className={field}
          />
          <input
            value={statute.distinguishes}
            onChange={(e) => onChange(statute.id, { distinguishes: e.target.value })}
            placeholder="What separates this degree from the next one"
            className={cn(field, 'sm:col-span-2')}
          />
          <div className="sm:col-span-2">
            <OffenceCodes
              codes={statute.offenseCodes}
              onChange={(codes) => onChange(statute.id, { offenseCodes: codes })}
            />
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Which offences can be charged under a statute.
 *
 * Many-to-many, and both directions are ordinary: burglary has three degrees,
 * and one theft statute graded by value answers to larceny, shoplifting and
 * theft from a building alike.
 */
function OffenceCodes({
  codes,
  onChange,
}: {
  codes: string[];
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = query.trim()
    ? OFFENSE_CODES.filter(
        (offense) =>
          !codes.includes(offense.code) &&
          (offense.label.toLowerCase().includes(query.trim().toLowerCase()) ||
            offense.code.toLowerCase().includes(query.trim().toLowerCase())),
      ).slice(0, 6)
    : [];

  return (
    <div>
      <p className="mb-1.5 text-[11.5px] text-muted">Offences that can be charged under this</p>
      <div className="flex flex-wrap gap-1.5">
        {codes.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onChange(codes.filter((c) => c !== code))}
            className="flex items-center gap-1 rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink transition hover:border-danger/40 hover:text-danger"
          >
            {OFFENSE_BY_CODE.get(code)?.label ?? code}
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add an offence…"
        aria-label="Add an offence"
        className={cn(field, 'mt-1.5')}
      />
      {matches.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {matches.map((offense) => (
            <li key={offense.code}>
              <button
                type="button"
                onClick={() => {
                  onChange([...codes, offense.code]);
                  setQuery('');
                }}
                className="w-full rounded px-2 py-1 text-left text-[12.5px] text-ink transition hover:bg-raised"
              >
                <span className="font-mono text-[11.5px] text-faint">{offense.code}</span>{' '}
                {offense.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewStatute({
  existing,
  onDone,
}: {
  existing: Statute[];
  onDone: (statute: Statute | null) => void;
}) {
  const { currentUser } = useStore();
  const [draft, setDraft] = useState<Statute>(() =>
    createStatute({
      id: `st-${Date.now().toString(36)}`,
      /*
        Anything an agency types in here they have, by definition, just looked
        up — so it starts checked, with their name on it. The unchecked state
        is for what we shipped, not for what they wrote.
      */
      verifiedOn: new Date().toISOString().slice(0, 10),
      verifiedBy: currentUser?.name ?? '',
    }),
  );
  const check = checkStatute(draft, existing);

  return (
    <div className="space-y-2 rounded-xl border border-line bg-canvas p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          autoFocus
          value={draft.cite}
          onChange={(e) => setDraft({ ...draft, cite: e.target.value })}
          placeholder="Cite — 13A-7-6, or a local ordinance"
          className={cn(field, 'font-mono')}
        />
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="What it is called"
          className={field}
        />
        <input
          value={draft.grade}
          onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
          placeholder="Class B felony"
          className={field}
        />
        <input
          value={draft.distinguishes}
          onChange={(e) => setDraft({ ...draft, distinguishes: e.target.value })}
          placeholder="What separates it from the next degree"
          className={field}
        />
      </div>
      <OffenceCodes
        codes={draft.offenseCodes}
        onChange={(codes) => setDraft({ ...draft, offenseCodes: codes })}
      />
      {!check.ok && <p className="text-[12px] text-danger">{check.reason}</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!check.ok} onClick={() => onDone(draft)}>
          Add it
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
