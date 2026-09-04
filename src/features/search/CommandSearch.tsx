import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Car, FileText, MapPin, Search, User, X } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  buildIndex,
  groupResults,
  KIND_LABEL,
  search,
  type ResultKind,
  type SearchResult,
} from '@/domain/search';
import { cn } from '@/lib/cn';

const ICON: Record<ResultKind, typeof User> = {
  person: User,
  location: MapPin,
  incident: FileText,
  crash: Car,
  vehicle: Car,
};

/**
 * Search, everywhere.
 *
 * Officers search far more than they write, so this is reachable from anywhere
 * with Ctrl-K and driven entirely from the keyboard: type, arrow, Enter. No
 * pointer required, because half the time there is one hand free.
 *
 * The index is memoised on the underlying data rather than rebuilt per
 * keystroke, and querying it is a postings intersection — so typing stays
 * instant on an agency with a large name index rather than degrading into a
 * scan of every record on every character.
 */
export function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { people, locations, vehicles, incidents, crashes, openIncident, openCrash, showFile } =
    useStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Rebuilt only when the data behind it changes, not on every keystroke.
  const index = useMemo(
    () => buildIndex({ people, locations, vehicles, incidents, crashes }),
    [people, locations, vehicles, incidents, crashes],
  );

  const results = useMemo(() => search(index, query), [index, query]);
  const groups = useMemo(() => groupResults(results), [results]);
  // Flattened in display order, so arrow keys walk what the eye sees.
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const choose = (result: SearchResult) => {
    switch (result.target.kind) {
      case 'incident':
        openIncident(result.target.id);
        break;
      case 'crash':
        openCrash(result.target.id);
        break;
      case 'person':
      case 'location':
      case 'vehicle':
        /*
          The record itself, over whatever is on screen. It used to open the
          most recent report the record appeared on, which answered a
          different question from the one being asked — somebody searching a
          name at 2am wants the person, not the last burglary they witnessed.
        */
        showFile({ kind: result.target.kind, id: result.target.id });
        break;
    }
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && flat[active]) {
        e.preventDefault();
        choose(flat[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, active, onClose]);

  // Keeps the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="shrink-0 text-faint" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, plate, address, case number…"
            aria-label="Search everything"
            className="flex-1 bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-faint transition hover:text-ink"
              aria-label="Clear"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {query.trim() === '' ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-muted">
                Search {index.size.toLocaleString()} records — people, places, vehicles and reports.
              </p>
              <p className="mt-1.5 text-[12px] text-faint">
                A plate, a surname, a street, a case number. Two words narrow it.
              </p>
            </div>
          ) : flat.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-ink">Nothing matches “{query}”.</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                Every word has to match. Try fewer of them, or check the spelling of a surname —
                this looks for what you typed, not what it sounds like.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <p className="sticky top-0 bg-surface/95 px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint backdrop-blur">
                  {KIND_LABEL[group.kind]}
                </p>
                {group.results.map((result) => {
                  cursor += 1;
                  const isActive = cursor === active;
                  const Icon = ICON[result.kind];
                  return (
                    <button
                      key={result.key}
                      type="button"
                      data-active={isActive}
                      onMouseEnter={() => setActive(flat.indexOf(result))}
                      onClick={() => choose(result)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-2.5 text-left transition',
                        isActive ? 'bg-accent-soft' : 'hover:bg-raised',
                      )}
                    >
                      <Icon size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          {result.title}
                        </span>
                        {result.subtitle && (
                          <span className="block truncate text-[12px] text-muted">
                            {result.subtitle}
                          </span>
                        )}
                        {result.detail && (
                          <span className="block truncate text-[11.5px] text-faint">
                            {result.detail}
                          </span>
                        )}
                        {/*
                          Cautions are the reason somebody searched a name at
                          2am. They belong on the row, not one click further in.
                        */}
                        {result.cautions.map((caution) => (
                          <span
                            key={caution}
                            className="mt-1 flex items-start gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[11.5px] text-ink"
                          >
                            <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                            {caution}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint">
          <Key>↑</Key>
          <Key>↓</Key>
          to move
          <Key>↵</Key>
          to open
          <Key>esc</Key>
          to close
          <span className="flex-1" />
          {flat.length > 0 && <span>{flat.length} result{flat.length === 1 ? '' : 's'}</span>}
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}

/** Ctrl-K / Cmd-K from anywhere, and `/` when not already typing. */
export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}
