import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  FileText,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  ShieldCheck,
  ShieldX,
  Upload,
} from 'lucide-react';
import { useStore } from '@/state/store';
import type { Attachment } from '@/state/api';
import { Badge, Button, EmptyState, SectionAnchor } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { attachmentUrl } from '@/lib/assetUrl';

const MAX_BYTES = 25 * 1024 * 1024;

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('audio/')) return Music;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Photographs and documents attached to the report.
 *
 * These are evidence, so they behave like it: hashed when they arrive,
 * withdrawn rather than deleted, and every time one is opened it is recorded.
 */
export function SectionAttachments() {
  const { incident, attachments, uploadAttachment, can } = useStore();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const mine = useMemo(
    () => attachments.filter((a) => a.incidentId === incident?.id),
    [attachments, incident?.id],
  );
  const active = mine.filter((a) => !a.retractedAt);
  const withdrawn = mine.filter((a) => a.retractedAt);

  if (!incident) return null;

  const send = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is ${formatSize(file.size)}. The limit is 25 MB — body-worn video belongs in your evidence system, not here.`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await uploadAttachment(file, caption.trim());
    setBusy(false);
    if (result.ok) setCaption('');
    else setError(result.reason ?? 'Upload failed.');
  };

  return (
    <SectionAnchor section="attachments">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void send(file);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-accent bg-accent-soft' : 'border-line',
        )}
      >
        <Upload size={22} className="mx-auto mb-2 text-faint" aria-hidden />
        <p className="text-[13.5px] font-medium text-ink">
          Drop a photograph or document here
        </p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-muted">
          Photographs, PDFs, audio and plain text, up to 25 MB. Each file is fingerprinted as it
          arrives, so it can be shown later that the copy served is the copy taken.
        </p>

        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
            e.target.value = '';
          }}
        />

        <div className="mx-auto mt-4 flex max-w-md items-center gap-2">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption — what this shows"
            className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
          />
          <Button variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Paperclip size={15} aria-hidden />}
            Choose file
          </Button>
        </div>

        {error && (
          <p className="mx-auto mt-3 max-w-md rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>

      {active.length === 0 && withdrawn.length === 0 ? (
        <EmptyState
          icon={<Paperclip size={20} />}
          title="Nothing attached yet"
          body="Scene photographs, a copy of a receipt, the victim's written statement. What a prosecutor sees months from now is what is filed here."
        />
      ) : (
        <div className="space-y-2">
          {active.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} mayRetract={can('notes.retract')} />
          ))}
        </div>
      )}

      {withdrawn.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
            <Archive size={13} aria-hidden />
            {withdrawn.length} withdrawn
          </p>
          <ul className="mt-2 space-y-1.5">
            {withdrawn.map((a) => (
              <li key={a.id} className="text-[12px] text-faint">
                <span className="line-through">{a.filename}</span> — withdrawn by {a.retractedBy}{' '}
                {relativeTime(a.retractedAt)}
                {a.retractionReason && ` — “${a.retractionReason}”`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionAnchor>
  );
}

function AttachmentCard({
  attachment,
  mayRetract,
}: {
  attachment: Attachment;
  mayRetract: boolean;
}) {
  const { retractAttachment, verifyAttachment } = useStore();
  const [intact, setIntact] = useState<boolean | null>(null);
  const [retracting, setRetracting] = useState(false);
  const [reason, setReason] = useState('');
  const Icon = iconFor(attachment.mime);
  const isImage = attachment.mime.startsWith('image/');

  useEffect(() => {
    let cancelled = false;
    void verifyAttachment(attachment.id).then((r) => !cancelled && setIntact(r.intact));
    return () => {
      cancelled = true;
    };
  }, [attachment.id, verifyAttachment]);

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-3 p-4">
        {isImage ? (
          // Opening the file is itself an access event, and the server logs it.
          <a
            href={attachmentUrl(attachment.id)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
          >
            <img
              src={attachmentUrl(attachment.id)}
              alt={attachment.caption || attachment.filename}
              className="size-16 rounded-lg border border-line object-cover"
            />
          </a>
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-faint">
            <Icon size={22} aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={attachmentUrl(attachment.id)}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[13.5px] font-medium text-ink hover:underline"
            >
              {attachment.filename}
            </a>
            {intact === true && (
              <Badge tone="ok">
                <ShieldCheck size={11} aria-hidden />
                Verified
              </Badge>
            )}
            {intact === false && (
              <Badge tone="danger">
                <ShieldX size={11} aria-hidden />
                Altered since upload
              </Badge>
            )}
          </div>

          {attachment.caption && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink/85">{attachment.caption}</p>
          )}

          <p className="mt-1 text-[11.5px] text-faint">
            {formatSize(attachment.size)} · {attachment.uploadedByName} ·{' '}
            {relativeTime(attachment.uploadedAt)}
          </p>
          <p className="mt-0.5 font-mono text-[10.5px] text-faint" title={attachment.sha256}>
            sha256 {attachment.sha256.slice(0, 24)}…
          </p>

          {intact === false && (
            <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[12px] leading-relaxed text-danger">
              The stored file no longer matches the fingerprint taken when it was uploaded. Treat
              it as unreliable and escalate it — do not rely on this in a filing.
            </p>
          )}
        </div>

        {mayRetract && (
          <Button size="sm" variant="danger" onClick={() => setRetracting((v) => !v)}>
            <Archive size={13} aria-hidden />
            Withdraw
          </Button>
        )}
      </div>

      {retracting && (
        <div className="border-t border-line bg-raised p-3">
          <p className="text-[12.5px] font-medium text-ink">Withdraw this attachment?</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            It stops showing on the report. The file, who uploaded it and this withdrawal are kept.
          </p>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — e.g. duplicate of another photograph"
            className="mt-2 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={() => setRetracting(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!reason.trim()}
              onClick={() => void retractAttachment(attachment.id, reason.trim())}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
