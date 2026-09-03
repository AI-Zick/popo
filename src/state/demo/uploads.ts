/**
 * Files in the demo.
 *
 * Kept as data URLs in the same in-memory store as everything else, so an
 * `<img>` can point straight at one and nothing has to be served. Hashed with
 * the same SHA-256 the real server records at upload, because "the bytes you
 * are looking at are the bytes that were taken" is one of the properties worth
 * showing rather than claiming.
 */

import { createPhoto, type PersonPhoto } from '@/domain/photo';
import { sha256Hex } from '@/domain/chain';
import { audit, currentUser, db, newId } from './store';

const dataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });

async function hashOf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return sha256Hex(binary);
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

export async function addPhoto(
  masterId: string,
  file: File,
  details: { takenOn: string; kind: string; caption: string },
): Promise<PersonPhoto> {
  if (!PHOTO_TYPES.includes(file.type)) {
    throw new Error(`${file.type} is not a photograph. JPEG, PNG, HEIC or WebP.`);
  }
  const state = db();
  const user = currentUser();
  const id = newId('pho');
  state.files[id] = await dataUrl(file);

  const photo = createPhoto({
    id,
    masterId,
    takenOn: details.takenOn,
    kind: details.kind as PersonPhoto['kind'],
    caption: details.caption,
    filename: file.name,
    mime: file.type,
    size: file.size,
    sha256: await hashOf(file),
    addedBy: user.id,
    addedByName: user.name,
  });
  state.photos.push(photo);
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'photo.added',
    target: masterId,
    detail: photo.takenOn ? `taken ${photo.takenOn}` : 'no date given',
  });
  return photo;
}

export async function addAttachment(incidentId: string, file: File, caption: string) {
  const state = db();
  const user = currentUser();
  const id = newId('att');
  state.files[id] = await dataUrl(file);

  const attachment = {
    id,
    incidentId,
    filename: file.name,
    mime: file.type,
    size: file.size,
    sha256: await hashOf(file),
    caption,
    uploadedBy: user.id,
    uploadedByName: user.name,
    uploadedAt: new Date().toISOString(),
    retractedAt: '',
    retractedBy: '',
    retractionReason: '',
  };
  state.attachments.push(attachment);
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'attachment.added',
    target: file.name,
    detail: caption,
  });
  return attachment;
}

/**
 * Where a stored file lives.
 *
 * In the demo that is a data URL held in this tab; in the real app it is a
 * path the server streams. Components ask this rather than building the path
 * themselves, so neither has to know which it is.
 */
export function fileUrl(id: string, fallback: string): string {
  return db().files[id] ?? fallback;
}
