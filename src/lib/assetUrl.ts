/**
 * Where a stored file is served from.
 *
 * The real app streams it from the API; the published demo has no server and
 * holds the bytes in the tab. One helper so a component asking for a
 * photograph does not have to know which it is looking at.
 */

import { DEMO } from '@/state/api';

function stored(id: string): string | null {
  if (!DEMO) return null;
  // Imported lazily: the demo store must not be pulled into the real build.
  const cache = (globalThis as { __demoFiles?: Record<string, string> }).__demoFiles;
  return cache?.[id] ?? null;
}

export const photoUrl = (id: string): string => stored(id) ?? `/api/photos/${id}/file`;
export const attachmentUrl = (id: string): string => stored(id) ?? `/api/attachments/${id}/file`;
