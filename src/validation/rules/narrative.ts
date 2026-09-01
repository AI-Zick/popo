import { path, type Issue, type Rule } from '../engine';

const MIN_NARRATIVE = 120;

export const narrativeRules: Rule[] = [
  (ctx) => {
    const issues: Issue[] = [];
    const text = ctx.incident.narrative.trim();

    if (text.length === 0) {
      issues.push({
        key: 'narrative.empty',
        ruleId: 'narrative.empty',
        severity: 'error',
        section: 'narrative',
        path: path.incident('narrative'),
        title: 'The narrative is empty',
        message: 'Every report needs a written account of what happened.',
        tip: 'Work in order: how you were dispatched, what you saw on arrival, what each person told you, what you did, and how it ended. The coded fields above are for statistics — the narrative is what a prosecutor actually reads.',
      });
      return issues;
    }

    if (text.length < MIN_NARRATIVE) {
      issues.push({
        key: 'narrative.short',
        ruleId: 'narrative.short',
        severity: 'warning',
        section: 'narrative',
        path: path.incident('narrative'),
        title: 'The narrative is very short',
        message: `${text.length} characters is rarely enough to establish the elements of an offense.`,
        tip: 'Ask yourself whether a reader who was not there could tell what crime occurred and how you know. If a supervisor would have to call you to understand it, it needs more.',
      });
    }

    // People mentioned in the report but never in the narrative
    const unmentioned = ctx.persons.filter((p) => {
      const name = p.lastName.trim() || p.businessName.trim();
      if (!name || name.length < 3) return false;
      return !text.toLowerCase().includes(name.toLowerCase());
    });

    if (unmentioned.length > 0 && text.length >= MIN_NARRATIVE) {
      issues.push({
        key: 'narrative.unmentioned',
        ruleId: 'narrative.unmentioned',
        severity: 'warning',
        section: 'narrative',
        path: path.incident('narrative'),
        title: 'Someone on the report is not in the narrative',
        message: `${unmentioned
          .slice(0, 3)
          .map((p) => ctx.personLabel(p))
          .join(', ')}${unmentioned.length > 3 ? ` and ${unmentioned.length - 3} more` : ''} ${
          unmentioned.length === 1 ? 'does' : 'do'
        } not appear anywhere in the narrative.`,
        tip: 'If a person is on the report, the narrative should say what they did or saw. A name in the coded fields with nothing in the story is the first thing defense counsel will ask about.',
      });
    }

    if (ctx.arrestees.length > 0) {
      const lower = text.toLowerCase();
      const mentionsRights = ['miranda', 'rights', 'advised'].some((w) => lower.includes(w));
      if (!mentionsRights) {
        issues.push({
          key: 'narrative.miranda',
          ruleId: 'narrative.miranda',
          severity: 'warning',
          section: 'narrative',
          path: path.incident('narrative'),
          title: 'Arrest with no mention of rights advisement',
          message: 'This report has an arrestee but the narrative never mentions Miranda or a rights advisement.',
          tip: 'If you interviewed them in custody, document when you advised them and whether they waived. If you never questioned them, say that explicitly — silence on the point invites a suppression motion.',
        });
      }
    }

    return issues;
  },
];
