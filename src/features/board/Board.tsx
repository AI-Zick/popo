import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  Megaphone,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError, type PostedBulletin } from '@/state/api';
import { can } from '@/domain/auth';
import {
  daysLeft,
  KIND_LABEL,
  needsReview,
  REVIEW_DAYS,
  STATE_LABEL,
  type Bulletin,
  type BulletinKind,
  type BulletinState,
} from '@/domain/bulletin';
import { Badge, Button, EmptyState, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { PostBulletin } from './PostBulletin';
import { cn } from '@/lib/cn';

/**
 * The board.
 *
 * Two views of one list. The panel on the home page is what a shift sees
 * without asking — officer safety first, then lookouts, then the rest — and it
 * is deliberately not a page you have to go to, because a board somebody has
 * to navigate to is a board they read on their first day and never again.
 *
 * The full screen behind it is where somebody answers "what did that BOLO
 * actually say", which is a question asked weeks later about something that is
 * no longer live. So that view can show the cleared, the expired and the
 * withdrawn, and says which is which rather than quietly folding them together.
 */

const TONE: Record<BulletinKind, string> = {
  officerSafety: 'border-danger/40 bg-danger-soft/50',
  bolo: 'border-accent/35 bg-accent-soft/40',
  attemptToLocate: 'border-warn/35 bg-warn/5',
  information: 'border-line bg-canvas',
};

const KIND_ICON: Record<BulletinKind, React.ReactNode> = {
  officerSafety: <ShieldAlert size={13} aria-hidden />,
  bolo: <Search size={13} aria-hidden />,
  attemptToLocate: <Search size={13} aria-hidden />,
  information: <Megaphone size={13} aria-hidden />,
};

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function useBoard(include?: 'all') {
  const [bulletins, setBulletins] = useState<PostedBulletin[] | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    let cancelled = false;
    api.bulletins(include).then(
      (result) => {
        if (!cancelled) {
          setBulletins(result.bulletins);
          setError('');
        }
      },
      (problem: unknown) => {
        if (cancelled) return;
        /*
          Said, not swallowed. An empty board and a board that failed to load
          look identical, and one of them means "there are no warnings" while
          the other means "you have not been told the warnings".
        */
        setBulletins([]);
        setError(
          problem instanceof ApiError || problem instanceof Error
            ? problem.message
            : 'The board could not be loaded.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [include]);

  useEffect(reload, [reload]);
  return { bulletins, error, reload };
}

/* ------------------------------------------------------------------ */
/* The home page panel                                                 */
/* ------------------------------------------------------------------ */

export function BoardPanel({ onOpenBoard }: { onOpenBoard: () => void }) {
  const { currentUser } = useStore();
  const { bulletins, error, reload } = useBoard();
  const [posting, setPosting] = useState(false);
  const live = bulletins ?? [];
  const shown = live.slice(0, 4);

  return (
    <Panel
      title="Board"
      description="What the shift needs to know. Anyone can post; dispatch and administrators take things down."
      aside={
        <span className="flex items-center gap-2">
          {live.length > shown.length && (
            <button
              type="button"
              onClick={onOpenBoard}
              className="text-[12px] text-accent hover:underline"
            >
              All {live.length}
            </button>
          )}
          {can(currentUser, 'bulletins.post') && (
            <Button onClick={() => setPosting(true)}>
              <Plus size={14} aria-hidden />
              Post
            </Button>
          )}
        </span>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {bulletins === null ? (
        <p className="flex items-center gap-2 py-4 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Reading the board…
        </p>
      ) : live.length === 0 ? (
        <p className="py-3 text-[13px] text-muted">
          Nothing on the board. {can(currentUser, 'bulletins.post') && 'Post a BOLO if you have one.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((bulletin) => (
            <li key={bulletin.id}>
              <button
                type="button"
                onClick={onOpenBoard}
                className={cn(
                  'w-full rounded-xl border px-3 py-2.5 text-left transition hover:border-line-strong',
                  TONE[bulletin.kind],
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={bulletin.kind === 'officerSafety' ? 'danger' : 'neutral'}>
                    <span className="flex items-center gap-1">
                      {KIND_ICON[bulletin.kind]}
                      {KIND_LABEL[bulletin.kind]}
                    </span>
                  </Badge>
                  <span className="text-[13.5px] font-medium text-ink">{bulletin.headline}</span>
                </span>
                {bulletin.lookFor && (
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">
                    {bulletin.lookFor}
                  </span>
                )}
                <span className="mt-1 block text-[11.5px] text-faint">
                  {bulletin.postedByName || 'Unknown'} · {relativeTime(bulletin.postedAt)}
                  <Expiry bulletin={bulletin} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {live.length > shown.length && (
        <button
          type="button"
          onClick={onOpenBoard}
          className="mt-2 text-[12px] text-accent hover:underline"
        >
          {live.length - shown.length} more on the board
        </button>
      )}

      {posting && (
        <PostBulletin
          onClose={() => setPosting(false)}
          onPosted={() => {
            setPosting(false);
            reload();
          }}
        />
      )}
    </Panel>
  );
}

/** " · 3 days left", or the standing-warning prompt. Never a bare date. */
function Expiry({ bulletin }: { bulletin: Bulletin }) {
  const left = daysLeft(bulletin);
  if (left === null) {
    return needsReview(bulletin) ? (
      <span className="text-warn"> · standing over {REVIEW_DAYS} days — still current?</span>
    ) : (
      <span> · no end date</span>
    );
  }
  if (left <= 1) return <span className="text-warn"> · ends today</span>;
  return <span> · {left} days left</span>;
}

/* ------------------------------------------------------------------ */
/* The full screen                                                     */
/* ------------------------------------------------------------------ */

type Filter = 'live' | 'all';

export function BoardScreen({ onClose }: { onClose: () => void }) {
  const { currentUser } = useStore();
  const [filter, setFilter] = useState<Filter>('live');
  const { bulletins, error, reload } = useBoard(filter === 'all' ? 'all' : undefined);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<Bulletin | null>(null);
  const rows = bulletins ?? [];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Megaphone size={17} aria-hidden />
          Board
        </span>
        <div className="flex-1" />
        <div className="flex gap-1">
          <Chip active={filter === 'live'} onClick={() => setFilter('live')} label="On the board" />
          <Chip active={filter === 'all'} onClick={() => setFilter('all')} label="Everything" />
        </div>
        {can(currentUser, 'bulletins.post') && (
          <Button variant="primary" onClick={() => setPosting(true)}>
            <Plus size={14} aria-hidden />
            Post
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-5">
          {filter === 'all' && (
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Everything ever posted, including what has been cleared, has expired or was taken
              down. Nothing is deleted from here — an entry that came off the board still says who
              took it off and why.
            </p>
          )}

          {error && (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {bulletins === null ? (
            <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Reading the board…
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Megaphone size={22} aria-hidden />}
              title={filter === 'live' ? 'Nothing on the board' : 'Nothing has been posted yet'}
              body={
                filter === 'live'
                  ? 'A BOLO, a lookout, a note for the shift — anything the next officer on needs to know.'
                  : 'Entries stay here after they come off the board, so this stays empty until something is posted.'
              }
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((bulletin) => (
                <BoardRow
                  key={bulletin.id}
                  bulletin={bulletin}
                  onChanged={reload}
                  onEdit={() => setEditing(bulletin)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {(posting || editing) && (
        <PostBulletin
          existing={editing ?? undefined}
          onClose={() => {
            setPosting(false);
            setEditing(null);
          }}
          onPosted={() => {
            setPosting(false);
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-[12px] font-medium transition',
        active ? 'bg-raised text-ink ring-1 ring-line' : 'text-muted hover:bg-raised/60',
      )}
    >
      {label}
    </button>
  );
}

const STATE_TONE: Record<BulletinState, 'ok' | 'neutral' | 'danger'> = {
  live: 'ok',
  cleared: 'neutral',
  expired: 'neutral',
  removed: 'danger',
};

function BoardRow({
  bulletin,
  onChanged,
  onEdit,
}: {
  bulletin: PostedBulletin;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { currentUser } = useStore();
  const [asking, setAsking] = useState<'clear' | 'remove' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const mine = bulletin.postedById === currentUser.id;
  const mayRemove = can(currentUser, 'bulletins.remove');
  const live = bulletin.state === 'live';

  const act = async () => {
    if (!asking || !reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (asking === 'clear') await api.clearBulletin(bulletin.id, reason.trim());
      else await api.removeBulletin(bulletin.id, reason.trim());
      setAsking(null);
      setReason('');
      onChanged();
    } catch (problem) {
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : 'That did not work.',
      );
    }
    setBusy(false);
  };

  return (
    <li className={cn('rounded-xl border p-4', live ? TONE[bulletin.kind] : 'border-line bg-canvas opacity-75')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={bulletin.kind === 'officerSafety' && live ? 'danger' : 'neutral'}>
          <span className="flex items-center gap-1">
            {KIND_ICON[bulletin.kind]}
            {KIND_LABEL[bulletin.kind]}
          </span>
        </Badge>
        {!live && <Badge tone={STATE_TONE[bulletin.state]}>{STATE_LABEL[bulletin.state]}</Badge>}
        <span className="text-[14px] font-medium text-ink">{bulletin.headline}</span>
      </div>

      {bulletin.lookFor && (
        <p className="mt-2 text-[13px] leading-relaxed text-ink">{bulletin.lookFor}</p>
      )}
      {bulletin.detail && (
        <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
          {bulletin.detail}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span>
          {bulletin.postedByName || 'Unknown'} · {relativeTime(bulletin.postedAt)}
        </span>
        {bulletin.area && <span>{bulletin.area}</span>}
        {bulletin.caseNumber && <span className="font-mono">{bulletin.caseNumber}</span>}
        {bulletin.contact && (
          <span className="flex items-center gap-1">
            <Phone size={11} aria-hidden />
            {bulletin.contact}
          </span>
        )}
        {live && (
          <span className="flex items-center gap-1">
            <Clock size={11} aria-hidden />
            <Expiry bulletin={bulletin} />
          </span>
        )}
      </p>

      {/*
        How it ended, kept on the entry. The question asked later is never just
        "was this cleared" — it is who decided that, and on what.
      */}
      {bulletin.cleared && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted">
          <Check size={13} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          Cleared by {bulletin.cleared.byName} {relativeTime(bulletin.cleared.at)} —{' '}
          {bulletin.cleared.reason}
        </p>
      )}
      {bulletin.removed && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted">
          <Trash2 size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          Taken off the board by {bulletin.removed.byName} {relativeTime(bulletin.removed.at)} —{' '}
          {bulletin.removed.reason}
        </p>
      )}

      {live && (mine || mayRemove) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(mine || mayRemove) && (
            <Button onClick={onEdit}>
              <Pencil size={13} aria-hidden />
              Change it
            </Button>
          )}
          {(mine || mayRemove) && (
            <Button onClick={() => setAsking('clear')}>
              <Check size={13} aria-hidden />
              It is over
            </Button>
          )}
          {mayRemove && (
            <Button onClick={() => setAsking('remove')}>
              <Trash2 size={13} aria-hidden />
              Take it down
            </Button>
          )}
        </div>
      )}

      {/*
        Not a confirm box. Both of these need a reason on the record, and a
        dialog that only asks "are you sure" collects nothing — the question
        somebody has afterwards is why, not whether.
      */}
      {asking && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
              {asking === 'clear'
                ? 'What happened? Found, arrested, called off.'
                : 'Why is this coming down?'}
            </span>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink"
            />
          </label>
          {asking === 'remove' && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              It comes off the board but is not deleted — it stays under Everything, with your name
              and this reason on it.
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={act} disabled={!reason.trim() || busy}>
              {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
              {asking === 'clear' ? 'Clear it' : 'Take it down'}
            </Button>
            <Button
              onClick={() => {
                setAsking(null);
                setReason('');
                setError('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
