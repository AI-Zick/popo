import { useState } from 'react';
import { Building2, Check, ChevronLeft, MapPinned, TriangleAlert, Upload } from 'lucide-react';
import { useStore } from '@/state/store';
import { parseGeoJSON, type GeoFeatureCollection } from '@/domain/geo';
import { ZONE_LABELS } from '@/domain/agency';
import { STATES } from '@/domain/codes';
import { Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { ZoneMap } from '@/components/location/ZoneMap';
import { UserAdmin } from './UserAdmin';
import { cn } from '@/lib/cn';

/**
 * One-time configuration. Everything here is per-install, and the boundary
 * files come from whatever the agency already has — county GIS, the CAD
 * vendor, or the 911 addressing authority.
 */
type Tab = 'jurisdiction' | 'accounts';

export function AgencySetup({ onClose }: { onClose: () => void }) {
  const { agency, updateAgency, can } = useStore();

  const mayConfigure = can('agency.configure');
  const mayManageUsers = can('users.manage');
  const [tab, setTab] = useState<Tab>(mayConfigure ? 'jurisdiction' : 'accounts');

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <h1 className="text-[14px] font-semibold text-ink">Setup</h1>

        <nav className="ml-4 flex gap-1">
          {mayConfigure && (
            <TabButton active={tab === 'jurisdiction'} onClick={() => setTab('jurisdiction')}>
              Jurisdiction
            </TabButton>
          )}
          {mayManageUsers && (
            <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>
              Accounts
            </TabButton>
          )}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
          {tab === 'accounts' && mayManageUsers && <UserAdmin />}

          {tab === 'jurisdiction' && mayConfigure && (
            <>
          <Panel
            title="Jurisdiction"
            description="Set once. New locations default to this, so nobody types the same town four hundred times a year."
            aside={<Building2 size={17} className="text-faint" aria-hidden />}
          >
            <FieldGrid cols={2}>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">Agency name</span>
                <input
                  value={agency.name}
                  onChange={(e) => updateAgency({ name: e.target.value })}
                  placeholder="Cedar Falls Police Department"
                  className={control}
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">ORI</span>
                <input
                  value={agency.ori}
                  onChange={(e) => updateAgency({ ori: e.target.value.toUpperCase() })}
                  placeholder="AL0010200"
                  className={cn(control, 'font-mono uppercase')}
                />
                <span className="mt-1 block text-[12px] text-faint">
                  The FBI identifier for the agency. Goes on every state submission.
                </span>
              </label>
            </FieldGrid>

            <div className="mt-4 grid grid-cols-4 gap-4">
              <label className="col-span-2">
                <span className="mb-1.5 block text-[13px] font-medium text-ink">City / town</span>
                <input
                  value={agency.city}
                  onChange={(e) => updateAgency({ city: e.target.value })}
                  className={control}
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">County</span>
                <input
                  value={agency.county}
                  onChange={(e) => updateAgency({ county: e.target.value })}
                  className={control}
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">State</span>
                <select
                  value={agency.state}
                  onChange={(e) => updateAgency({ state: e.target.value })}
                  className={control}
                >
                  <option value="">—</option>
                  {STATES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 max-w-xs">
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  Patrol areas are called
                </span>
                <select
                  value={agency.zoneLabel}
                  onChange={(e) => updateAgency({ zoneLabel: e.target.value })}
                  className={control}
                >
                  {ZONE_LABELS.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[12px] text-faint">
                  Used everywhere in the app, so it reads the way your department talks.
                </span>
              </label>
            </div>
          </Panel>

          <Panel
            title="Boundaries"
            description="Load the polygons your agency already has. Once they are in, a pin on the map settles the patrol area instead of an officer recalling it."
            aside={<MapPinned size={17} className="text-faint" aria-hidden />}
          >
            <div className="space-y-4">
              <GeoJsonInput
                label="Jurisdiction boundary"
                hint="The outer city or county limit. Used to flag calls that fall outside it."
                value={agency.boundary}
                onChange={(boundary) => updateAgency({ boundary })}
              />
              <GeoJsonInput
                label={`${agency.zoneLabel} boundaries`}
                hint={`One polygon per ${agency.zoneLabel.toLowerCase()}. The name is read from a beat, zone, district or name property — whichever your file uses.`}
                value={agency.zones}
                onChange={(zones) => updateAgency({ zones })}
              />
            </div>

            <div className="mt-4 rounded-lg border border-line bg-raised p-3">
              <p className="text-[12.5px] font-medium text-ink">Where these files come from</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Your county GIS office, your CAD vendor, or the 911 addressing authority will
                already have them — the same layers dispatch draws its map from. Export as GeoJSON
                and paste it in. Nothing is uploaded anywhere; it is read in the browser.
              </p>
            </div>

            {(agency.boundary || agency.zones) && (
              <div className="mt-4">
                <p className="mb-2 text-[13px] font-medium text-ink">Preview</p>
                <ZoneMap
                  boundary={agency.boundary}
                  zones={agency.zones}
                  zoneLabel={agency.zoneLabel}
                  height={420}
                />
              </div>
            )}
          </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
        active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60',
      )}
    >
      {children}
    </button>
  );
}

function GeoJsonInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: GeoFeatureCollection | null;
  onChange: (value: GeoFeatureCollection | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);

  const load = (raw: string) => {
    setText(raw);
    const result = parseGeoJSON(raw);
    setError(result.error);
    setNames(result.names);
    if (result.collection) onChange(result.collection);
  };

  const loaded = value?.features.length ?? 0;

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p>
        </div>
        {loaded > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-[11.5px] font-medium text-ok">
            <Check size={12} aria-hidden />
            {loaded} loaded
          </span>
        )}
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted">
          <Upload size={12} aria-hidden />
          Paste GeoJSON
        </span>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => load(e.target.value)}
          placeholder='{"type":"FeatureCollection","features":[…]}'
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink placeholder:text-faint"
        />
      </label>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-2 text-[12.5px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {names.length > 0 && !error && (
        <p className="mt-2 text-[12px] text-muted">
          Loaded: <span className="text-ink">{names.slice(0, 12).join(', ')}</span>
          {names.length > 12 && ` and ${names.length - 12} more`}
        </p>
      )}

      {loaded > 0 && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setText('');
            setNames([]);
            setError(null);
          }}
          className="mt-2 text-[12px] font-medium text-danger hover:underline"
        >
          Remove this layer
        </button>
      )}
    </div>
  );
}
