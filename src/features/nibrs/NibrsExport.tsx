import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCode2, Info } from 'lucide-react';
import { useStore } from '@/state/store';
import { buildExport, exportFilename, type ExportResult } from '@/domain/nibrs';
import { runRules } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { Badge, Button, Panel } from '@/components/ui/primitives';

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

  const result: ExportResult = useMemo(() => {
    const errorsByIncident: Record<string, number> = {};
    for (const incident of incidents) {
      errorsByIncident[incident.id] = runRules(incident, ALL_RULES, {
        people,
        locations,
        agency,
      }).errors.length;
    }
    return buildExport({ incidents, agency, people, locations, errorsByIncident });
  }, [incidents, agency, people, locations]);

  const filename = exportFilename(agency);

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
      detail: `${result.included.length} incidents · ${result.segmentCount} segments`,
    });
  };

  return (
    <>
      <Panel
        title="NIBRS submission"
        description="Approved reports, written as the fixed-width file the state's collection system reads."
        aside={<FileCode2 size={17} className="text-faint" aria-hidden />}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label="Ready to submit" value={result.included.length} tone="ok" />
          <Stat label="Held back" value={result.excluded.length} tone={result.excluded.length ? 'warn' : 'neutral'} />
          <Stat label="Segments" value={result.segmentCount} tone="neutral" />
        </div>

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
          Said plainly rather than buried in a manual: every state edits the
          federal layout, and a file that is the right shape but the wrong
          dialect gets rejected in bulk weeks later.
        */}
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
          Field positions follow the FBI's national layout. Most states modify it and some now take
          NIBRS XML instead. Check one file against your state's specification before the first real
          submission.
        </p>
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
