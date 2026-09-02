/**
 * The model-backed narrative read.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  OFF UNLESS DELIBERATELY TURNED ON, and the reason is not caution for its
 *  own sake.
 *
 *  A police narrative is criminal justice information. It contains names,
 *  dates of birth, addresses, what a victim said happened to them, and often
 *  a juvenile. Sending it to a third-party API is a disclosure of CJI to that
 *  third party, and CJIS policy governs whether an agency may do that, under
 *  what agreement, and with what audit trail. That is a decision for the
 *  agency's CJIS Systems Officer and their legal counsel — not a default in
 *  a config file, and not something this code can decide on their behalf.
 *
 *  So it requires `AEGIS_AI_EXTRACTION=1` *and* a key. The pattern extractor
 *  in `src/domain/extraction/patterns.ts` runs in the browser, needs no
 *  network, and is what an agency gets until somebody signs something.
 * ─────────────────────────────────────────────────────────────────────
 *
 * What crosses the wire back is *data*, not instructions: a list of
 * `{field, value, quote}` against a closed field list, every one of which the
 * client re-checks against the narrative before showing it and a human accepts
 * before it reaches the report. A model that invents a fact produces a quote
 * that is not in the text, and the suggestion is dropped.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { EXTRACTABLE_FIELDS, type Finding } from '../src/domain/extraction/types';

export interface ExtractionConfig {
  enabled: boolean;
  model: string;
  /** Why it is off, for the client to show. */
  disabledReason: string;
}

export function extractionConfig(env: NodeJS.ProcessEnv = process.env): ExtractionConfig {
  const turnedOn = env.AEGIS_AI_EXTRACTION === '1';
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);

  return {
    enabled: turnedOn && hasKey,
    model: env.AEGIS_AI_MODEL || 'claude-opus-5',
    disabledReason: !turnedOn
      ? 'Narrative reading by model is switched off. It sends report narratives to a third party, which is a CJIS decision for your agency rather than a default. Set AEGIS_AI_EXTRACTION=1 once that is agreed.'
      : !hasKey
        ? 'Switched on but no ANTHROPIC_API_KEY is set, so there is nothing to call.'
        : '',
  };
}

/**
 * What the model is asked for.
 *
 * Written as a set of refusals rather than a set of capabilities, because the
 * failure that matters is not missing a plate — it is confidently reporting one
 * the narrative does not contain.
 */
const SYSTEM = `You read police incident narratives and report which structured fields the narrative already states. You do not write reports, interpret law, or decide what an officer meant.

Rules, in order of importance:

1. Report only what the narrative literally says. If it does not say it, it is not a finding. An officer reviewing your output should be able to point at the words.
2. Every finding carries a "quote": a span copied EXACTLY from the narrative, character for character, that states the fact. Anything else is discarded before an officer sees it, so an approximate quote is a wasted finding.
3. Do not infer. "The door was open" is not forced entry. A man being present is not a suspect. If two readings are possible, either omit the finding or mark it low confidence and say why in "reason".
4. Prefer omission. A short accurate list is useful; a long list with three wrong entries teaches the officer to ignore all of it.
5. Never report a person's identity, a criminal history, or anything about who is at fault. You are reading for form fields, not writing an assessment.

Confidence: "high" when the narrative states the fact outright; "medium" when it clearly implies it; "low" when it is a plausible reading the officer should check.`;

const TOOL: Anthropic.Tool = {
  name: 'report_findings',
  description:
    'Report the structured fields the narrative states. Call once with every finding, or with an empty list if the narrative states none of these fields.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'value', 'quote', 'confidence', 'reason'],
          properties: {
            field: { type: 'string', enum: [...EXTRACTABLE_FIELDS] },
            value: {
              type: 'string',
              description:
                'The value for the field. Method of entry is F or N. Weapon is a NIBRS weapon code. Times are YYYY-MM-DDTHH:MM. Flags are "true". Property value is digits only.',
            },
            quote: {
              type: 'string',
              description: 'Copied exactly from the narrative, character for character.',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: {
              type: 'string',
              description: 'One sentence, addressed to the officer, on why this is being suggested.',
            },
          },
        },
      },
    },
  },
};

export function registerExtractionRoutes(app: Express, db: DatabaseSync): void {
  const config = extractionConfig();
  const client = config.enabled ? new Anthropic() : null;

  app.get('/api/extract/status', requireAuth, (_req: Request, res: Response) => {
    res.json({ enabled: config.enabled, reason: config.disabledReason });
  });

  app.post('/api/extract', requireAuth, async (req: Request, res: Response) => {
    if (!client) {
      res.status(503).json({ error: config.disabledReason, findings: [] });
      return;
    }

    const narrative = String(req.body?.narrative ?? '');
    if (narrative.trim().length < 40) {
      res.json({ findings: [] });
      return;
    }
    // A narrative longer than this is not a narrative.
    if (narrative.length > 40_000) {
      res.status(413).json({ error: 'That narrative is too long to read.', findings: [] });
      return;
    }

    // Codes the report already uses, so the model proposes values this system
    // can actually store rather than plausible-looking ones it cannot.
    const context = String(req.body?.context ?? '').slice(0, 4_000);

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: 8_000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [TOOL],
        messages: [
          {
            role: 'user',
            content: `${context}\n\nNarrative:\n"""\n${narrative}\n"""`,
          },
        ],
      });

      // A refusal is a valid outcome, not an error: some narratives describe
      // things a model will decline to process, and the officer still has the
      // offline extractor.
      if (response.stop_reason === 'refusal') {
        res.json({ findings: [], refused: true });
        return;
      }

      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === 'report_findings',
      );
      const raw = call ? (call.input as { findings?: unknown[] }).findings ?? [] : [];

      // Shape-checked here; grounded against the narrative and allowlisted
      // again on the client, which is the check that actually matters.
      const findings: Finding[] = raw
        .filter((item): item is Record<string, string> => typeof item === 'object' && item !== null)
        .map((item) => ({
          field: String(item.field ?? '') as Finding['field'],
          value: String(item.value ?? ''),
          quote: String(item.quote ?? ''),
          confidence: (['high', 'medium', 'low'].includes(String(item.confidence))
            ? item.confidence
            : 'low') as Finding['confidence'],
          reason: String(item.reason ?? ''),
        }))
        .filter((f) => (EXTRACTABLE_FIELDS as readonly string[]).includes(f.field));

      // The narrative went to a third party. That is an access event.
      await recordAudit(db, {
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: 'narrative.read',
        target: String(req.body?.caseNumber ?? ''),
        detail: `${config.model} · ${findings.length} findings`,
      });

      res.json({ findings });
    } catch (error) {
      // Never a hard failure for the officer: the offline extractor still ran.
      const message =
        error instanceof Anthropic.APIError
          ? `The model could not be reached (${error.status}).`
          : 'The model could not be reached.';
      console.error('Extraction failed', error);
      res.status(502).json({ error: message, findings: [] });
    }
  });
}
