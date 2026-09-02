import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/state/store';
import { describeRange, type ActivityReport } from '@/domain/activityReport';
import { currency, formatDateTime } from '@/lib/format';

/**
 * The activity report on paper.
 *
 * These end up in evaluation files, union grievances and council packets, so
 * the sheet has to carry enough to be defended a year later: which officers,
 * which dates, which sections, and — under every table — where the number came
 * from. A page of counts with no basis is a page that gets argued with.
 *
 * Same mechanics as the printed case report: portalled out of the app so the
 * browser prints the sheet and not the editor around it.
 */
export function PrintableActivityReport({
  report,
  onClose,
}: {
  report: ActivityReport;
  onClose: () => void;
}) {
  const { agency, currentUser } = useStore();

  useEffect(() => {
    document.documentElement.classList.add('printing');
    const timer = window.setTimeout(() => window.print(), 400);
    const done = () => onClose();
    window.addEventListener('afterprint', done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.documentElement.classList.remove('printing');
    };
    // Once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="print-sheet fixed inset-0 z-[100] overflow-y-auto bg-white text-black print:static print:overflow-visible">
      <div className="mx-auto max-w-[8.5in] p-8 print:p-0">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] text-white"
          >
            Print
          </button>
        </div>

        <header className="border-b-2 border-black pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[17px] font-bold uppercase tracking-wide">
                {agency.name || 'Police Department'}
              </h1>
              <p className="text-[11px]">
                {agency.city}
                {agency.county && `, ${agency.county} County`} {agency.state} · ORI {agency.ori || '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide">Officer activity</p>
              <p className="text-[14px] font-bold">{describeRange(report.range)}</p>
              <p className="text-[11px]">
                {report.days} {report.days === 1 ? 'day' : 'days'}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-3">
          <p className="text-[11px]">
            <span className="font-semibold">Officers: </span>
            {report.officers.map((o) => `${o.name}${o.badge ? ` #${o.badge}` : ''}`).join(' · ') ||
              'None selected'}
          </p>
        </section>

        {report.empty && (
          <p className="mt-4 border border-black px-3 py-2 text-[11.5px]">
            No activity was recorded for these officers in this period. This is a zero, not a gap —
            every selected section was checked.
          </p>
        )}

        {report.sections.map((section) => (
          <section key={section.key} className="mt-5 break-inside-avoid">
            <h2 className="border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">
              {section.label}
            </h2>
            <table className="mt-1.5 w-full text-[11px]">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-2 font-semibold">Officer</th>
                  {section.columns.map((c) => (
                    <th key={c.key} className="px-1.5 py-1 text-right font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.officerId} className="border-b border-neutral-200">
                    <td className="py-1 pr-2">
                      {row.officerName}
                      {row.badge && ` #${row.badge}`}
                    </td>
                    {section.columns.map((c) => {
                      const m = row.metrics.find((x) => x.key === c.key);
                      return (
                        <td key={c.key} className="px-1.5 py-1 text-right">
                          {c.currency ? currency(m?.value ?? 0) : (m?.value ?? 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {section.rows.length > 1 && (
                  <tr className="border-t border-black font-semibold">
                    <td className="py-1 pr-2">Total</td>
                    {section.totals.map((t) => (
                      <td key={t.key} className="px-1.5 py-1 text-right">
                        {t.currency ? currency(t.value) : t.value}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {/* Where the number came from, under the number. */}
            <p className="mt-1 text-[9.5px] italic">{section.basis}</p>
          </section>
        ))}

        <footer className="mt-6 border-t border-black pt-2 text-[10px]">
          <p>
            Run by {currentUser.name} on {formatDateTime(report.generatedAt)}
          </p>
          <p className="mt-0.5">
            Counts reflect what was recorded in the system at the time this was run. Activity that
            was never entered does not appear here.
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
