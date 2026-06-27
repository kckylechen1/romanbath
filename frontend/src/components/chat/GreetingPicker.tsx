import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Character } from '../../types';
import { getCharacterDetails } from '../../services/zeroclawService';
import { buildGreetingOptions, wrapIndex } from '../../utils/greetings';

interface GreetingPickerProps {
  /** The single-character companion whose card may carry alternate greetings. */
  character: Character;
  /** Content of the currently displayed opening greeting (to align the index). */
  currentContent: string;
  /** Replace the displayed opening greeting with the chosen one. Client-side. */
  onSelect: (content: string) => void;
}

/**
 * UX-6: lets the user pick among [firstMessage, ...alternateGreetings] while the
 * chat is still at its opening greeting. Purely presentational — selecting swaps
 * the displayed greeting content client-side; it is never a server turn. Renders
 * nothing unless the card actually offers more than one greeting.
 */
const GreetingPicker: React.FC<GreetingPickerProps> = ({
  character,
  currentContent,
  onSelect,
}) => {
  const [options, setOptions] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  // Fetch the full card to read alternateGreetings (the list view only carries
  // a count). Guarded against out-of-order resolves when the character changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const details = await getCharacterDetails(character.id);
      if (cancelled) return;
      setOptions(
        details ? buildGreetingOptions(details.firstMessage, details.alternateGreetings) : []
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  // Keep the indicator aligned to whatever greeting is currently shown (e.g.
  // after a new chat resets the content back to firstMessage).
  useEffect(() => {
    if (options.length === 0) return;
    const found = options.findIndex((g) => g.trim() === currentContent.trim());
    setIndex(found >= 0 ? found : 0);
  }, [options, currentContent]);

  if (options.length <= 1) return null;

  const go = (delta: number): void => {
    const next = wrapIndex(index + delta, options.length);
    setIndex(next);
    onSelect(options[next]);
  };

  return (
    <div
      className="flex items-center justify-center gap-2 mt-2 mb-6 animate-message-in"
      role="group"
      aria-label="Choose opening greeting"
    >
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous greeting"
        className="flex items-center justify-center min-h-[36px] min-w-[36px] p-2 rounded-full text-bath-500/70 hover:text-bath-200 hover:bg-bath-800/30 transition-colors"
      >
        <ChevronLeft size={16} />
      </button>
      <span
        className="font-mono text-xs text-bath-500/80 tabular-nums select-none"
        aria-live="polite"
      >
        {index + 1} / {options.length}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next greeting"
        className="flex items-center justify-center min-h-[36px] min-w-[36px] p-2 rounded-full text-bath-500/70 hover:text-bath-200 hover:bg-bath-800/30 transition-colors"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};

export default GreetingPicker;
