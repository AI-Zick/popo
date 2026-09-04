import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, EyeOff, Loader2, MessagesSquare, TriangleAlert } from 'lucide-react';
import { api, type ContactList } from '@/state/api';
import {
  BASIS_LABEL,
  DISPOSITION_LABEL,
  NOT_EVIDENCE,
  retentionLine,
} from '@/domain/fieldContact';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { RecordContact } from './RecordContact';

/**
 * Every time this person has been spoken to.
 *
 * Folded away by default, and the one section on this screen that leads with a
 * caveat rather than a count. A list of conversations reads, to anybody who did
 * not write them, like a record of wrongdoing — and most people on a list like
 * this have never been charged with anything. Saying so costs one line and is
 * the difference between a record and an accusation.
 *
 * Each entry carries the day it will be disposed of, because a record of
 * somebody who was not charged should not quietly become permanent.
 */
export function PersonContacts({
  masterId,
  personName,
}: {
  masterId: string;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ContactList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await api.personContacts(masterId));
    } catch {
      setError('Could not load field contacts for this person.');
    }
  }, [masterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = list?.contacts.length ?? 0;

  return (
    <section className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <MessagesSquare size={16} className="text-faint" aria-hidden />
        <span className="text-[14px] font-medium text-ink">Field contacts</span>
        <span className="text-[13px] text-muted">
          {list === null && !error ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : count === 0 ? (
            'None'
          ) : (
            `${count} recorded`
          )}
        </span>
        <ChevronDown
          size={15}
          className={cn('ml-auto shrink-0 text-faint transition', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {error && (
            <p className="flex items-start gap-1.5 text-[12.5px] text-danger">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {/*
            First, before the list. Somebody scanning this needs the framing
            before the content, not underneath it.
          */}
          <p className="text-[12.5px] leading-relaxed text-muted">{list?.notice ?? NOT_EVIDENCE}</p>

          {list && list.contacts.length === 0 && (
            <p className="text-[13px] text-muted">
              No field contact has been recorded with {personName}.
            </p>
          )}

          {list?.contacts.map((contact) => (
            <div key={contact.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-medium text-ink">
                  {contact.occurredAt.slice(0, 10)}
                  {contact.address && ` · ${contact.address}`}
                </span>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide',
                    contact.basis === 'detention'
                      ? 'border-warn/50 text-warn'
                      : 'border-line text-muted',
                  )}
                >
                  {BASIS_LABEL[contact.basis]}
                </span>
              </div>

              <p className="mt-0.5 text-[12px] text-faint">
                {contact.number}
                {contact.officerName && ` · ${contact.officerName}`}
                {contact.disposition && ` · ${DISPOSITION_LABEL[contact.disposition]}`}
              </p>

              {contact.reason && (
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{contact.reason}</p>
              )}
              {contact.narrative && (
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{contact.narrative}</p>
              )}

              <p className="mt-1.5 text-[12px] text-faint">
                {retentionLine(contact, list.retentionYears)}
              </p>
            </div>
          ))}

          {/*
            A list that quietly omits things teaches its reader that it is
            complete. An officer who thinks they have seen everything is worse
            off than one who knows they have not.
          */}
          {list?.hidden ? (
            <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
              <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden />
              {list.hidden} more {list.hidden === 1 ? 'was' : 'were'} written by other officers. A
              supervisor or records can see those.
            </p>
          ) : null}

          <Button size="sm" onClick={() => setAdding(true)}>
            <MessagesSquare size={13} aria-hidden />
            Record a contact
          </Button>
        </div>
      )}

      {adding && (
        <RecordContact
          personId={masterId}
          personName={personName}
          onClose={() => setAdding(false)}
          onRecorded={() => {
            setAdding(false);
            setOpen(true);
            void load();
          }}
        />
      )}
    </section>
  );
}
