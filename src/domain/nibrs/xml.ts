/**
 * The XML transport.
 *
 * Driven by the same `SegmentLayout` objects as the fixed-width renderer: the
 * field names become element names and the widths are ignored. That is the
 * whole difference between a state that takes XML and one that takes columns.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  This emits flat, readable XML. Real NIBRS XML is the FBI's NIEM IEPD —
 *  namespaced, nested, with structural references between elements instead of
 *  the flat sequence numbers the fixed-width format uses. Mapping these field
 *  names onto IEPD element paths is the remaining work, and it lands here
 *  rather than anywhere else in the system.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { FieldType, SegmentLayout } from './spec';
import { dateField, hourField } from './format';

/**
 * A value in the form XML wants it.
 *
 * Types still apply here — they just resolve differently. A date is a date in
 * both transports; `20260827` is how a column says it and `2026-08-27` is how
 * an element does. What must not happen, and did until this existed, is the raw
 * `2026-08-27T23:35` from the form landing in the file because the XML renderer
 * ignored the type and wrote whatever it was handed.
 */
export function xmlValue(value: string, type: FieldType = 'alpha'): string {
  switch (type) {
    case 'date': {
      const digits = dateField(value).trim();
      return digits.length === 8
        ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
        : '';
    }
    case 'hour':
      return hourField(value).trim();
    case 'numeric':
    case 'numericOrBlank':
      return value.replace(/\D/g, '');
    default:
      return value;
  }
}

/** XML text escaping. A street name with an ampersand is not exotic. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * One segment as an element.
 *
 * Empty values are omitted rather than written as empty elements: in a
 * positional format a blank column is meaningful, in XML an absent element is
 * how you say the same thing, and an empty element is a third thing that means
 * neither.
 */
export function renderElement<K extends string>(
  name: string,
  layout: SegmentLayout<K>,
  values: Partial<Record<K, string>>,
  indent = 2,
): string {
  const pad = ' '.repeat(indent);
  const inner = layout
    .filter((spec) => spec.field !== 'segmentLevel')
    .map((spec) => ({
      field: spec.field,
      value: xmlValue((values[spec.field] ?? '').trim(), spec.type),
    }))
    .filter((entry) => entry.value !== '')
    .map((entry) => `${pad}  <${entry.field}>${escapeXml(entry.value)}</${entry.field}>`)
    .join('\n');

  if (!inner) return `${pad}<${name} />`;
  return `${pad}<${name}>\n${inner}\n${pad}</${name}>`;
}

export function xmlDocument(body: string, attributes: Record<string, string>): string {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Submission${attrs}>\n${body}\n</Submission>\n`;
}
