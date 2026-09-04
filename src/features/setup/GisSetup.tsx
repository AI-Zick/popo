import { useState } from 'react';
import { CheckCircle2, MapPin, Plug, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError } from '@/state/api';
import {
  checkEndpoint,
  checkSource,
  emptyGisSource,
  GIS_KIND_LABEL,
  UNTESTED_NOTICE,
  WHY_COUNTY,
  type AddressCandidate,
  type GisKind,
  type GisSource,
} from '@/domain/gis';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Connecting the county's address layer.
 *
 * A setup screen that is really a diagnostic one. Two organisations have to
 * agree on a URL and a set of field names, usually over the telephone, and the
 * thing that makes that call short is the software saying which half is wrong
 * — the endpoint, or the mapping — rather than "could not connect".
 *
 * So the test button does both jobs at once: it proves the connection and it
 * reads back what the county calls its fields, because at the moment somebody
 * is setting this up those are the same question.
 */
export function GisSetup() {
  const { agency, updateAgency, can } = useStore();
  const mayEdit = can('agency.configure');
  const source = agency.gis ?? emptyGisSource();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; advice?: string } | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [sample, setSample] = useState<AddressCandidate[]>([]);

  const set = (patch: Partial<GisSource>) => updateAgency({ gis: { ...source, ...patch } });
  const setField = (patch: Partial<GisSource['fields']>) =>
    set({ fields: { ...source.fields, ...patch } });

  /*
    Two checks, because they gate different things. The endpoint is all the
    test button needs — that request is how somebody learns the field names in
    the first place. The mapping is what searching needs, and until it is set
    the connection is reachable but not yet usable, which the screen should say
    in those words rather than by greying out the button that would fix it.
  */
  const endpoint = checkEndpoint(source);
  const check = checkSource(source);
  const tested = Boolean(source.checkedOn);
  const ready = check.ok && tested;

  const test = async () => {
    setBusy(true);
    setProblem(null);
    setSample([]);
    try {
      const result = await api.testGis(source);
      setNames(result.fields);
      setSample(result.sample);
      /*
        The guess only fills what is still blank. Somebody who has already
        mapped a field by hand has looked at the county's list and decided;
        overwriting that with a pattern match would be the software knowing
        better than the person who rang the county.
      */
      const guessed = Object.fromEntries(
        Object.entries(result.guess).filter(
          ([key, value]) => value && !source.fields[key as keyof GisSource['fields']],
        ),
      );
      set({
        checkedOn: new Date().toISOString().slice(0, 10),
        fields: { ...source.fields, ...guessed },
      });
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string; advice?: string }) : null;
      setProblem({ error: body?.error ?? String(error), advice: body?.advice });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="The county's address layer" description={WHY_COUNTY}>
        <div className="flex flex-wrap items-center gap-2">
          {source.kind ? (
            ready ? (
              <Badge tone="ok">Reached {source.checkedOn}</Badge>
            ) : tested ? (
              <Badge tone="warn">Reached, fields not mapped</Badge>
            ) : (
              <Badge tone="warn">Not tested</Badge>
            )
          ) : (
            <Badge tone="neutral">Not set up</Badge>
          )}
          {source.basemapUrl && <Badge tone="accent">Basemap configured</Badge>}
        </div>

        {source.kind && !tested && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>{UNTESTED_NOTICE}</span>
          </p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-muted">How the county publishes</span>
            <select
              disabled={!mayEdit}
              value={source.kind}
              onChange={(e) => set({ kind: e.target.value as GisKind, checkedOn: '' })}
              className={field}
            >
              {(['', 'arcgis', 'geojson'] as GisKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {GIS_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11.5px] text-muted">Who to ring at the county</span>
            <input
              disabled={!mayEdit}
              value={source.contact}
              onChange={(e) => set({ contact: e.target.value })}
              placeholder="GIS office, name and number"
              className={field}
            />
          </label>
        </div>

        {source.kind !== '' && (
          <>
            <label className="mt-3 block">
              <span className="mb-1 block text-[11.5px] text-muted">
                {source.kind === 'arcgis'
                  ? 'The layer’s endpoint — ending in the layer number'
                  : 'The GeoJSON endpoint or file'}
              </span>
              <input
                disabled={!mayEdit}
                value={source.url}
                onChange={(e) => set({ url: e.target.value, checkedOn: '' })}
                placeholder={
                  source.kind === 'arcgis'
                    ? 'https://gis.county.gov/arcgis/rest/services/Addresses/FeatureServer/0'
                    : 'https://gis.county.gov/open-data/addresses.geojson'
                }
                className={cn(field, 'font-mono text-[12px]')}
              />
            </label>

            {source.kind === 'geojson' && (
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                A plain file has no query language, so the whole thing is read and filtered on each
                search. Fine for a small county; ask them for a queryable layer if it is slow.
              </p>
            )}

            {!endpoint.ok && (
              <div className="mt-2 rounded-lg border border-danger/35 bg-danger-soft p-2.5">
                <p className="text-[12.5px] font-medium text-danger">{endpoint.reason}</p>
                {endpoint.advice && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink/80">{endpoint.advice}</p>
                )}
              </div>
            )}

            {mayEdit && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={busy || !endpoint.ok} onClick={() => void test()}>
                  <Plug size={15} aria-hidden />
                  {busy ? 'Asking the county…' : 'Test the connection'}
                </Button>
                <span className="text-[11.5px] text-faint">
                  Asks for a few records and reads back what the county calls its fields.
                </span>
              </div>
            )}

            {problem && (
              <div className="mt-3 rounded-xl border border-danger/35 bg-danger-soft p-3">
                <p className="text-[12.5px] font-medium text-danger">{problem.error}</p>
                {problem.advice && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink/80">{problem.advice}</p>
                )}
                {source.contact && (
                  <p className="mt-1.5 text-[11.5px] text-muted">County contact: {source.contact}</p>
                )}
              </div>
            )}

            {sample.length > 0 && (
              <div className="mt-3 rounded-xl border border-ok/40 bg-ok-soft p-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
                  <CheckCircle2 size={14} aria-hidden />
                  The county answered. Here is what came back:
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {sample.map((candidate, index) => (
                    <li key={index} className="text-[12px] text-ink">
                      {candidate.address}
                      {candidate.city && `, ${candidate.city}`}{' '}
                      <span className="font-mono text-faint">
                        {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Panel>

      {source.kind !== '' && (
        <Panel
          title="Which field holds what"
          description="Every county names these differently. The test above reads the names back; these are the ones this agency's layer publishes."
        >
          {!check.ok && check.field === 'fields' && (
            <div className="mb-3 rounded-lg border border-warn/45 bg-warn/5 p-2.5">
              <p className="text-[12.5px] font-medium text-warn">{check.reason}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink/80">
                {check.advice} Until this is set, searching stays quiet — nothing breaks, officers
                just do not see county addresses yet.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldPick
              label="Composed address"
              hint="Where the county publishes the whole line. Leave blank if it publishes number and street separately."
              value={source.fields.fullAddress}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ fullAddress: v })}
            />
            <FieldPick
              label="Unit / apartment"
              value={source.fields.unit}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ unit: v })}
            />
            <FieldPick
              label="House number"
              value={source.fields.houseNumber}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ houseNumber: v })}
            />
            <FieldPick
              label="Street"
              value={source.fields.street}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ street: v })}
            />
            <FieldPick
              label="City"
              value={source.fields.city}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ city: v })}
            />
            <FieldPick
              label="ZIP"
              value={source.fields.zip}
              names={names}
              disabled={!mayEdit}
              onChange={(v) => setField({ zip: v })}
            />
          </div>
        </Panel>
      )}

      {source.kind !== '' && (
        <Panel
          title="Streets under the pin"
          description="Optional, and a separate question from where an address is. Where the county publishes map tiles, they can be drawn beneath the jurisdiction outline."
          aside={<MapPin size={17} className="text-faint" aria-hidden />}
        >
          <input
            disabled={!mayEdit}
            value={source.basemapUrl}
            onChange={(e) => set({ basemapUrl: e.target.value })}
            placeholder="https://tiles.county.gov/roads/{z}/{x}/{y}.png"
            className={cn(field, 'font-mono text-[12px]')}
          />
          <input
            disabled={!mayEdit}
            value={source.attribution}
            onChange={(e) => set({ attribution: e.target.value })}
            placeholder="How the county wants to be credited, where they require it"
            className={cn(field, 'mt-2')}
          />
        </Panel>
      )}
    </div>
  );
}

const field =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint disabled:opacity-60';

/**
 * One field mapping.
 *
 * A list once the county has been asked, free text before that — because
 * somebody may be working from a printout of the field list rather than a live
 * connection, and refusing to let them type it would make the telephone call
 * longer rather than shorter.
 */
function FieldPick({
  label,
  hint,
  value,
  names,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  names: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `gis-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-muted">{label}</span>
      <input
        id={id}
        list={names.length > 0 ? `${id}-names` : undefined}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Field name"
        className={cn(field, 'font-mono text-[12px]')}
      />
      {names.length > 0 && (
        <datalist id={`${id}-names`}>
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}
