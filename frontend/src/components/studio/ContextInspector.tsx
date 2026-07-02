import React, { useState } from 'react';
import { ChevronDown, FileCode2, Sparkles, Gauge } from 'lucide-react';
import type { TurnContext } from '../../services/zeroclawService';
import { approxTokens, formatCount, formatCost } from './contextFormat';

interface ContextInspectorProps {
  systemPrompt: string | null;
  turnContext: TurnContext | null;
}

// A collapsible instrument-panel card. Denser than the chat surface: thin
// verdigris/amber hairlines, a mono section label, and a small right-aligned
// hint slot for counts. The body cross-fades open/closed.
const Section: React.FC<{
  icon: React.ElementType;
  label: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ icon: Icon, label, hint, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-bath-700/25 bg-black/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors group"
      >
        <Icon size={13} className="text-accent/80 shrink-0" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-bath-200">
          {label}
        </span>
        {hint && (
          <span className="ml-auto font-mono text-[10px] text-bath-500 tabular-nums">{hint}</span>
        )}
        <ChevronDown
          size={14}
          className={`${hint ? 'ml-2' : 'ml-auto'} text-bath-500 transition-transform duration-300 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-0.5 animate-message-in">{children}</div>
      )}
    </section>
  );
};

const EmptyHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="font-sans text-[13px] italic text-bath-500/70 leading-relaxed py-1">{children}</p>
);

// One metric row: label on the left, right-aligned mono value. Numbers are
// tabular and never tail-truncated (full count always visible).
const Metric: React.FC<{ label: string; value: string; accent?: boolean; truncate?: boolean }> = ({
  label,
  value,
  accent,
  truncate,
}) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-bath-800/40 last:border-0">
    <span className="font-mono text-[10px] uppercase tracking-wider text-bath-500 shrink-0">
      {label}
    </span>
    <span
      // Numeric metrics never truncate (full count always visible); free-text
      // values (model/provider) may be long, so they truncate with a title
      // tooltip rather than overflow the rail.
      title={truncate ? value : undefined}
      className={`font-mono text-[12px] tabular-nums text-right ${
        truncate ? 'min-w-0 truncate' : 'whitespace-nowrap'
      } ${accent ? 'text-primary' : 'text-bath-100'}`}
    >
      {value}
    </span>
  </div>
);

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  systemPrompt,
  turnContext,
}) => {
  const promptChars = systemPrompt?.length ?? 0;
  const promptHint = systemPrompt
    ? `${formatCount(promptChars)} ch · ~${formatCount(approxTokens(promptChars))} tok`
    : undefined;

  const recalled = turnContext?.recalledMemories?.trim() ?? '';

  return (
    <div className="space-y-3">
      {/* a) Resolved system prompt */}
      <Section icon={FileCode2} label="Resolved system prompt" hint={promptHint}>
        {systemPrompt ? (
          <pre className="font-mono text-[11px] leading-relaxed text-bath-200/90 whitespace-pre-wrap break-words max-h-[42vh] overflow-y-auto custom-scrollbar rounded-lg bg-black/40 border border-bath-800/50 p-3">
            {systemPrompt}
          </pre>
        ) : (
          <EmptyHint>No prompt captured yet. Open a companion chat.</EmptyHint>
        )}
      </Section>

      {/* b) Recalled this turn */}
      <Section icon={Sparkles} label="Recalled this turn">
        {recalled ? (
          <div className="font-sans text-[13px] leading-relaxed text-bath-100/90 whitespace-pre-wrap break-words max-h-[28vh] overflow-y-auto custom-scrollbar rounded-lg bg-black/20 border-l-2 border-accent/40 pl-3 pr-2 py-2">
            {recalled}
          </div>
        ) : (
          <EmptyHint>No memories injected this turn.</EmptyHint>
        )}
      </Section>

      {/* c) Token budget */}
      <Section icon={Gauge} label="Token budget">
        {turnContext ? (
          <div className="rounded-lg bg-black/20 border border-bath-800/50 px-3 py-1">
            <Metric label="Input" value={formatCount(turnContext.inputTokens)} />
            <Metric label="Output" value={formatCount(turnContext.outputTokens)} />
            <Metric label="Total used" value={formatCount(turnContext.tokensUsed)} accent />
            <Metric label="Cost" value={formatCost(turnContext.costUsd)} />
            <Metric label="Model" value={turnContext.model ?? '--'} truncate />
            <Metric label="Provider" value={turnContext.provider ?? '--'} truncate />
          </div>
        ) : (
          <EmptyHint>No turn measured yet. Send a message to see the budget.</EmptyHint>
        )}
      </Section>
    </div>
  );
};
