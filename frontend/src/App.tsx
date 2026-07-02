import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle, Sparkles, Clock, X, Upload } from 'lucide-react';
import { LanguageProvider } from './i18n';
import { getTimeSinceLastChat } from './services/chatPersistenceService';
import { Role } from './types';
import { AFFECT_CONFIDENCE_FLOOR } from './utils/affect';
import { appFeatures } from './config/features';

// Hooks
import { useAppLogic } from './hooks/useAppLogic';
import { useEscapeKey } from './hooks/useEscapeKey';
import { useCharacterImportDrop } from './hooks/useCharacterImportDrop';

// Components
import { LeftSidebar } from './components/layout/LeftSidebar';
import { ChatHeader } from './components/chat/ChatHeader';
import { ChatInput } from './components/chat/ChatInput';
import { CharacterAvatar } from './components/CharacterAvatar';
import CharacterList from './components/CharacterList';
import MessageBubble from './components/MessageBubble';
import SettingsPanel from './components/SettingsPanel';
import CharacterEditor from './components/CharacterEditor';
import CommandPalette from './components/CommandPalette';
import { useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import DialogHost from './components/DialogHost';
import GreetingPicker from './components/chat/GreetingPicker';

// Command palette
import { buildCommands } from './commands/buildCommands';

const AffectReadout = React.lazy(() => import('./components/AffectReadout'));
const GroupChatManager = React.lazy(() => import('./components/GroupChatManager'));
const ImageGenModal = React.lazy(() => import('./components/ImageGenModal'));
const MemoryControls = React.lazy(() => import('./components/studio/MemoryControls'));
const StudioRail = React.lazy(() => import('./components/StudioRail'));
const ContextInspector = React.lazy(() =>
  import('./components/studio/ContextInspector').then((module) => ({
    default: module.ContextInspector,
  }))
);
const ConversationTree = React.lazy(() => import('./components/studio/ConversationTree'));

// Map a perceived affect state to the avatar's mood-glow color. Valence sets
// the hue (warm amber when positive → cool verdigris when negative), arousal
// sets how vivid it is. Null/neutral keeps the resting warm gold so the glow
// only departs from baseline when there's a real, confident signal.
const DEFAULT_GLOW = 'rgba(212, 165, 116, 0.4)';
const affectToGlowColor = (
  affect: { valence: number; arousal: number; confidence: number } | null
): string => {
  if (!affect || affect.confidence < AFFECT_CONFIDENCE_FLOOR) return DEFAULT_GLOW;
  const v = Math.max(-1, Math.min(1, affect.valence));
  // Hue: ~40° (warm amber) at v=+1 → ~165° (verdigris) at v=-1.
  const hue = 40 + (1 - (v + 1) / 2) * (165 - 40);
  const alpha = 0.3 + Math.max(0, Math.min(1, affect.arousal)) * 0.4;
  return `hsla(${Math.round(hue)}, 55%, 60%, ${alpha.toFixed(2)})`;
};

const AppContent: React.FC = () => {
  const logic = useAppLogic();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Avatar tap opens the labeled Studio Memory tab (not an unlabeled modal).
  const openMemoryStudio = () => {
    if (!appFeatures.studio) return;
    logic.setRightSidebarOpen(false);
    logic.setStudioTab('memory');
    logic.setStudioOpen(true);
  };

  const commands = useMemo(() => buildCommands(logic, { features: appFeatures }), [logic]);

  // UX-6: the conversation is "still at its opening greeting" when there is a
  // single Model message and no user turns yet. Alternate greetings are a
  // single-character (companion) affordance — never surface them in group chat.
  const atOpeningGreeting =
    !logic.activeGroup &&
    logic.selectedCharacter.id !== 'default' &&
    logic.activePath.length === 1 &&
    logic.activePath[0]?.role === Role.Model;

  // Swap the displayed opening greeting client-side. Guarded so it only ever
  // touches a lone Model greeting (never an in-progress conversation). Mirrors
  // useChatPersistence, which stores firstMessage raw (no macro expansion), so
  // alternates render identically to the default greeting.
  const setMessages = logic.setMessages;
  const replaceOpeningGreeting = useCallback(
    (content: string) => {
      setMessages((prev) => {
        if (prev.length !== 1) return prev;
        const only = prev[0];
        if (only.role !== Role.Model) return prev;
        if (only.content === content) return prev;
        return [{ ...only, content }];
      });
    },
    [setMessages]
  );

  // Studio and Settings share the right edge — opening one closes the other so
  // they never stack awkwardly (mirrors the app's single-right-panel layout).
  const toggleStudio = (): void => {
    if (!appFeatures.studio) return;
    const opening = !logic.studioOpen;
    logic.setStudioOpen(opening);
    if (opening) logic.setRightSidebarOpen(false);
  };

  // Global hotkeys: ⌘K command palette, ⌘\ toggle left sidebar, ⌘. toggle
  // settings, ⌘J toggle Studio. These fire even when an input has focus, so we
  // only match the bare mod+key chord — bailing on Shift/Alt keeps us clear of
  // the browser's own Ctrl+Shift+J (Chrome console) / Ctrl+Shift+K (Firefox
  // console) devtools bindings.
  useEffect(() => {
    const isMod = (e: KeyboardEvent): boolean => e.metaKey || e.ctrlKey;
    const onKey = (e: KeyboardEvent): void => {
      if (!isMod(e) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (key === '\\') {
        e.preventDefault();
        logic.setLeftSidebarOpen(!logic.leftSidebarOpen);
      } else if (key === '.') {
        e.preventDefault();
        logic.setRightSidebarOpen(!logic.rightSidebarOpen);
        if (!logic.rightSidebarOpen) logic.setStudioOpen(false);
      } else if (appFeatures.studio && key === 'j') {
        e.preventDefault();
        const opening = !logic.studioOpen;
        logic.setStudioOpen(opening);
        if (opening) logic.setRightSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [logic]);

  // Escape key handlers for modals and sidebars
  useEscapeKey(() => logic.setMobileMenuOpen(false), logic.mobileMenuOpen);
  useEscapeKey(() => logic.setMobileSettingsOpen(false), logic.mobileSettingsOpen);
  useEscapeKey(() => logic.setRightSidebarOpen(false), logic.rightSidebarOpen);
  useEscapeKey(() => logic.setStudioOpen(false), appFeatures.studio && logic.studioOpen);
  useEscapeKey(
    () => logic.setShowGroupManager(false),
    appFeatures.groupChat && logic.showGroupManager
  );
  useEscapeKey(
    () => logic.setShowImageGen(false),
    appFeatures.imageGeneration && logic.showImageGen
  );
  useEscapeKey(() => logic.setShowCharacterEditor(false), logic.showCharacterEditor);
  useEscapeKey(logic.handleStartFresh, logic.showRestorePrompt);

  const { isDragging, rootHandlers: dropHandlers } = useCharacterImportDrop({
    onImported: (name) => {
      logic.refreshCharacters();
      toast.success('Character imported', name);
    },
    onError: (message) => {
      toast.error('Import failed', message);
    },
  });

  return (
    <div
      className="relative w-full h-screen overflow-hidden font-sans text-bath-100 bg-bath-950 selection:bg-bath-500/20 selection:text-white"
      style={{ fontSize: `${logic.config.fontSize}px` }}
      onDragOver={dropHandlers.onDragOver}
      onDragLeave={dropHandlers.onDragLeave}
      onDrop={dropHandlers.onDrop}
    >
      {/* Background Layer */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-1000 ease-in-out"
        style={{
          backgroundImage: `url(${logic.selectedCharacter.backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.2,
          filter: `blur(${logic.config.backgroundBlur}px)`,
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-bath-950/60 via-bath-950/75 to-bath-950/95 pointer-events-none" />
      <div className="absolute inset-0 z-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay"></div>

      {/* Restore Chat Modal */}
      {logic.showRestorePrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-bath-950/95 backdrop-blur-2xl border border-bath-800/30 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center border border-bath-500/30">
                <MessageCircle className="text-bath-400" size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{logic.t('chat.restore')}</h2>
                <p className="text-sm text-bath-400 mt-0.5">{logic.t('chat.restorePrompt')}</p>
              </div>
            </div>

            <div className="bg-black/30 rounded-xl p-4 mb-6 border border-bath-700/15">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center">
                  <Sparkles className="text-bath-400" size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">
                    {logic.t('chat.restoreWith')} {logic.savedChatCharacterName}
                  </p>
                  <p className="text-xs text-bath-500 flex items-center gap-1 mt-0.5">
                    <Clock size={12} />
                    {logic.t('chat.lastActive')} {getTimeSinceLastChat()}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={logic.handleStartFresh}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-bath-400 hover:text-bath-100 bg-white/5 hover:bg-bath-800/30 border border-bath-700/15 hover:border-bath-600/20 transition-all"
              >
                {logic.t('chat.startFresh')}
              </button>
              <button
                onClick={logic.handleRestoreChat}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-bath-600 to-bath-700 hover:from-bath-500 hover:to-bath-600 shadow-lg shadow-bath-900/50 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {logic.t('chat.continue')} →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="relative z-10 flex h-full">
        {/* Left Sidebar */}
        <LeftSidebar
          leftSidebarOpen={logic.leftSidebarOpen}
          setLeftSidebarOpen={logic.setLeftSidebarOpen}
          characters={logic.characters}
          selectedCharacterId={logic.selectedCharacter.id}
          setSelectedCharacter={logic.setSelectedCharacter}
          refreshCharacters={logic.refreshCharacters}
          handleEditCharacter={logic.handleEditCharacter}
          handleCreateCharacter={logic.handleCreateCharacter}
        />

        {/* Mobile Sidebar */}
        {logic.mobileMenuOpen && (
          <div className="absolute inset-0 z-50 bg-[#090b0e]/98 backdrop-blur-2xl md:hidden flex flex-col animate-in fade-in slide-in-from-left-10 duration-200">
            <div className="p-4 flex justify-between items-center border-b border-bath-700/15">
              <span className="font-bold text-lg text-bath-100">Select Persona</span>
              <button
                onClick={() => logic.setMobileMenuOpen(false)}
                className="text-bath-400"
                aria-label="Close menu"
              >
                <X />
              </button>
            </div>
            <CharacterList
              characters={logic.characters}
              selectedId={logic.selectedCharacter.id}
              onSelect={logic.setSelectedCharacter}
              isCollapsed={false}
              onCharacterImported={logic.refreshCharacters}
              onEditCharacter={logic.handleEditCharacter}
              onCreateCharacter={logic.handleCreateCharacter}
              filter={logic.characterFilter}
              onFilterChange={logic.setCharacterFilter}
            />
          </div>
        )}

        {/* Center Chat Area */}
        <main className="flex-1 flex flex-col h-full min-w-0 relative z-20">
          <ChatHeader
            selectedCharacter={logic.selectedCharacter}
            language={logic.language}
            setLanguage={logic.setLanguage}
            config={logic.config}
            setMobileMenuOpen={logic.setMobileMenuOpen}
            showMoreMenu={logic.showMoreMenu}
            setShowMoreMenu={logic.setShowMoreMenu}
            startNewChat={logic.startNewChat}
            setShowImageGen={logic.setShowImageGen}
            showBookmarks={logic.showBookmarks}
            setShowBookmarks={logic.setShowBookmarks}
            bookmarks={logic.bookmarks}
            showChatHistory={logic.showChatHistory}
            setShowChatHistory={logic.setShowChatHistory}
            chatHistory={logic.chatHistory}
            currentChatFileName={logic.currentChatFileName}
            setCurrentChatFileName={logic.setCurrentChatFileName}
            setMessages={logic.setMessages}
            activeGroup={logic.activeGroup}
            setShowGroupManager={logic.setShowGroupManager}
            handleExitGroup={logic.handleExitGroup}
            handleCreateBookmark={logic.handleCreateBookmark}
            handleRestoreBookmark={logic.handleRestoreBookmark}
            handleDeleteBookmark={logic.handleDeleteBookmark}
            isSavingChat={logic.isSavingChat}
            clearChat={logic.clearChat}
            rightSidebarOpen={logic.rightSidebarOpen}
            setRightSidebarOpen={(open) => {
              logic.setRightSidebarOpen(open);
              if (open) logic.setStudioOpen(false);
            }}
            setMobileSettingsOpen={logic.setMobileSettingsOpen}
            studioOpen={logic.studioOpen}
            onToggleStudio={toggleStudio}
            features={appFeatures}
            messages={logic.messages}
            messageTree={logic.messageTree}
            activeLeafId={logic.activeLeafId}
            setActiveLeafId={logic.setActiveLeafId}
          />

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth custom-scrollbar bath-reveal bath-reveal-delay-3">
            {/* Character Presence */}
            {logic.selectedCharacter.id !== 'default' && (
              <>
                <div className="flex flex-col items-center pt-8 pb-4 bath-reveal bath-reveal-delay-2">
                  <button
                    className={`relative group ${
                      appFeatures.studio ? 'cursor-pointer' : 'cursor-default'
                    }`}
                    onClick={openMemoryStudio}
                    aria-label={appFeatures.studio ? 'Open memories' : undefined}
                    disabled={!appFeatures.studio}
                  >
                    <div
                      className="affect-glow avatar-breathe rounded-full transition-all duration-1000"
                      style={
                        {
                          '--affect-color': affectToGlowColor(
                            appFeatures.affect ? logic.currentAffect : null
                          ),
                        } as React.CSSProperties
                      }
                    >
                      <CharacterAvatar
                        name={logic.selectedCharacter.name}
                        avatar={logic.selectedCharacter.avatar}
                        size="xl"
                        rounded="full"
                        ringClassName="ring-bath-500/30"
                      />
                    </div>
                  </button>
                  <h2 className="mt-3 text-lg font-display text-bath-100 tracking-wide">
                    {logic.selectedCharacter.name}
                  </h2>
                  <p className="text-xs text-bath-500/70 mt-1 font-sans">
                    {logic.selectedCharacter.description?.slice(0, 80)}
                    {(logic.selectedCharacter.description?.length ?? 0) > 80 ? '…' : ''}
                  </p>
                  {appFeatures.affect && (
                    <React.Suspense fallback={null}>
                      <AffectReadout affect={logic.currentAffect} />
                    </React.Suspense>
                  )}
                </div>
              </>
            )}

            <div className="max-w-2xl mx-auto">
              {logic.activePath.map((msg, idx) => {
                const siblings = (
                  logic.messageTree.childrenOf.get(msg.parentId ?? null) ?? []
                ).filter((m) => m.role === msg.role);
                const branchIndex = siblings.findIndex((m) => m.id === msg.id);
                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    character={logic.selectedCharacter}
                    userName={logic.config.userName}
                    ttsConfig={appFeatures.tts ? logic.config.tts : undefined}
                    branchCount={siblings.length}
                    branchIndex={branchIndex >= 0 ? branchIndex : 0}
                    onSwipeChange={logic.handleSwipeChange}
                    onGenerateSwipe={logic.handleGenerateSwipe}
                    onRegenerate={logic.handleRegenerate}
                    onContinue={logic.handleContinue}
                    onEdit={logic.handleEditMessage}
                    onDelete={logic.handleDeleteMessage}
                    onGenerateImage={
                      appFeatures.imageGeneration ? logic.handleGenerateImage : undefined
                    }
                    isLastMessage={idx === logic.activePath.length - 1}
                    isGenerating={logic.isTyping}
                  />
                );
              })}
              {atOpeningGreeting && logic.activePath[0] && (
                <GreetingPicker
                  character={logic.selectedCharacter}
                  currentContent={logic.activePath[0].content}
                  onSelect={replaceOpeningGreeting}
                />
              )}
              <div ref={logic.chatEndRef} className="h-4" />
            </div>
          </div>

          {/* Input */}
          <ChatInput
            inputText={logic.inputText}
            setInputText={logic.setInputText}
            selectedCharacterName={logic.selectedCharacter.name}
            leftSidebarOpen={logic.leftSidebarOpen}
            isListening={logic.isListening}
            toggleVoiceInput={logic.toggleVoiceInput}
            voiceInputEnabled={appFeatures.voiceInput}
            isTyping={logic.isTyping}
            handleSendMessage={logic.handleSendMessage}
            handleKeyDown={logic.handleKeyDown}
            isComposingRef={logic.isComposingRef}
          />
        </main>

        {/* Right Sidebar (Settings) */}
        {logic.rightSidebarOpen && (
          <div
            className="fixed inset-0 z-[35] bg-black/40 backdrop-blur-sm hidden md:block"
            onClick={() => logic.setRightSidebarOpen(false)}
          />
        )}
        <div
          className={`
            absolute top-0 right-0 h-full z-40
            w-[600px]
            transition-transform duration-500 cubic-bezier(0.25, 1, 0.5, 1)
            ${logic.rightSidebarOpen ? 'translate-x-0 shadow-[-10px_0_40px_rgba(0,0,0,0.5)]' : 'translate-x-full'}
            hidden md:block
        `}
        >
          <SettingsPanel
            config={logic.config}
            onConfigChange={logic.handleConfigChange}
            isOpen={true}
            onClose={() => logic.setRightSidebarOpen(false)}
          />
        </div>

        {/* Mobile Settings Drawer */}
        {logic.mobileSettingsOpen && (
          <>
            <div
              className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => logic.setMobileSettingsOpen(false)}
            />
            <div className="absolute inset-0 z-50 md:hidden animate-in fade-in slide-in-from-right-10 duration-200">
              <SettingsPanel
                config={logic.config}
                onConfigChange={logic.handleConfigChange}
                isOpen={true}
                onClose={() => logic.setMobileSettingsOpen(false)}
              />
            </div>
          </>
        )}

        {/* Right-rail Studio (Context / Tree / Memory inspector). Shares the
            right edge with Settings; the toggle handlers keep them exclusive. */}
        {appFeatures.studio && (
          <React.Suspense fallback={null}>
            <StudioRail
              isOpen={logic.studioOpen}
              onClose={() => logic.setStudioOpen(false)}
              activeTab={logic.studioTab}
              onTabChange={logic.setStudioTab}
              treeCount={
                logic.messages.filter((m) => !(m.childrenIds && m.childrenIds.length > 0)).length
              }
              contextPanel={
                <ContextInspector
                  systemPrompt={logic.systemPrompt}
                  turnContext={logic.turnContext}
                />
              }
              treePanel={
                <ConversationTree
                  messages={logic.messages}
                  activeLeafId={logic.activeLeafId}
                  onSelectLeaf={logic.setActiveLeafId}
                  characterId={logic.selectedCharacter.id}
                  chatFileName={logic.currentChatFileName}
                />
              }
              memoryPanel={<MemoryControls characterName={logic.selectedCharacter.name} />}
            />
          </React.Suspense>
        )}
      </div>

      {/* Group Chat Manager Modal */}
      {appFeatures.groupChat && (
        <React.Suspense fallback={null}>
          <GroupChatManager
            characters={logic.characters}
            onSelectGroup={logic.handleSelectGroup}
            selectedGroupId={logic.activeGroup?.id}
            isOpen={logic.showGroupManager}
            onClose={() => logic.setShowGroupManager(false)}
          />
        </React.Suspense>
      )}

      {/* Image Generation Modal */}
      {appFeatures.imageGeneration && (
        <React.Suspense fallback={null}>
          <ImageGenModal
            isOpen={logic.showImageGen}
            onClose={() => {
              logic.setShowImageGen(false);
              logic.setImageGenPrompt(undefined);
            }}
            initialPrompt={logic.imageGenPrompt}
            characterAppearance={logic.selectedCharacter?.description}
          />
        </React.Suspense>
      )}

      {/* Character Editor Modal */}
      <CharacterEditor
        isOpen={logic.showCharacterEditor}
        characterId={logic.editingCharacterId}
        onSave={logic.handleSaveCharacter}
        onDelete={logic.editingCharacterId ? logic.handleDeleteCharacter : undefined}
        onClose={() => logic.setShowCharacterEditor(false)}
      />

      {/* Toast Notifications */}
      <toast.ToastContainer />

      {/* Imperative confirm/prompt/alert dialogs (replaces window.*) */}
      <DialogHost />

      {/* Cmd+K command palette */}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}

      {/* Drag-and-drop character import overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-10 rounded-3xl border-2 border-dashed border-bath-500/60 bg-bath-900/60">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center border border-bath-500/40">
              <Upload className="text-bath-300" size={36} />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white">Drop character card to import</p>
              <p className="text-sm text-bath-400 mt-1">Supports PNG, JSON, WebP</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </LanguageProvider>
  );
};

export default App;
