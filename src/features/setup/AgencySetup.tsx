import { useState } from 'react';
import {
  Building2,
  Check,
  ChevronLeft,
  MapPinned,
  ShieldCheck,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { parseGeoJSON, type GeoFeatureCollection } from '@/domain/geo';
import { ZONE_LABELS } from '@/domain/agency';
import { STATES } from '@/domain/codes';
import { Button, FieldGrid, Panel, TabButton } from '@/components/ui/primitives';
import { ZoneMap } from '@/components/location/ZoneMap';
import { UserAdmin } from './UserAdmin';
import { AuditLog } from './AuditLog';
import { NibrsExport } from '@/features/nibrs/NibrsExport';
import { ActivityReportView } from '@/features/activity/ActivityReportView';
import { StopLog } from '@/features/activity/StopLog';
import { ImportWizard } from '@/features/migration/ImportWizard';
import { FeedbackQueue } from '@/features/feedback/FeedbackQueue';
import { PropertyRoom } from '@/features/evidence/PropertyRoom';
import { FleetView } from '@/features/fleet/FleetView';
import { ChecklistEditor } from '@/features/fleet/ChecklistEditor';
import { RetentionView } from '@/features/retention/RetentionView';
import { PublicRecordsView } from '@/features/records/PublicRecordsView';
import { ExemptionRules } from '@/features/records/ExemptionRules';
import { StatuteTable } from '@/features/statutes/StatuteTable';
import { GisSetup } from '@/features/setup/GisSetup';
import { withStatutePack } from '@/domain/agency';
import { cn } from '@/lib/cn';
import { YourSecondFactor } from '@/features/auth/YourSecondFactor';

/**
 * One-time configuration. Everything here is per-install, and the boundary
 * files come from whatever the agency already has — county GIS, the CAD
 * vendor, or the 911 addressing authority.
 */
type Tab =
  | 'jurisdiction'
  | 'accounts'
  | 'audit'
  | 'nibrs'
  | 'activity'
  | 'stops'
  | 'import'
  | 'evidence'
  | 'fleet'
  | 'retention'
  | 'publicRecords'
  | 'exemptions'
  | 'statutes'
  | 'gis'
  | 'security'
  | 'feedback';

const SCREEN_NAME: Record<Tab, string> = {
  jurisdiction: 'Jurisdiction',
  accounts: 'Accounts',
  audit: 'Audit log',
  nibrs: 'NIBRS export',
  activity: 'Activity report',
  stops: 'Traffic stops',
  import: 'Import records',
  evidence: 'Property room',
  fleet: 'Fleet',
  retention: 'Retention',
  publicRecords: 'Public records',
  exemptions: 'Exemptions',
  statutes: 'Statutes',
  gis: 'County GIS',
  security: 'Signing in',
  feedback: 'Feedback',
};

export function AgencySetup({ onClose }: { onClose: () => void }) {
  const { agency, updateAgency, can } = useStore();

  const mayConfigure = can('agency.configure');
  const mayManageUsers = can('users.manage');
  const mayViewAudit = can('audit.view');
  // Sealing, court orders and the retention schedule are the records job.
  const mayHandleRecords = can('records.seal');
  // Records staff run the state submission; so does anyone who reviews reports.
  const mayExport = can('agency.configure') || can('reports.approve');
  // Everyone can reach the activity screens: an officer logging their own
  // stops and running their own numbers needs no permission at all.
  const [tab, setTab] = useState<Tab>(
    mayConfigure ? 'jurisdiction' : mayManageUsers ? 'accounts' : mayViewAudit ? 'audit' : 'activity',
  );

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
          {mayViewAudit && (
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
              Audit log
            </TabButton>
          )}
          {mayExport && (
            <TabButton active={tab === 'nibrs'} onClick={() => setTab('nibrs')}>
              NIBRS export
            </TabButton>
          )}
          {mayConfigure && (
            <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
              Import records
            </TabButton>
          )}
          {mayHandleRecords && (
            <TabButton active={tab === 'retention'} onClick={() => setTab('retention')}>
              Retention
            </TabButton>
          )}
          {/*
            Open to everybody, because logging a request is open to everybody:
            one that goes unlogged because the only clerk was at lunch is a
            statutory clock that never started. Deciding what leaves the
            building is gated inside.
          */}
          <TabButton active={tab === 'publicRecords'} onClick={() => setTab('publicRecords')}>
            Public records
          </TabButton>
          {mayConfigure && (
            <TabButton active={tab === 'exemptions'} onClick={() => setTab('exemptions')}>
              Exemptions
            </TabButton>
          )}
          {mayConfigure && (
            <TabButton active={tab === 'statutes'} onClick={() => setTab('statutes')}>
              Statutes
            </TabButton>
          )}
          {mayConfigure && (
            <TabButton active={tab === 'gis'} onClick={() => setTab('gis')}>
              County GIS
            </TabButton>
          )}
          {/*
            Open to every officer: seizing property and signing it in or out is
            police work. What a clerk may do beyond that is gated inside.
          */}
          <TabButton active={tab === 'evidence'} onClick={() => setTab('evidence')}>
            Property
          </TabButton>
          {/*
            Open to every officer. Checking the car you are about to drive and
            saying when it is broken is not an administrative privilege.
          */}
          <TabButton active={tab === 'fleet'} onClick={() => setTab('fleet')}>
            Fleet
          </TabButton>
          <TabButton active={tab === 'stops'} onClick={() => setTab('stops')}>
            Traffic stops
          </TabButton>
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity report
          </TabButton>
          {/*
            Everyone's own second factor, so everyone can reach it. The most
            common thing that happens to one is a new phone, and that must not
            need an administrator.
          */}
          <TabButton active={tab === 'security'} onClick={() => setTab('security')}>
            Signing in
          </TabButton>
          {/*
            Open to everyone, not gated on configuration rights. An officer
            reading what their colleagues have raised, and the answers, is the
            thing that keeps people using the channel — and answering is gated
            separately, inside the queue.
          */}
          <TabButton active={tab === 'feedback'} onClick={() => setTab('feedback')}>
            Feedback
          </TabButton>
        </nav>
      </header>

      {/*
        Named for feedback, from a typed map of literals — never from anything
        on the record. See `describeScreen` in the feedback form.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-screen={`Setup — ${SCREEN_NAME[tab]}`}>
        <div
          className={cn(
            'mx-auto space-y-4 px-6 py-6',
            // The import review shows whole rows from the old system side by
            // side. Three columns of that in 768px is unreadable.
            tab === 'import' ||
            tab === 'feedback' ||
            tab === 'evidence' ||
            tab === 'fleet' ||
            tab === 'publicRecords' ||
            tab === 'exemptions' ||
            tab === 'statutes' ||
            tab === 'retention'
              ? 'max-w-5xl'
              : 'max-w-3xl',
          )}
        >
          {tab === 'accounts' && mayManageUsers && <UserAdmin />}
          {tab === 'audit' && mayViewAudit && <AuditLog />}
          {tab === 'nibrs' && mayExport && <NibrsExport />}
          {tab === 'stops' && <StopLog />}
          {tab === 'activity' && <ActivityReportView />}
          {tab === 'import' && mayConfigure && <ImportWizard />}
          {tab === 'evidence' && <PropertyRoom />}
          {tab === 'retention' && mayHandleRecords && <RetentionView />}
          {tab === 'publicRecords' && <PublicRecordsView />}
          {tab === 'exemptions' && mayConfigure && <ExemptionRules />}
          {tab === 'statutes' && mayConfigure && <StatuteTable />}
          {tab === 'gis' && mayConfigure && <GisSetup />}
          {tab === 'fleet' && (
            <>
              <FleetView />
              {mayConfigure && <ChecklistEditor />}
            </>
          )}
          {tab === 'security' && <YourSecondFactor />}
          {tab === 'feedback' && <FeedbackQueue />}

          {tab === 'jurisdiction' && mayConfigure && (
            <>
          {/*
            The one setting on this screen that is a compliance decision rather
            than a preference, so it says so rather than sitting as a quiet
            checkbox among the defaults.
          */}
          <Panel
            title="Signing in"
            description="What it takes to reach case information."
            aside={<ShieldCheck size={17} className="text-faint" aria-hidden />}
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3">
              <input
                type="checkbox"
                checked={agency.requireMfa !== false}
                onChange={(e) => updateAgency({ requireMfa: e.target.checked })}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">
                  Require a second factor
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                  Everybody signs in with a password and a code from an authenticator app.
                  Officers who have not set one up are walked through it the next time they sign
                  in, and nobody is locked out — recovery codes are issued at setup and an
                  administrator can clear somebody's second factor.
                </span>
              </span>
            </label>
            {agency.requireMfa === false && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                CJIS requires more than a password for access to criminal justice information.
                With this off, this installation is not eligible to hold it — whatever else is
                configured.
              </p>
            )}
          </Panel>

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

            <FieldGrid cols={2}>
              <label>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  State agency code
                </span>
                <input
                  value={agency.stateAgencyCode}
                  onChange={(e) => updateAgency({ stateAgencyCode: e.target.value.toUpperCase() })}
                  placeholder="Leave blank if your state does not use one"
                  className={cn(control, 'font-mono uppercase')}
                />
                <span className="mt-1 block text-[12px] text-faint">
                  Some state programs assign an identifier of their own alongside the ORI and
                  require it on every record. The NIBRS export says whether yours does.
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
                  /*
                    Choosing the state brings its statute pack in. Additively —
                    anything the agency has already checked or written stays,
                    because reseeding would quietly undo somebody's afternoon.
                  */
                  onChange={(e) => {
                    const next = withStatutePack({ ...agency, state: e.target.value });
                    updateAgency({ state: next.state, statutes: next.statutes });
                  }}
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
