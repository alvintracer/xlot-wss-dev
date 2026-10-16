import { useEffect, type RefObject } from 'react';

const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]), textarea';
const SCROLL_SELECTOR = '.kw-transfer-scroll, .kw-scroll';

export function useFocusedFieldVisibility(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let scheduled = 0;
    let delayed = 0;

    const revealFocusedField = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !field.matches(FIELD_SELECTOR) || !root.contains(field)) return;
      const scroll = field.closest(SCROLL_SELECTOR);
      if (!(scroll instanceof HTMLElement) || !root.contains(scroll)) return;
      const fieldRect = field.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const bottomOverflow = fieldRect.bottom - (scrollRect.bottom - 20);
      const topOverflow = (scrollRect.top + 16) - fieldRect.top;
      if (bottomOverflow > 0) scroll.scrollTop += bottomOverflow;
      else if (topOverflow > 0) scroll.scrollTop -= topOverflow;
    };
    const scheduleReveal = () => {
      cancelAnimationFrame(scheduled);
      window.clearTimeout(delayed);
      scheduled = requestAnimationFrame(revealFocusedField);
      // Mobile keyboards animate after focus; re-check when the viewport settles.
      delayed = window.setTimeout(revealFocusedField, 350);
    };
    const observer = new ResizeObserver(scheduleReveal);
    observer.observe(root);
    root.addEventListener('focusin', scheduleReveal);
    window.addEventListener('resize', scheduleReveal);
    window.visualViewport?.addEventListener('resize', scheduleReveal);
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', scheduleReveal);
      window.removeEventListener('resize', scheduleReveal);
      window.visualViewport?.removeEventListener('resize', scheduleReveal);
      cancelAnimationFrame(scheduled);
      window.clearTimeout(delayed);
    };
  }, [rootRef]);
}
