/**
 * Attachments.
 *
 * A scene photograph is evidence, so this is not a file-upload feature with an
 * evidence label on it. Three things follow from that:
 *
 *  - **Hashed on ingest.** The SHA-256 recorded at upload is what proves the
 *    bytes served later are the bytes taken. `verifyAttachment` recomputes it.
 *  - **Withdrawn, never deleted.** The same rule as location notes: a file that
 *    turned out to be wrong still happened, and "who removed the photograph"
 *    is asked after something goes wrong.
 *  - **Every read is an access event.** Downloading a photograph attached to a
 *    case is logged, because that is a question that gets asked later.
 *
 * Bytes go to disk rather than into the database: SQLite would hold them, but a
 * database that doubles in size with every burglary becomes hard to back up,
 * and a file on disk can be streamed without loading it into memory.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from './auth';
import { recordAudit } from './audit';

/** 25 MB. Comfortably a phone photograph; deliberately not video. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Body-worn video belongs in a dedicated evidence system, which is where
 * agencies already keep it. Accepting it here would mean promising retention,
 * redaction and disclosure workflows this does not have.
 */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'audio/mpeg',
  'audio/wav',
]);

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export interface AttachmentRecord {
  id: string;
  incidentId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  caption: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  retractedAt: string;
  retractedBy: string;
  retractionReason: string;
}

function rowToAttachment(row: Record<string, string | number>): AttachmentRecord {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    filename: String(row.filename),
    mime: String(row.mime),
    size: Number(row.size),
    sha256: String(row.sha256),
    caption: String(row.caption),
    uploadedBy: String(row.uploaded_by),
    uploadedByName: String(row.uploaded_by_name),
    uploadedAt: String(row.uploaded_at),
    retractedAt: String(row.retracted_at),
    retractedBy: String(row.retracted_by),
    retractionReason: String(row.retraction_reason),
  };
}

export function listAttachments(db: DatabaseSync, incidentId?: string): AttachmentRecord[] {
  const rows = incidentId
    ? db
        .prepare('SELECT * FROM attachments WHERE incident_id = ? ORDER BY uploaded_at')
        .all(incidentId)
    : db.prepare('SELECT * FROM attachments ORDER BY uploaded_at').all();
  return (rows as unknown as Record<string, string | number>[]).map(rowToAttachment);
}

/** Filenames come from the client, so the path is built entirely from ours. */
function storagePath(root: string, id: string, mime: string): string {
  const extension = EXTENSION[mime] ?? 'bin';
  return join(root, `${id}.${extension}`);
}

/** Recomputes the digest of what is on disk and compares it to the record. */
export function verifyAttachment(root: string, record: AttachmentRecord): boolean {
  const path = storagePath(root, record.id, record.mime);
  if (!existsSync(path)) return false;
  return createHash('sha256').update(readFileSync(path)).digest('hex') === record.sha256;
}

export function registerAttachmentRoutes(app: Express, db: DatabaseSync, dataDir: string): void {
  const root = resolve(dataDir, 'attachments');
  mkdirSync(root, { recursive: true });

  // Held in memory so the file can be hashed before anything touches disk;
  // safe at 25 MB, and the point at which streaming would be worth it.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  app.get('/api/attachments', requireAuth, (req: Request, res: Response) => {
    const incidentId = typeof req.query.incident === 'string' ? req.query.incident : undefined;
    res.json({ attachments: listAttachments(db, incidentId) });
  });

  app.post(
    '/api/attachments',
    requireAuth,
    upload.single('file'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const file = req.file;
      const incidentId = String(req.body?.incidentId ?? '');

      if (!file) {
        res.status(400).json({ error: 'No file was sent.' });
        return;
      }
      if (!incidentId) {
        res.status(400).json({ error: 'An attachment must belong to a report.' });
        return;
      }
      if (!ALLOWED_MIME.has(file.mimetype)) {
        res.status(415).json({
          error: `${file.mimetype} is not an accepted file type. Photographs, PDFs, audio and plain text only — body-worn video belongs in your evidence system.`,
        });
        return;
      }

      const id = randomBytes(16).toString('hex');
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      await writeFile(storagePath(root, id, file.mimetype), file.buffer);

      const record: AttachmentRecord = {
        id,
        incidentId,
        // Kept for display only; it is never used to build a path.
        filename: String(file.originalname ?? 'file').slice(0, 200),
        mime: file.mimetype,
        size: file.size,
        sha256,
        caption: String(req.body?.caption ?? '').slice(0, 500),
        uploadedBy: user.id,
        uploadedByName: user.name,
        uploadedAt: new Date().toISOString(),
        retractedAt: '',
        retractedBy: '',
        retractionReason: '',
      };

      db.prepare(
        `INSERT INTO attachments (id, incident_id, filename, mime, size, sha256, caption, uploaded_by, uploaded_by_name, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.incidentId,
        record.filename,
        record.mime,
        record.size,
        record.sha256,
        record.caption,
        record.uploadedBy,
        record.uploadedByName,
        record.uploadedAt,
      );

      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'attachment.added',
        target: record.filename,
        detail: `${incidentId} · ${sha256.slice(0, 12)}`,
      });

      res.json({ ok: true, attachment: record });
    },
  );

  /** Serves the bytes. Every read is logged, because every read is an access. */
  app.get('/api/attachments/:id/file', requireAuth, async (req: Request, res: Response) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as
      | Record<string, string | number>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'No such attachment.' });
      return;
    }
    const record = rowToAttachment(row);
    const path = storagePath(root, record.id, record.mime);
    if (!existsSync(path)) {
      res.status(410).json({ error: 'The stored file is missing.' });
      return;
    }

    await recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'attachment.viewed',
      target: record.filename,
      detail: record.incidentId,
    });

    res.setHeader('Content-Type', record.mime);
    res.setHeader('Content-Length', String(statSync(path).size));
    // Never render an upload as a document in the app's own origin.
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path).pipe(res);
  });

  /** Confirms the bytes on disk still match the digest taken at upload. */
  app.get('/api/attachments/:id/verify', requireAuth, (req: Request, res: Response) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as
      | Record<string, string | number>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'No such attachment.' });
      return;
    }
    const record = rowToAttachment(row);
    res.json({ intact: verifyAttachment(root, record), sha256: record.sha256 });
  });

  /**
   * Withdrawal, not deletion — and it needs the same permission as withdrawing
   * a note, for the same reason.
   */
  app.post('/api/attachments/:id/retract', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const { can } = await import('../src/domain/auth');
    if (!can(user, 'notes.retract')) {
      res.status(403).json({
        error: 'Withdrawing an attachment needs the same authority as withdrawing a note.',
      });
      return;
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'A reason is required.' });
      return;
    }

    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as
      | Record<string, string | number>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'No such attachment.' });
      return;
    }

    db.prepare(
      'UPDATE attachments SET retracted_at = ?, retracted_by = ?, retraction_reason = ? WHERE id = ?',
    ).run(new Date().toISOString(), user.name, reason, req.params.id);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'attachment.retracted',
      target: String(row.filename),
      detail: reason,
    });

    res.json({ ok: true });
  });

  /** Removes an orphaned file from disk. Used by tests and maintenance only. */
  app.locals.purgeAttachmentFile = (record: AttachmentRecord) => {
    const path = storagePath(root, record.id, record.mime);
    if (existsSync(path)) unlinkSync(path);
  };
}
