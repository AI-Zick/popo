import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Info, ShieldAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import { api } from '@/state/api';
import {
  blocking,
  review,
  summary,
  WEIGHT_LABEL,
  type Finding,
  type Screen,
  type Weight,
} from '@/domain/readiness';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * What is still outstanding on this installation.
 *
 * The markers were always there — the statute table saying which entries
 * nobody has checked, the GIS panel saying it has never been tested, the mail
 * settings saying they are not set up. What was missing is that each of them
 * is only visible to somebody standing on that screen, and the person deciding
 * whether an agency can go live is not going to visit nine screens and hold
 * the answers in their head.
 *
 * There is no score and no percentage. Readiness is a judgement about an
 * agency's circumstances, and a bar reading 87% invites somebody to treat the
 * rest as rounding. This is a list of true statements, worst first, each with
 * the button that fixes it.
 */

const TONE: Record<Weight, { border: string; chip: 'danger' | 'warn' | 'neutral'; icon: React.ReactNode }> = {
  blocking: {
    border: 'border-l-danger',
    chip: 'danger',
    icon: <ShieldAlert size={14} className="text-danger" aria-hidden />,
  },
  fix: {
    border: 'border-l-warn',
    chip: 'warn',
    icon: <CircleAlert size={14} className="text-warn" aria-hidden />,
  },
  know: {
    border: 'border-l-line-strong',
    chip: 'neutral',
    icon: <Info size={14} className="text-muted" aria-hidden />,
  },
};

const SCREEN_NAME: Record<Screen, string> = {
  jurisdiction: 'Jurisdiction',
  accounts: 'Accounts',
  statutes: 'Statutes',
  exemptions: 'Exemptions',
  retention: 'Retention',
  gis: 'County GIS',
  mail: 'Email and shifts',
};

export function Readiness({ onGoTo }: { onGoTo: (screen: Screen) => void }) {
  const { agency, users } = useStore();
  /*
    Asked of the server, because the mail password lives in its environment and
    nothing in the browser can know whether one arrived.
  */
  const [hasMailPassword, setHasMailPassword] = useState(false);
  useEffect(() => {
    void api.mailPasswordSet().then(
      (r) => setHasMailPassword(r.set),
      () => setHasMailPassword(false),
    );
  }, []);

  const findings = useMemo(
    () => review({ agency, users, hasMailPassword }),
    [agency, users, hasMailPassword],
  );
  const stop = blocking(findings);

  return (
    <Panel
      title="Before this agency goes live"
      description="Everything the setup screens already know, in one place. There is no score — this is a list of what is true."
      aside={
        stop.length > 0 ? (
          <Badge tone="danger">
            {stop.length} blocking
          </Badge>
        ) : findings.length === 0 ? (
          <Badge tone="ok">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} aria-hidden />
              Nothing outstanding
            </span>
          </Badge>
        ) : (
          <Badge tone="warn">{findings.length} to read</Badge>
        )
      }
    >
      <p
        className={cn(
          'text-[13.5px] leading-relaxed',
          stop.length > 0 ? 'font-medium text-danger' : 'text-ink',
        )}
      >
        {summary(findings)}
      </p>

      {findings.length === 0 ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Whether to go live is still somebody's judgement — this only says that nothing is
          unfinished, unverified, or running on a value the software chose.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {findings.map((finding) => (
            <Row key={finding.id} finding={finding} onGoTo={onGoTo} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Row({ finding, onGoTo }: { finding: Finding; onGoTo: (screen: Screen) => void }) {
  const tone = TONE[finding.weight];
  return (
    <li
      className={cn(
        'rounded-lg border border-line border-l-[3px] bg-surface px-3.5 py-3',
        tone.border,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {tone.icon}
        <span className="text-[13.5px] font-medium text-ink">{finding.says}</span>
        <Badge tone={tone.chip}>{WEIGHT_LABEL[finding.weight]}</Badge>
      </div>
      {/*
        The reason is shown, not tucked behind a disclosure. It is the half that
        says whether to care, and a finding somebody has to click twice to
        understand is one they skip.
      */}
      <p className="mt-1.5 pl-[22px] text-[12.5px] leading-relaxed text-muted">
        {finding.because}
      </p>
      <div className="mt-2 pl-[22px]">
        <Button onClick={() => onGoTo(finding.screen)}>
          {SCREEN_NAME[finding.screen]}
          <ArrowRight size={13} aria-hidden />
        </Button>
      </div>
    </li>
  );
}
