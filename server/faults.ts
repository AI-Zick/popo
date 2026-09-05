/**
 * Somewhere for errors to go.
 *
 * There was a health check and a request log, and nothing watching either. The
 * first report of a failure was an officer telephoning somebody, which means
 * every failure that did not stop an officer working was invisible — and those
 * are the ones that turn into "it has been doing that for months".
 *
 * This is not a monitoring service and does not pretend to be one. It does
 * three things: it stops errors being lost, it gives each one a reference an
 * officer can read down a telephone, and it offers a way for something else to
 * be told. What that something else is belongs to whoever runs the machine.
 *
 * ## What is deliberately not recorded
 *
 * Request bodies, query strings and path parameters. The error log lives on the
 * same disk as the records, and — this is the part that matters — it is *not*
 * in the purge registry, so nothing in it is removed when a court orders a
 * record destroyed. Anything about a person that reached this file would
 * outlive the expungement of the record it came from. So what is written is the
 * shape of the request, never its contents: the route pattern rather than the
 * path, the error's own message and stack, and nothing that came from a form.
 *
 * A message can still carry something if code somewhere interpolates a name
 * into an error, and no amount of care here prevents that. It is worth knowing
 * about rather than assuming away, and DEPLOYMENT.md says so.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import { scrub } from '../src/domain/faults';

export interface Fault {
  /** Short, readable down a telephone. */
  reference: string;
  at: string;
  kind: string;
  message: string;
  /** Route pattern, never the path. */
  route: string;
  method: string;
  /** Who was signed in, by id. Never a name. */
  user: string | null;
  stack: string;
}

export interface FaultOptions {
  dataDir: string;
  /** Where to POST a short notice. Empty for nowhere. */
  alertUrl: string;
  production: boolean;
}

/** Six characters an officer can read out without spelling anything. */
const reference = (): string => randomBytes(3).toString('hex').toUpperCase();

/** The route pattern, or a path with its identifiers taken out. */
const shapeOf = (req: Request): string =>
  req.route?.path ?? req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id');

export function createFaultLog(options: FaultOptions) {
  const dir = resolve(options.dataDir);
  const path = join(dir, 'faults.log');
  /*
    Held in memory as well, so the health check can say how many there have
    been without reading a file on every probe. Only a count and the last few:
    this is a signal that something is wrong, not a second copy of the log.
  */
  const recent: Fault[] = [];
  let total = 0;

  const write = (fault: Fault): void => {
    total += 1;
    recent.unshift(fault);
    if (recent.length > 20) recent.pop();
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path, `${JSON.stringify(fault)}\n`, 'utf8');
    } catch {
      // A disk that cannot be written to is a bigger problem than this record
      // of it, and throwing here would turn one failed request into two.
    }
    // Always to the console too: whatever collects container output gets it.
    console.error(`[fault ${fault.reference}] ${fault.kind}: ${fault.message}`);

    if (options.alertUrl) {
      /*
        Fire and forget, and never awaited by a request. An alerting endpoint
        that is slow or down must not make the failure it is being told about
        any worse.
      */
      void fetch(options.alertUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reference: fault.reference,
          at: fault.at,
          kind: fault.kind,
          message: fault.message,
          route: fault.route,
          method: fault.method,
        }),
      }).catch(() => undefined);
    }
  };

  const record = (error: unknown, context: Partial<Fault> = {}): Fault => {
    const fault: Fault = {
      reference: reference(),
      at: new Date().toISOString(),
      kind: error instanceof Error ? error.name : typeof error,
      message: scrub((error instanceof Error ? error.message : String(error)).slice(0, 500)),
      route: '',
      method: '',
      user: null,
      stack: scrub((error instanceof Error ? (error.stack ?? '') : '').slice(0, 4000)),
      ...context,
    };
    write(fault);
    return fault;
  };

  return {
    record,
    get count() {
      return total;
    },
    /** The most recent few, for the health check and nothing else. */
    get recent() {
      return recent;
    },
    /** Whether anything has been written, for an operator asking. */
    logPath: path,
    exists: () => existsSync(path),
    /** How many lines are on disk, which survives a restart. Cheap enough. */
    onDisk: (): number => {
      try {
        return readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
      } catch {
        return 0;
      }
    },
  };
}

export type FaultLog = ReturnType<typeof createFaultLog>;

/**
 * The last thing in the middleware chain.
 *
 * Every error thrown out of a route ends here rather than in a stack trace on
 * somebody's terminal, and the officer gets a reference rather than a stack —
 * the message they see is the one they can usefully repeat, and a stack trace
 * on screen tells an attacker about the software and the officer nothing.
 */
export function installFaultHandler(app: Express, faults: FaultLog): void {
  app.use((error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const fault = faults.record(error, {
      route: shapeOf(req),
      method: req.method,
      user: req.user?.id ?? null,
    });
    res.status(500).json({
      error: `Something went wrong at our end. Quote ${fault.reference} if you report it.`,
      reference: fault.reference,
    });
  });
}

/**
 * Errors nobody caught at all.
 *
 * An unhandled rejection is recorded and the process carries on, because it is
 * usually one request's problem. An uncaught exception is recorded and the
 * process stops: Node's own guidance, and the honest position — the process is
 * in a state nobody reasoned about, and a supervisor restarting it is safer
 * than it continuing to serve records from that state.
 */
export function installProcessHandlers(faults: FaultLog): void {
  process.on('unhandledRejection', (reason) => {
    faults.record(reason, { route: '(unhandled rejection)', method: '' });
  });
  process.on('uncaughtException', (error) => {
    faults.record(error, { route: '(uncaught exception)', method: '' });
    console.error('Stopping: the process is in a state nobody reasoned about.');
    process.exit(1);
  });
}
