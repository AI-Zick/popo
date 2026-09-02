/**
 * Turning values into columns.
 *
 * These four functions are the whole of the fixed-width format. Everything
 * else about a state's file is which of them applies to which field at what
 * width, which is what a `SegmentLayout` says.
 */

import type { FieldSpec, FieldType, SegmentLayout } from './spec';

/** Left-justified, space-padded, truncated to width. */
export function alpha(value: string | undefined | null, width: number): string {
  return String(value ?? '')
    .toUpperCase()
    .slice(0, width)
    .padEnd(width, ' ');
}

/** Right-justified, zero-padded. Non-numeric input becomes zeros. */
export function numeric(value: string | number | undefined | null, width: number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(-width).padStart(width, '0');
}

/**
 * Right-justified, zero-padded — but spaces when there is nothing to say.
 *
 * An age of `00` is a claim that the person is a newborn, and a premises-entered
 * count of `00` on an offense that has no such count is a claim the state's edit
 * checks will reject. Optional numeric fields go out blank.
 */
export function numericOrBlank(value: string | number | undefined | null, width: number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-width).padStart(width, '0') : ' '.repeat(width);
}

/** `YYYYMMDD`, or spaces when there is no date. A blank date is not zeroes. */
export function dateField(value: string | undefined | null): string {
  if (!value) return ' '.repeat(8);
  const date = new Date(value.length === 10 ? `${value}T00:00` : value);
  if (Number.isNaN(date.getTime())) return ' '.repeat(8);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** Hour of day as `HH`, or spaces. Used where the time is optional. */
export function hourField(value: string | undefined | null): string {
  if (!value) return '  ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '  ';
  return String(date.getHours()).padStart(2, '0');
}

/** One value, written the way its field spec says. */
export function formatField(value: string | undefined, type: FieldType = 'alpha', width = 1): string {
  switch (type) {
    case 'numeric':
      return numeric(value, width);
    case 'numericOrBlank':
      return numericOrBlank(value, width);
    case 'date':
      // The width in the layout is documentation; the format fixes it at 8.
      return dateField(value).padEnd(width, ' ').slice(0, width);
    case 'hour':
      return hourField(value).padEnd(width, ' ').slice(0, width);
    default:
      return alpha(value, width);
  }
}

/**
 * A layout plus a bag of values makes a line.
 *
 * A field the extractor did not produce writes as blank rather than throwing:
 * a state layout may legitimately ask for a column this system does not
 * collect, and the right answer to that is an empty column and a validation
 * message, not a crashed export in front of a records clerk on deadline.
 */
export function renderSegment<K extends string>(
  layout: SegmentLayout<K>,
  values: Partial<Record<K, string>>,
): string {
  return layout.map((spec) => formatField(values[spec.field], spec.type, spec.width)).join('');
}

/** Where each field starts and ends, 1-indexed — for checking against a spec. */
export function columnMap<K extends string>(
  layout: SegmentLayout<K>,
): { field: K; from: number; to: number; spec: FieldSpec<K> }[] {
  let cursor = 1;
  return layout.map((spec) => {
    const from = cursor;
    cursor += spec.width;
    return { field: spec.field, from, to: cursor - 1, spec };
  });
}

/** Total line width a layout produces. */
export function layoutWidth<K extends string>(layout: SegmentLayout<K>): number {
  return layout.reduce((sum, spec) => sum + spec.width, 0);
}
