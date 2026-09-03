/**
 * Where this software's makers can be reached.
 *
 * One constant, deliberately in source rather than in each agency's
 * environment, because the default has to be *on*. A feedback channel that
 * every customer must configure before it works is a channel that reports
 * nothing from the agencies least likely to configure it — which are the
 * agencies whose problems you most need to hear about.
 *
 * An agency that genuinely cannot allow outbound traffic sets
 * `AEGIS_FEEDBACK_URL=off`, and the setup screen tells them what that costs.
 * Turning it off is a decision somebody makes, not a default they inherit.
 */

/** Set this to your deployed receiver. See `vendor/feedback-receiver`. */
export const VENDOR_FEEDBACK_URL = '';

/**
 * Resolves the endpoint for this install.
 *
 * `off` (or `0`, or `false`) disables forwarding. Any other value overrides
 * the built-in address — used in testing, and by an agency pointing at their
 * own relay.
 */
export function resolveFeedbackUrl(configured: string | undefined): string {
  const value = (configured ?? '').trim();
  if (value === '') return VENDOR_FEEDBACK_URL;
  if (['off', '0', 'false', 'none'].includes(value.toLowerCase())) return '';
  return value;
}
