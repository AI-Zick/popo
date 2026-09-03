import { MessageSquarePlus } from 'lucide-react';

/**
 * The one control that has to be on every screen.
 *
 * Feedback nobody can find is feedback nobody sends, and the moment worth
 * capturing is the one where somebody is annoyed — which is on whatever screen
 * annoyed them, not on a support page two clicks away.
 *
 * So it floats, bottom-left, out of the way of the primary actions every screen
 * puts bottom-right. Quiet until hovered, because it is not what anybody came
 * here to do, and gone entirely when printing.
 */
export function FeedbackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The setup screen has a tab called "Feedback" too. Distinct here so a
      // screen reader announces the action rather than the topic.
      aria-label="Send feedback"
      title="Tell us what is wrong, or what would help"
      className="group fixed bottom-4 left-4 z-[80] flex items-center gap-2 rounded-full border border-line bg-surface/90 py-2 pl-2.5 pr-3 text-[12.5px] font-medium text-muted shadow-lg backdrop-blur transition hover:border-accent/40 hover:text-ink focus-visible:text-ink print:hidden"
    >
      <MessageSquarePlus size={15} className="text-faint transition group-hover:text-accent" aria-hidden />
      Feedback
    </button>
  );
}
