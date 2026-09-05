/**
 * Deployment hardening.
 *
 * The application boundary was already real; this is the layer around it.
 * Everything here is written without extra dependencies so there is nothing
 * additional to keep patched in an environment where patching is a change
 * request.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { resolveFeedbackUrl } from './vendor';
import {
  expired,
  spend as spendAttempt,
  waitSeconds as attemptWait,
  type Attempts,
} from '../src/domain/attempts';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface ServerConfig {
  port: number;
  dbPath: string;
  dataDir: string;
  production: boolean;
  /** Serve the built client from the API, so there is one origin and no CORS. */
  serveClient: boolean;
  tls: { keyPath: string; certPath: string } | null;
  /** Trust X-Forwarded-* — only true behind a reverse proxy you control. */
  trustProxy: boolean;
  /** Where a short notice about an error is posted. Empty for nowhere. */
  alertUrl: string;
  /**
   * The mail relay password, from AEGIS_SMTP_PASSWORD.
   *
   * Deliberately not part of the agency profile: the profile lives in the
   * database, and a database is copied, backed up and restored elsewhere.
   */
  smtpPassword: string;
  /**
   * Where officer feedback is posted, or empty for nowhere.
   *
   * The only outbound path in the system. On by default — see `vendor.ts` for
   * why — and switched off with `AEGIS_FEEDBACK_URL=off`, which leaves feedback
   * in the agency's own database to be exported by hand.
   */
  feedbackUrl: string;
  /** This agency's signing key, so the receiver can tell who sent it. */
  feedbackKey: string;
}

export interface ConfigProblem {
  fatal: boolean;
  message: string;
}

/**
 * Reads configuration and, in production, refuses to start on anything that
 * would quietly weaken the deployment. A misconfiguration that only shows up
 * as a missing header is the kind that survives to an audit.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): {
  config: ServerConfig;
  problems: ConfigProblem[];
} {
  const production = env.NODE_ENV === 'production';
  const problems: ConfigProblem[] = [];

  const keyPath = env.AEGIS_TLS_KEY ?? '';
  const certPath = env.AEGIS_TLS_CERT ?? '';
  const tls = keyPath && certPath ? { keyPath, certPath } : null;
  const behindProxy = env.AEGIS_TRUST_PROXY === '1';

  if (production && !tls && !behindProxy) {
    problems.push({
      fatal: true,
      message:
        'Refusing to start: production with no TLS. Set AEGIS_TLS_KEY and AEGIS_TLS_CERT, or set AEGIS_TRUST_PROXY=1 if TLS terminates at a reverse proxy in front of this process. Session cookies are useless over plaintext.',
    });
  }

  const dataDir = env.AEGIS_DATA_DIR ?? 'data';

  /*
    Feedback forwarding. Refused over plaintext in production: this is the one
    request that carries agency-authored text off the agency's network, and
    sending it unencrypted would undo the point of every other control here.
  */
  const feedbackUrl = resolveFeedbackUrl(env.AEGIS_FEEDBACK_URL);
  const feedbackKey = env.AEGIS_FEEDBACK_KEY ?? '';

  /*
    The password for the agency's outgoing mail relay.

    From the environment rather than the database, for the reason every other
    credential here is: a database is copied to backups, restored onto other
    machines, and read by anybody who can read the disk, and a working SMTP
    credential sitting in it is the agency's outbound mail handed to whoever
    holds a copy. The rest of the mail configuration — host, port, From
    address — is ordinary settings an administrator edits on screen.
  */
  const smtpPassword = env.AEGIS_SMTP_PASSWORD ?? '';

  /*
    Where a short notice about an error is posted, or nowhere. Deliberately
    just a URL: whatever the hosting already has — a chat webhook, an incident
    tool, a script — is better than anything invented here, and the requirement
    is that somebody is told rather than that we are the ones telling them.
  */
  const alertUrl = env.AEGIS_ALERT_URL ?? '';
  if (production && !alertUrl) {
    problems.push({
      fatal: false,
      message:
        'No AEGIS_ALERT_URL. Errors are written to faults.log and counted on /api/health, but nothing will tell anybody. Point it at whatever you already watch.',
    });
  }

  /*
    Every install gets its own key at provisioning, so one leaked key is one
    agency to rotate rather than a hole anybody can post through. Without one
    the receiver has no way to know a request is really from this agency.
  */
  if (feedbackUrl && !feedbackKey) {
    problems.push({
      fatal: false,
      message:
        'No AEGIS_FEEDBACK_KEY. Feedback will be sent unsigned and the receiver will reject it. Ask for this agency\'s key.',
    });
  }
  if (feedbackUrl && !feedbackUrl.startsWith('https://')) {
    if (production) {
      problems.push({
        fatal: true,
        message:
          'Refusing to start: AEGIS_FEEDBACK_URL is not https. Feedback carries text written inside the agency to somewhere outside it, and must not cross the network in clear.',
      });
    } else {
      problems.push({
        fatal: false,
        message: 'AEGIS_FEEDBACK_URL is not https. Allowed in development only.',
      });
    }
  }

  return {
    config: {
      port: Number(env.PORT ?? 4000),
      dbPath: env.AEGIS_DB ?? `${dataDir}/aegis.db`,
      dataDir,
      production,
      serveClient: env.AEGIS_SERVE_CLIENT === '1' || production,
      tls,
      trustProxy: behindProxy,
      feedbackUrl,
      feedbackKey,
      smtpPassword,
      alertUrl,
    },
    problems,
  };
}

/* ------------------------------------------------------------------ */
/* Security headers                                                    */
/* ------------------------------------------------------------------ */

/**
 * The client is a bundled single-page app with no inline scripts, so the
 * policy can be strict. `style-src` allows inline because the bundler emits a
 * style element; scripts do not get the same latitude.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // No third-party embedding, no plugins, no form posts off-origin.
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(config: ServerConfig) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    // Do not let a case number or a name end up in a proxy or browser cache.
    res.setHeader('Cache-Control', 'no-store');

    if (config.production || config.tls) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Nothing is gained by advertising the stack.
    res.removeHeader('X-Powered-By');
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter, in memory.
 *
 * Per-account lockout already slows guessing at one username; this is the
 * other half — it slows an attacker spreading attempts across many usernames
 * from one source, which lockout alone does nothing about.
 *
 * In memory means per process: behind more than one instance, this needs a
 * shared store, or the limit multiplies by the instance count.
 */
export function createRateLimiter(options: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  // Buckets are only kept while they can still refuse something.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, options.windowMs);
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(seconds));
      res.status(429).json({
        error: `Too many attempts. Wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`,
      });
      return;
    }
    next();
  };
}

/**
 * A limiter that is spent by hand rather than by arriving.
 *
 * The blanket middleware above counts every request that reaches the route,
 * which is right for signing in — every attempt there is a guess. It is wrong
 * for changing a password, where most refusals are not guesses at all: too
 * short, contains your username, same as the old one. Those are somebody
 * choosing a password with the rules in front of them, and counting them
 * against a brute-force budget locks out the one person doing it properly
 * while barely inconveniencing an attacker, who only ever sends the current
 * password and so only ever spends on the attempts that matter.
 *
 * So the route asks first and spends afterwards, and only on the failure that
 * is actually a guess.
 */
export function createAttemptGuard(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, Attempts>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (expired(bucket, now)) buckets.delete(key);
  }, options.windowMs);
  sweep.unref?.();

  const keyOf = (req: Request): string => `${req.ip ?? 'unknown'}`;

  return {
    /** How long to wait, or 0 when there is budget left. */
    waitSeconds(req: Request): number {
      return attemptWait(buckets.get(keyOf(req)), Date.now(), options.max);
    },
    /** Called once a request turns out to have been a guess. */
    spend(req: Request): void {
      const key = keyOf(req);
      buckets.set(key, spendAttempt(buckets.get(key), Date.now(), options.windowMs));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Request logging                                                     */
/* ------------------------------------------------------------------ */

/**
 * Method, path shape, status and duration — never query strings, bodies or
 * response contents. An access log that quotes URLs will eventually quote a
 * name or a case number into a file with weaker protection than the database.
 */
export function requestLog(config: ServerConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.production) return next();
    const started = Date.now();
    res.on('finish', () => {
      const route = req.route?.path ?? req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id');
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          route,
          status: res.statusCode,
          ms: Date.now() - started,
          user: req.user?.id ?? null,
        }),
      );
    });
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Finish in-flight requests before exiting, so a deploy does not truncate a
 * report someone is part-way through saving.
 */
export function installGracefulShutdown(
  server: { close: (cb: () => void) => void },
  onClosed: () => void,
): void {
  let shuttingDown = false;
  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; finishing in-flight requests.`);
    server.close(() => {
      onClosed();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref?.();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

export function installHealthCheck(
  app: Express,
  /**
   * How many errors this process has recorded.
   *
   * Reported so that something outside can alert on it without any webhook
   * being configured: whatever polls the health check already exists, and a
   * count that goes up is the cheapest possible signal that somebody should
   * look. A number only — never a message, because this endpoint is
   * unauthenticated.
   */
  faults: () => number = () => 0,
  started = Date.now(),
): void {
  // Unauthenticated on purpose, and says nothing that is not already public.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - started) / 1000),
      faults: faults(),
    });
  });
}
