import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCode2, Info, ShieldAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  buildExport,
  columnMap,
  exportFilename,
  hasProfile,
  layoutWidth,
  profileFor,
  stateRules,
  type ExportResult,
  type StateProfile,
} from '@/domain/nibrs';
import { runRules } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The state submission.
 *
 * Two things matter more than the file itself. The first is that nothing goes
 * out that a supervisor has not approved — an agency's published crime figures
 * should not contain a draft. The second is that whatever is *held back* is
 * visible, with the reason, because the failure mode of every records system is
 * a report that quietly never gets counted and surfaces a year later as a gap
 * in the annual return.
 */
export function NibrsExport() {
  const { incidents, agency, people, locations, currentUser, record } = useStore();
  const [downloaded, setDownloaded] = useState(false);

  const profile = profileFor(agency.state);
  const usingFallback = !hasProfile(agency.state);

  const result: ExportResult = useMemo(() => {
    const errorsByIncident: Record<string, number> = {};
    const stateIssuesByIncident: Record<string, number> = {};
    const rules = stateRules(profile);

    for (const incident of incidents) {
      const data = { people, locations, agency };
      errorsByIncident[incident.id] = runRules(incident, ALL_RULES, data).errors.length;
      // The state's own requirements are separate: they do not stop a report
      // being filed, but they do stop it going to the state.
      stateIssuesByIncident[incident.id] = runRules(incident, rules, data).issues.length;
    }

    return buildExport({
      incidents,
      agency,
      people,
      locations,
      errorsByIncident,
      stateIssuesByIncident,
      profile,
    });
  }, [incidents, agency, people, locations, profile]);

  const filename = exportFilename(agency, new Date(), profile);

  const download = () => {
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);

    record({
      actorId: currentUser.id,
      actorName: currentUser.name,
      action: 'nibrs.exported',
      target: filename,
      detail: `${profile.name} · ${result.included.length} incidents · ${result.segmentCount} segments`,
    });
  };

  return (
    <>
      <Panel
        title="NIBRS submission"
        description={profile.program}
        aside={
          <div className="flex items-center gap-2">
            <Badge tone={profile.verified ? 'ok' : 'warn'}>
              {profile.transport === 'xml' ? 'XML' : 'Fixed width'}
            </Badge>
            <FileCode2 size={17} className="text-faint" aria-hidden />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label="Ready to submit" value={result.included.length} tone="ok" />
          <Stat label="Held back" value={result.excluded.length} tone={result.excluded.length ? 'warn' : 'neutral'} />
          <Stat label="Segments" value={result.segmentCount} tone="neutral" />
        </div>

        {usingFallback && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn-soft/50 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <span>
              There is no submission profile for{' '}
              <strong>{agency.state || 'this agency’s state'}</strong> yet, so this is the FBI’s
              national layout. It is the right shape for an agency that submits directly to the
              FBI, and it is <strong>not</strong> a state submission.
            </span>
          </p>
        )}

        {!agency.ori && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            The agency has no ORI. Nothing can be submitted without one — set it under Jurisdiction.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={download} disabled={result.included.length === 0}>
            <Download size={15} aria-hidden />
            Download {filename}
          </Button>
          {downloaded && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-ok">
              <CheckCircle2 size={14} aria-hidden />
              Saved. The download is recorded in the audit log.
            </span>
          )}
        </div>

        {/*
          Said plainly and on the screen rather than buried in a manual: the
          failure this prevents is silent at the moment of export and expensive
          six weeks later, when the whole batch comes back rejected.
        */}
        {!profile.verified ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn-soft/50 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
            <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <span>
              <strong>This layout has not been checked against the published specification.</strong>{' '}
              The field positions are this system's reading of the record, not{' '}
              {profile.specReference}. Reconcile one file column by column before a first real
              submission — a file that is the right shape in the wrong dialect is rejected in bulk,
              weeks later.
            </span>
          </p>
        ) : (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
            Checked against {profile.specReference}
            {profile.specVersion && `, revision ${profile.specVersion}`}.
          </p>
        )}
      </Panel>

      {result.excluded.length > 0 && (
        <Panel
          title={`Held back (${result.excluded.length})`}
          description="These are not in the file. Each one is a crime the state will not have counted."
        >
          <ul className="divide-y divide-line">
            {result.excluded.map((item) => (
              <li key={item.caseNumber} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-[13px] text-ink">{item.caseNumber}</span>
                <span className="text-[12.5px] text-muted">{item.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <LayoutTable profile={profile} />

      {result.included.length > 0 && (
        <Panel title={`In the file (${result.included.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {result.included.map((caseNumber) => (
              <Badge key={caseNumber} tone="ok">
                {caseNumber}
              </Badge>
            ))}
          </div>

          <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
            First lines
          </p>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-muted">
            {result.content.split('\n').slice(0, 12).join('\n')}
          </pre>
        </Panel>
      )}
    </>
  );
}

/**
 * The layout, as a table of columns.
 *
 * This is the thing you sit down with next to the state's published record
 * layout. Reconciling a profile is reading two tables against each other, and
 * the alternative — reading it out of the source — is how a transcription
 * error becomes a rejected batch.
 */
function LayoutTable({ profile }: { profile: StateProfile }) {
  const [open, setOpen] = useState<string | null>(null);
  const segments = Object.keys(profile.segments) as (keyof StateProfile['segments'])[];

  return (
    <Panel
      title="Record layout"
      description="What this profile writes, column by column. Check it against the state's published spec."
    >
      <div className="flex flex-wrap gap-1.5">
        {profile.header && (
          <LayoutChip
            label="header"
            width={layoutWidth(profile.header)}
            active={open === 'header'}
            onClick={() => setOpen(open === 'header' ? null : 'header')}
          />
        )}
        {segments.map((name) => (
          <LayoutChip
            key={name}
            label={name}
            width={layoutWidth(profile.segments[name])}
            active={open === name}
            onClick={() => setOpen(open === name ? null : name)}
          />
        ))}
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[12px]">
            <thead className="bg-raised text-faint">
              <tr className="text-left">
                <th className="px-3 py-1.5 font-medium">Columns</th>
                <th className="px-3 py-1.5 font-medium">Field</th>
                <th className="px-3 py-1.5 font-medium">Type</th>
                <th className="px-3 py-1.5 font-medium">Required</th>
              </tr>
            </thead>
            <tbody>
              {columnMap(
                open === 'header'
                  ? profile.header!
                  : profile.segments[open as keyof StateProfile['segments']],
              ).map((entry) => (
                <tr key={entry.field} className="border-t border-line">
                  <td className="px-3 py-1 font-mono text-muted tabular">
                    {entry.from === entry.to ? entry.from : `${entry.from}–${entry.to}`}
                  </td>
                  <td className="px-3 py-1 font-mono text-ink">{entry.field}</td>
                  <td className="px-3 py-1 text-muted">{entry.spec.type ?? 'alpha'}</td>
                  <td className="px-3 py-1">
                    {entry.spec.required && <Badge tone="warn">required</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.transport === 'xml' && (
            <p className="border-t border-line px-3 py-2 text-[11.5px] text-faint">
              Columns are documentation in an XML profile — nothing is padded. The field names are
              the element names.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function LayoutChip({
  label,
  width,
  active,
  onClick,
}: {
  label: string;
  width: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition',
        active ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted hover:bg-surface/60',
      )}
    >
      {label}
      <span className="ml-1.5 text-[11px] text-faint tabular">{width}</span>
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'neutral';
}) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink';
  return (
    <div>
      <p className={`text-[24px] font-semibold tabular ${color}`}>{value}</p>
      <p className="text-[11.5px] uppercase tracking-wider text-faint">{label}</p>
    </div>
  );
}
