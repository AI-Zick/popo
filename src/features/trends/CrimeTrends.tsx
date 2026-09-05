import { useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Info, MapPin, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  BASIS_NOTE,
  buildTrends,
  byHour,
  byOffenseGroup,
  byPlace,
  byWeekday,
  COUNTS_NOTE,
  HISTORY_NOTE,
  hotSpots,
  missingTimes,
  OFFENSE_NOTE,
  offenseGroupLabel,
  previousSpan,
  SMALL_NUMBER_NOTE,
  SPARSE_NOTE,
  spanEnding,
  THIN_HISTORY_NOTE,
  UNPLACED_NOTE,
  yearEarlier,
  type Basis,
  type Comparison,
  type Slot,
  type TrendRow,
} from '@/domain/trends';
import { LOCATION_TYPES } from '@/domain/codes';
import { locationLabel } from '@/domain/location';
import { ZoneMap } from '@/components/location/ZoneMap';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const today = () => new Date().toISOString().slice(0, 10);

/** The spans command staff actually ask for, rather than a calendar widget. */
const SPANS: { label: string; days: number }[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 28 days', days: 28 },
  { label: 'Last 90 days', days: 90 },
];

const placeLabel = (code: string): string =>
  LOCATION_TYPES.find((option) => option.value === code)?.label || code || 'Not recorded';

/**
 * Crime trends.
 *
 * What a chief takes to a council meeting and a captain moves a shift on —
 * which makes it the one screen here that can do damage by being believed. A
 * number nobody can check, standing in for a hundred reports, read as fact.
 *
 * So the design problem is not drawing the graph. It is making the screen
 * refuse to overstate: no percentage on a base too small to carry one, no
 * comparison against a longer stretch of calendar than the one on screen, and
 * an "is this actually unusual?" answer sitting next to every arrow, because
 * up-against-last-month is a number every category produces half the time.
 *
 * Everything is derived on read. There is no stored figure to go stale, no
 * nightly job to fall over, and running this the moment a report is approved
 * gives an answer that includes it.
 */
export function CrimeTrends() {
  const { incidents, locations, agency, can } = useStore();

  const [days, setDays] = useState(28);
  const [basis, setBasis] = useState<Basis>('occurred');
  const [breakdown, setBreakdown] = useState<'offense' | 'place'>('offense');

  const span = useMemo(() => spanEnding(today(), days), [days]);

  const report = useMemo(
    () =>
      breakdown === 'offense'
        ? buildTrends(incidents, span, basis, byOffenseGroup, offenseGroupLabel)
        : buildTrends(incidents, span, basis, byPlace, placeLabel),
    [incidents, span, basis, breakdown],
  );

  const hours = useMemo(() => byHour(incidents, span, basis), [incidents, span, basis]);
  const weekdays = useMemo(() => byWeekday(incidents, span, basis), [incidents, span, basis]);
  const coverage = useMemo(() => missingTimes(incidents, span, basis), [incidents, span, basis]);
  const spots = useMemo(
    () => hotSpots(incidents, locations, span, basis),
    [incidents, locations, span, basis],
  );

  // Deployment numbers. A records clerk has no use for them and no business
  // being handed a screen that reads as an operational decision.
  if (!can('reports.approve') && !can('users.manage')) {
    return (
      <Panel title="Crime trends" description="">
        <p className="text-[13px] leading-relaxed text-muted">
          These are deployment figures, kept to supervisors and command staff.
        </p>
      </Panel>
    );
  }

  const before = previousSpan(span);
  const yearAgo = yearEarlier(span);

  return (
    <div className="space-y-4">
      <Panel
        title="Crime trends"
        description="Offences by kind, place and time, against the period before and the same period last year. Everything here is worked out from the reports as they stand right now."
      >
        <div className="flex flex-wrap items-center gap-2">
          {SPANS.map((option) => (
            <Button
              key={option.days}
              variant={days === option.days ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDays(option.days)}
            >
              {option.label}
            </Button>
          ))}

          <span className="mx-1 h-5 w-px bg-line" aria-hidden />

          {(['occurred', 'reported'] as Basis[]).map((option) => (
            <Button
              key={option}
              variant={basis === option ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setBasis(option)}
            >
              {option === 'occurred' ? 'When it happened' : 'When it was reported'}
            </Button>
          ))}
        </div>

        {/*
          The basis and what was counted, in words, next to the numbers rather
          than in a footnote. Two people reading different bases and arguing
          about whose figure is right is the ordinary failure of a crime
          statistics screen.
        */}
        <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-raised/60 p-3">
          <Note>{BASIS_NOTE[basis]}</Note>
          <Note>{COUNTS_NOTE}</Note>
          <Note>{OFFENSE_NOTE}</Note>
        </div>

        <p className="mt-3 text-[12px] text-faint">
          {span.from} to {span.to} ({report.days} days) · compared with {before.from} to {before.to}{' '}
          and with {yearAgo.from} to {yearAgo.to}
        </p>
      </Panel>

      <Panel
        title={breakdown === 'offense' ? 'By kind of offence' : 'By kind of place'}
        description={
          breakdown === 'offense'
            ? 'Grouped the way an offence is charged, not by NIBRS code.'
            : 'Where the offence happened — the question that decides where cars go.'
        }
        aside={
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={breakdown === 'offense' ? 'primary' : 'secondary'}
              onClick={() => setBreakdown('offense')}
            >
              Offence
            </Button>
            <Button
              size="sm"
              variant={breakdown === 'place' ? 'primary' : 'secondary'}
              onClick={() => setBreakdown('place')}
            >
              Place
            </Button>
          </div>
        }
      >
        {report.rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-faint">
            No offences on record in this period or the two it is compared with.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">{breakdown === 'offense' ? 'Offence' : 'Place'}</th>
                    <th className="py-2 pr-3 text-right font-medium">This period</th>
                    <th className="py-2 pr-3 font-medium">vs period before</th>
                    <th className="py-2 pr-3 font-medium">vs a year ago</th>
                    <th className="py-2 font-medium">Against the recent past</th>
                  </tr>
                </thead>
                <tbody>
                  <Row row={report.total} emphasise />
                  {report.rows.map((row) => (
                    <Row key={row.key} row={row} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 space-y-1.5">
              <Note>{SMALL_NUMBER_NOTE}</Note>
              <Note>{HISTORY_NOTE}</Note>
              <Note>{SPARSE_NOTE}</Note>
              {report.rows.some((row) => row.usual.verdict === 'unknown') && (
                <Note>{THIN_HISTORY_NOTE}</Note>
              )}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="By hour of the day"
          description="What a watch commander schedules against."
        >
          <Bars slots={hours} everyNth={3} tick={(slot) => slot.label.slice(0, 2)} />
          <p className="mt-1 text-[11.5px] text-muted">{busiest(hours)}</p>
          {coverage.withTime < coverage.total && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-warn/45 bg-warn/5 p-2.5 text-[12px] leading-relaxed text-warn">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Built on {coverage.withTime} of {coverage.total} reports. The rest carry no time of
                day, and are left out here rather than counted at midnight — which would put the
                tallest bar of the day at the hour least happens.
              </span>
            </p>
          )}
        </Panel>

        <Panel title="By day of the week" description="Where a fixed pattern shows up.">
          <Bars slots={weekdays} />
          <p className="mt-1 text-[11.5px] text-muted">{busiest(weekdays)}</p>
        </Panel>
      </div>

      <Panel
        title="Where it clustered"
        description="Places with the most offences in this period. Circles are sized by area, so two pins can be compared by eye; red means more than the period before."
        aside={<MapPin size={17} className="text-faint" aria-hidden />}
      >
        <ZoneMap
          boundary={agency.boundary ?? null}
          zones={agency.zones ?? null}
          height={340}
          spots={spots.spots.map((spot) => ({
            lon: spot.longitude,
            lat: spot.latitude,
            count: spot.count,
            previous: spot.previous,
            label: locationLabel(spot.location),
          }))}
        />

        {spots.spots.length > 0 && (
          <ol className="mt-3 space-y-1">
            {spots.spots.map((spot) => (
              <li
                key={spot.location.id}
                className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 odd:bg-raised/50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {locationLabel(spot.location)}
                </span>
                <span className="shrink-0 text-[12px] text-muted tabular">
                  {spot.count} {spot.count === 1 ? 'offence' : 'offences'}
                </span>
                <span className="w-24 shrink-0 text-right text-[12px] text-faint tabular">
                  was {spot.previous}
                </span>
              </li>
            ))}
          </ol>
        )}

        {spots.unplaced > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/45 bg-warn/5 p-2.5 text-[12px] leading-relaxed text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {spots.unplaced} {spots.unplaced === 1 ? 'offence is' : 'offences are'} missing from
              this map. {UNPLACED_NOTE}
            </span>
          </p>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * The graph's finding, in a sentence.
 *
 * A bar chart shows a shape; somebody briefing a shift needs a sentence. This
 * is the one they would have read off it, written down so it does not have to
 * be squinted at.
 */
function busiest(slots: Slot[]): string {
  const total = slots.reduce((sum, slot) => sum + slot.count, 0);
  if (total === 0) return 'Nothing on record in this period.';
  const top = [...slots].sort((a, b) => b.count - a.count)[0];
  return `Busiest: ${top.label} — ${top.count} of ${total}.`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
      <Info size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Row({ row, emphasise = false }: { row: TrendRow; emphasise?: boolean }) {
  return (
    <tr
      className={cn(
        'border-b border-line/70',
        emphasise && 'bg-raised/60 font-medium',
      )}
    >
      <td className="py-2 pr-3 text-ink">{row.label}</td>
      <td className="py-2 pr-3 text-right text-ink tabular">{row.current}</td>
      <td className="py-2 pr-3">
        <Movement comparison={row.vsPrevious} />
      </td>
      <td className="py-2 pr-3">
        <Movement comparison={row.vsYear} />
      </td>
      <td className="py-2">
        <Usual row={row} />
      </td>
    </tr>
  );
}

/**
 * One comparison.
 *
 * The counts are always shown and the percentage only sometimes, which is the
 * opposite of the usual arrangement and is the point. Where the base is too
 * small the reader gets "6 (was 2)" — which is both the true statement and the
 * one that stops somebody saying "burglary is up two hundred per cent".
 */
function Movement({ comparison }: { comparison: Comparison }) {
  const { change, percent, direction, prior } = comparison;
  const Arrow = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : ArrowRight;
  const tone =
    direction === 'flat'
      ? 'text-muted'
      : direction === 'up'
        ? 'text-danger'
        : 'text-ok';

  return (
    <span className="flex items-center gap-1.5">
      <Arrow size={13} className={cn('shrink-0', tone)} aria-hidden />
      <span className={cn('text-[12.5px] tabular', tone)}>
        {change > 0 ? '+' : ''}
        {change}
      </span>
      {percent !== null ? (
        <span className={cn('text-[12px] tabular', tone)}>
          ({percent > 0 ? '+' : ''}
          {percent}%)
        </span>
      ) : (
        <span className="text-[11.5px] text-faint tabular">(was {prior})</span>
      )}
    </span>
  );
}

/**
 * Whether the movement is worth acting on.
 *
 * The column that stops a normal week being read as a spike. Most categories
 * are up on something most of the time; a count higher than every one of the
 * last twelve comparable periods is a different claim, and this is the only
 * place on the screen that makes it.
 */
function Usual({ row }: { row: TrendRow }) {
  const { usual } = row;
  if (usual.verdict === 'unknown') {
    return (
      <span className="text-[11.5px] text-faint" title={THIN_HISTORY_NOTE}>
        Not enough history yet
      </span>
    );
  }
  if (usual.verdict === 'sparse') {
    return (
      <span className="text-[11.5px] text-faint" title={SPARSE_NOTE}>
        Too few to call
      </span>
    );
  }
  if (usual.verdict === 'above') {
    return (
      <Badge tone="danger">
        Above the last {usual.periods} ({usual.low}–{usual.high})
      </Badge>
    );
  }
  if (usual.verdict === 'below') {
    return (
      <Badge tone="ok">
        Below the last {usual.periods} ({usual.low}–{usual.high})
      </Badge>
    );
  }
  return (
    <span className="text-[11.5px] text-faint tabular">
      Within the usual {usual.low}–{usual.high}
    </span>
  );
}

/**
 * A bar chart with the numbers on it.
 *
 * Bars from zero, always. A chart that starts its axis at the lowest value
 * makes a flat night look like a cliff, and this is a screen people make
 * staffing decisions from.
 */
function Bars({
  slots,
  everyNth = 1,
  tick = (slot: Slot) => slot.label.slice(0, 3),
}: {
  slots: Slot[];
  everyNth?: number;
  tick?: (slot: Slot) => string;
}) {
  const peak = Math.max(...slots.map((slot) => slot.count), 1);
  /*
    Numbers above the bars only where they fit. Twenty-four of them at this
    width run into each other and read as one long digit string, which is
    worse than no labels at all — the shape of the graph is the finding, and
    the exact count is a hover away.
  */
  const showValues = slots.length <= 12;
  return (
    <div className="flex gap-1" style={{ height: 160 }}>
      {slots.map((slot, index) => (
        <div key={slot.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="h-3.5 text-[10.5px] leading-none text-faint tabular">
            {showValues ? slot.count || '' : ''}
          </span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-accent/70"
              style={{
                height: `${(slot.count / peak) * 100}%`,
                minHeight: slot.count > 0 ? 2 : 0,
              }}
              title={`${slot.label}: ${slot.count}`}
            />
          </div>
          <span className="h-3 truncate text-[10px] leading-none text-faint">
            {index % everyNth === 0 ? tick(slot) : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
