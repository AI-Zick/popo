/** Parses a `yyyy-mm-ddThh:mm` or `yyyy-mm-dd` value into a Date. */
export function parseLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string): string {
  const d = parseLocal(value);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(value: string): string {
  const d = parseLocal(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function currency(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Age in years at a given reference date, or null. */
export function ageAt(dob: string, at: string): number | null {
  const birth = parseLocal(dob);
  const ref = parseLocal(at) ?? new Date();
  if (!birth) return null;
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function isValidVIN(vin: string): boolean {
  const v = vin.trim().toUpperCase();
  if (v.length !== 17) return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
}
