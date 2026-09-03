import { useMemo, useState } from 'react';
import { Check, Loader2, PackagePlus } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  CATEGORY_LABEL,
  checkItem,
  type EvidenceCategory,
  type EvidenceItem,
} from '@/domain/evidence';
import { Button, FieldGrid } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Taking something into custody.
 *
 * The form an officer fills at the end of a shift with a bag in one hand, so it
 * asks for what has to be recorded while the thing is in front of them and
 * nothing that can be looked up later. Where it was found and what it weighs
 * cannot be reconstructed next week; the case number can.
 *
 * The shelf is optional here on purpose. An officer bagging property at 3am has
 * often not been to the property room yet, and forcing a shelf would either
 * produce a made-up one or stop the item being recorded at all — and an
 * unrecorded item is the thing this whole module exists to prevent. Left blank,
 * the chain says "collected" and the room's queue asks for it.
 */
export function BookIn({ onBooked }: { onBooked: () => void }) {
  const { incidents, bookEvidence } = useStore();

  const [category, setCategory] = useState<EvidenceCategory>('general');
  const [description, setDescription] = useState('');
  const [foundAt, setFoundAt] = useState('');
  const [quantity, setQuantity] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [caseId, setCaseId] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const openCases = useMemo(
    () => [...incidents].sort((a, b) => b.caseNumber.localeCompare(a.caseNumber)).slice(0, 200),
    [incidents],
  );

  // The same checks the server runs, so a problem shows before a round trip.
  const problems = checkItem({
    description,
    foundAt,
    category,
    quantity,
    serialNumber,
  } as EvidenceItem);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await bookEvidence({
      category,
      description,
      foundAt,
      quantity,
      serialNumber,
      make,
      model,
      caseId,
      caseNumber: openCases.find((c) => c.id === caseId)?.caseNumber ?? '',
      location,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'Could not book it in.');
      return;
    }
    setBooked(result.tagNumber ?? '');
  };

  if (booked !== null) {
    return (
      <div className="py-6">
        <p className="flex items-center gap-2 text-[14px] font-medium text-ok">
          <Check size={17} aria-hidden />
          Booked in as <span className="font-mono">{booked}</span>
        </p>
        <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted">
          Write that number on the bag. It is how this item is found on a shelf and how a lab or a
          court will refer to it.
          {!location && ' It is not on a shelf yet — the room will ask for it.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              // Same case and shelf, everything else fresh: property comes in
              // in armfuls from one scene, not one item at a time.
              setBooked(null);
              setDescription('');
              setFoundAt('');
              setQuantity('');
              setSerialNumber('');
              setMake('');
              setModel('');
            }}
          >
            <PackagePlus size={15} aria-hidden />
            Book in another
          </Button>
          <Button onClick={onBooked}>See everything</Button>
        </div>
      </div>
    );
  }

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink">What is it?</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABEL) as EvidenceCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition',
                category === c
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Black folding knife, 3in blade, wooden handle"
          className={control}
        />
        <span className="mt-1 block text-[12px] text-faint">
          Enough for somebody who has never seen it to pick it off a shelf.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">Where it was found</span>
        <input
          value={foundAt}
          onChange={(e) => setFoundAt(e.target.value)}
          placeholder="Driver footwell, under the seat"
          className={control}
        />
        <span className="mt-1 block text-[12px] text-faint">
          Where it physically was — this is the question asked in court, and it cannot be
          reconstructed afterwards.
        </span>
      </label>

      <FieldGrid cols={2}>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Quantity or weight
            {category === 'drug' && <span className="ml-1 text-danger">*</span>}
          </span>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={category === 'drug' ? '12.5 g' : '1'}
            className={control}
          />
          {category === 'drug' && (
            <span className="mt-1 block text-[12px] text-faint">
              Weighed and witnessed now. The quantity charged is read off this.
            </span>
          )}
        </label>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Serial number
            {category === 'firearm' && <span className="ml-1 text-danger">*</span>}
          </span>
          <input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder={category === 'firearm' ? 'Or "obliterated"' : 'If it has one'}
            className={cn(control, 'font-mono')}
          />
        </label>
      </FieldGrid>

      <FieldGrid cols={2}>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Make</span>
          <input value={make} onChange={(e) => setMake(e.target.value)} className={control} />
        </label>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className={control} />
        </label>
      </FieldGrid>

      <FieldGrid cols={2}>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Case</span>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={control}>
            <option value="">Found property — no case</option>
            {openCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.caseNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Shelf <span className="font-normal text-faint">if you are at the room</span>
          </span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room 2 · Shelf C · Bin 14"
            className={control}
          />
        </label>
      </FieldGrid>

      <div className="flex items-center gap-3 border-t border-line pt-3">
        <Button variant="primary" disabled={busy || problems.length > 0} onClick={() => void submit()}>
          {busy ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <PackagePlus size={15} aria-hidden />
          )}
          Book it in
        </Button>
        <span className="text-[12px] text-danger">{error ?? problems[0]?.message}</span>
      </div>
    </div>
  );
}
