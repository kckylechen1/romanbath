import React, { useState } from 'react';
import type { AffectState } from '../services/zeroclawService';
import { affectToLabel, formatAffectNumbers } from '../utils/affect';

interface AffectReadoutProps {
  affect: AffectState | null;
}

/**
 * UX-4: a subtle, touch-accessible decode of the avatar's mood glow. The glow
 * color alone is opaque; this surfaces a short emotion label always (low key)
 * and reveals the raw valence/arousal in studio mono on hover, focus, or tap.
 * It is its own affordance so it never competes with the avatar's tap-to-open
 * memories action.
 */
const AffectReadout: React.FC<AffectReadoutProps> = ({ affect }) => {
  const [open, setOpen] = useState(false);
  const readout = affectToLabel(affect);
  const numbers = formatAffectNumbers(readout.valence, readout.arousal);

  return (
    <div className="relative mt-2 flex flex-col items-center">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        aria-label={
          readout.known
            ? `Perceived mood: ${readout.label}${numbers ? `, ${numbers}` : ''}`
            : 'Perceived mood: reading'
        }
        aria-expanded={open}
        className="flex items-center gap-1.5 min-h-[28px] px-2.5 py-1 rounded-full text-[11px] tracking-wide font-sans text-bath-400/80 hover:text-bath-200 bg-bath-800/15 hover:bg-bath-800/40 border border-bath-700/15 transition-colors"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-accent/60"
          aria-hidden="true"
        />
        {readout.label}
      </button>

      {open && readout.known && numbers && (
        <div
          role="tooltip"
          className="absolute top-full mt-1.5 z-30 whitespace-nowrap rounded-lg bg-bath-900/95 border border-bath-700/20 px-2.5 py-1.5 shadow-lg animate-message-in"
        >
          <span className="font-mono text-[11px] text-bath-300">{numbers}</span>
        </div>
      )}
    </div>
  );
};

export default AffectReadout;
