/**
 * Photographs of a person.
 *
 * Shaped by two rules the rest of this system already follows.
 *
 * **Anyone may add one, nobody may delete one.** A wrong photograph is asked
 * about, and somebody with the authority to withdraw a note decides — that is
 * the same authority for the same reason, and there is deliberately no
 * endpoint that removes a row. A photograph taken down keeps its bytes, its
 * hash, who asked, who decided and why, because "who took that picture off his
 * record" is a question asked after something goes wrong.
 *
 * **The date is the date it was taken.** Not the upload time, which is easy to
 * record and worth nothing: a booking photo scanned out of a 2014 file is
 * twelve years old however recently somebody got round to adding it.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { DOC_TABLES, documents } from './db';
import { requireAuth } from './auth';
import { can } from '../src/domain/auth';
import { recordAudit } from './audit';
import {
  canDecide,
  canRequestRemoval,
  createPhoto,
  photosFor,
  type PersonPhoto,
  type PhotoKind,
} from '../src/domain/photo';
import type { FieldSource, MasterPerson } from '../src/domain/person';

const photos = documents<PersonPhoto>(DOC_TABLES.personPhotos);
const people = documents<MasterPerson>(DOC_TABLES.people);

/** 15 MB. A phone photograph with room to spare; deliberately not video. */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
};

const KINDS: PhotoKind[] = ['', 'booking', 'field', 'identification', 'marks', 'other'];
const SOURCES: FieldSource[] = ['officer', 'dmv', 'nlets', 'import', 'unknown'];

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/** A date, or nothing. A half-typed one is nothing, not a date in year 202. */
const day = (value: unknown): string => {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

function oneOf<T extends string>(value: unknown, allowed: T[]): T {
  return allowed.includes(value as T) ? (value as T) : ('' as T);
}

/** Built entirely from our own id — a filename from a client never sees disk. */
function storagePath(root: string, photo: { id: string; mime: string }): string {
  return join(root, `${photo.id}.${ALLOWED_MIME[photo.mime] ?? 'bin'}`);
}

export function registerPhotoRoutes(app: Express, db: DatabaseSync, dataDir: string): void {
  const root = resolve(dataDir, 'photos');
  mkdirSync(root, { recursive: true });

  // In memory so the bytes can be hashed before anything touches disk.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  });

  /** One person's photographs, newest likeness first. */
  app.get('/api/people/:masterId/photos', requireAuth, (req: Request, res: Response) => {
    const all = photos.where(db, { master_id: text(req.params.masterId, 64) });
    res.json({ photos: photosFor(all, text(req.params.masterId, 64)) });
  });

  /** Every photograph, so a client can show a face beside a name anywhere. */
  app.get('/api/photos', requireAuth, (_req: Request, res: Response) => {
    res.json({ photos: photos.all(db) });
  });

  /**
   * The bytes.
   *
   * Served from a path built out of the record, never out of anything the
   * client sent. A photograph that has been taken down is not served: the
   * record of it stays, the picture stops.
   */
  app.get('/api/photos/:id/file', requireAuth, (req: Request, res: Response) => {
    const photo = photos.find(db, req.params.id);
    if (!photo) {
      res.status(404).json({ error: 'No such photograph.' });
      return;
    }
    if (photo.removal === 'removed') {
      res.status(410).json({ error: 'This photograph has been taken down.' });
      return;
    }
    const path = storagePath(root, photo);
    if (!existsSync(path)) {
      res.status(404).json({ error: 'The file is missing from storage.' });
      return;
    }
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(path).pipe(res);
  });

  /** Anyone signed in may add one. */
  app.post(
    '/api/people/:masterId/photos',
    requireAuth,
    upload.single('file'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const file = req.file;
      const masterId = text(req.params.masterId, 64);

      if (!file) {
        res.status(400).json({ error: 'No file was sent.' });
        return;
      }
      if (!ALLOWED_MIME[file.mimetype]) {
        res.status(415).json({
          error: `${file.mimetype} is not a photograph. JPEG, PNG, HEIC or WebP.`,
        });
        return;
      }
      if (!people.find(db, masterId)) {
        res.status(404).json({ error: 'No such person.' });
        return;
      }

      const id = randomBytes(16).toString('hex');
      const photo = createPhoto({
        id,
        masterId,
        takenOn: day(req.body?.takenOn),
        kind: oneOf(req.body?.kind, KINDS),
        caption: text(req.body?.caption, 300),
        source: oneOf(req.body?.source, SOURCES) || 'officer',
        // Kept for display only; it is never used to build a path.
        filename: text(file.originalname ?? 'photo', 200),
        mime: file.mimetype,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        addedBy: user.id,
        addedByName: user.name,
      });

      await writeFile(storagePath(root, photo), file.buffer);
      photos.save(db, photo);

      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'photo.added',
        target: masterId,
        detail: photo.takenOn ? `taken ${photo.takenOn}` : 'no date given',
      });

      res.json({ photo });
    },
  );

  /**
   * Asking for one to come down. Open to everyone, which is the point.
   *
   * The officer who spots that the picture on a record is the wrong man is
   * rarely the one holding the authority to do something about it, and a
   * system where they have to find that person is one where the wrong picture
   * stays up.
   */
  app.post('/api/photos/:id/request-removal', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const photo = photos.find(db, req.params.id);
    if (!photo) {
      res.status(404).json({ error: 'No such photograph.' });
      return;
    }

    const allowed = canRequestRemoval(photo);
    if (!allowed.ok) {
      res.status(409).json({ error: allowed.reason });
      return;
    }

    const reason = text(req.body?.reason, 500).trim();
    if (!reason) {
      res.status(400).json({
        error: 'Say what is wrong with it. "Wrong photo" gives whoever decides nothing to go on.',
      });
      return;
    }

    const next: PersonPhoto = {
      ...photo,
      removal: 'requested',
      requestedBy: user.id,
      requestedByName: user.name,
      requestedAt: new Date().toISOString(),
      requestReason: reason,
      decidedByName: '',
      decidedAt: '',
      decisionNote: '',
    };
    photos.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'photo.removalRequested',
      target: photo.masterId,
      detail: reason,
    });

    res.json({ photo: next });
  });

  /**
   * Deciding. Needs the authority to withdraw a note, for the same reason.
   *
   * Refusing is a real outcome and is recorded as one — a request that quietly
   * expires teaches everybody to stop reporting wrong photographs.
   */
  app.post('/api/photos/:id/decide', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'notes.retract')) {
      res.status(403).json({
        error: 'Taking a photograph off a record needs the same authority as withdrawing a note.',
      });
      return;
    }

    const photo = photos.find(db, req.params.id);
    if (!photo) {
      res.status(404).json({ error: 'No such photograph.' });
      return;
    }
    const allowed = canDecide(photo);
    if (!allowed.ok) {
      res.status(409).json({ error: allowed.reason });
      return;
    }

    const remove = Boolean(req.body?.remove);
    const note = text(req.body?.note, 500).trim();
    if (!remove && !note) {
      res.status(400).json({ error: 'Say why it is staying up. The person who asked will see it.' });
      return;
    }

    const next: PersonPhoto = {
      ...photo,
      removal: remove ? 'removed' : 'kept',
      decidedByName: user.name,
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    };
    photos.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: remove ? 'photo.removed' : 'photo.kept',
      target: photo.masterId,
      detail: note || photo.requestReason,
    });

    res.json({ photo: next });
  });
}
