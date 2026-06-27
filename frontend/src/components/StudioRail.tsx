import React from 'react';
import { X, Gauge, GitBranch, FileCode2, Brain } from 'lucide-react';

export type StudioTab = 'context' | 'tree' | 'memory';

interface StudioRailProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: StudioTab;
  onTabChange: (t: StudioTab) => void;
  /** Filled-in tab bodies. The Context panel is owned here; Tree/Memory reuse
   *  the existing app components (interim) until their own workflows land. */
  contextPanel: React.ReactNode;
  treePanel: React.ReactNode;
  memoryPanel: React.ReactNode;
  /** Optional count affordances rendered next to the tab labels. */
  treeCount?: number;
  memoryCount?: number;
}

interface TabDef {
  id: StudioTab;
  label: string;
  icon: React.ElementType;
  count?: number;
}

const TabButton: React.FC<{
  tab: TabDef;
  active: boolean;
  onSelect: () => void;
}> = ({ tab, active, onSelect }) => {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`relative flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-bath-400 ${
        active ? 'text-primary' : 'text-bath-400 hover:text-bath-200'
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{tab.label}</span>
      {tab.count != null && tab.count > 0 && (
        <span
          className={`font-mono text-[9px] tabular-nums px-1 py-px rounded ${
            active ? 'bg-primary/15 text-primary' : 'bg-white/5 text-bath-500'
          }`}
        >
          {tab.count}
        </span>
      )}
      {/* Active underline — the torchlit amber fill of the live instrument. */}
      <span
        className={`absolute bottom-0 left-2 right-2 h-px transition-all duration-300 ${
          active ? 'bg-primary/80 shadow-[0_0_8px_rgba(212,165,116,0.5)]' : 'bg-transparent'
        }`}
      />
    </button>
  );
};

export const StudioRail: React.FC<StudioRailProps> = ({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  contextPanel,
  treePanel,
  memoryPanel,
  treeCount,
  memoryCount,
}) => {
  const tabs: TabDef[] = [
    { id: 'context', label: 'Context', icon: FileCode2 },
    { id: 'tree', label: 'Tree', icon: GitBranch, count: treeCount },
    { id: 'memory', label: 'Memory', icon: Brain, count: memoryCount },
  ];

  const activePanel =
    activeTab === 'context' ? contextPanel : activeTab === 'tree' ? treePanel : memoryPanel;

  return (
    <>
      {/* Backdrop — dim the chat surface so the rail reads as a power mode.
          Click to dismiss; desktop only (mobile is a full-screen overlay). */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[38] bg-black/40 backdrop-blur-sm hidden md:block"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Studio"
        className={`absolute top-0 right-0 h-full z-40 w-full md:w-[400px]
          glass-panel border-l border-glass-border
          transition-transform duration-500 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]
          flex flex-col
          ${
            isOpen
              ? 'translate-x-0 shadow-[-10px_0_40px_rgba(0,0,0,0.5)]'
              : 'translate-x-full pointer-events-none'
          }`}
      >
        {/* Header — display-font title over a mono engine-room subtitle. */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-bath-700/25 bg-black/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <Gauge size={18} className="text-primary/90" />
            <div className="leading-none">
              <h2 className="font-display text-xl text-bath-100 tracking-wide">Studio</h2>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-bath-500 mt-1">
                Engine room
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-bath-400 hover:text-bath-100 hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-bath-400"
            aria-label="Close Studio"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div role="tablist" aria-label="Studio sections" className="flex border-b border-bath-700/25 bg-black/10 shrink-0">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={activeTab === tab.id}
              onSelect={() => onTabChange(tab.id)}
            />
          ))}
        </div>

        {/* Panel content — cross-faded on tab change (keyed remount). */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <div key={activeTab} className="animate-message-in" role="tabpanel">
            {activePanel}
          </div>
        </div>
      </aside>
    </>
  );
};

export default StudioRail;
