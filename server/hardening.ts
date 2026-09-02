/**
 * Deployment hardening.
 *
 * The application boundary was already real; this is the layer around it.
 * Everything here is written without extra dependencies so there is nothing
 * additional to keep patched in an environment where patching is a change
 * request.
 */

import type { Express, NextFunction, Request, Response } from 'express';

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

  return {
    config: {
      port: Number(env.PORT ?? 4000),
      dbPath: env.AEGIS_DB ?? `${dataDir}/aegis.db`,
      dataDir,
      production,
      serveClient: env.AEGIS_SERVE_CLIENT === '1' || production,
      tls,
      trustProxy: behindProxy,
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

export function installHealthCheck(app: Express, started = Date.now()): void {
  // Unauthenticated on purpose, and says nothing that is not already public.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptimeSeconds: Math.floor((Date.now() - started) / 1000) });
  });
}
