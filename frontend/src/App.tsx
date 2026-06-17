import React from "react";
import { MessageCircle, Sparkles, Clock, X } from "lucide-react";
import { LanguageProvider } from "./i18n";
import { getTimeSinceLastChat } from "./services/chatPersistenceService";

// Hooks
import { useAppLogic } from "./hooks/useAppLogic";
import { useEscapeKey } from "./hooks/useEscapeKey";

// Components
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { ChatHeader } from "./components/chat/ChatHeader";
import { ChatInput } from "./components/chat/ChatInput";
import CharacterList from "./components/CharacterList";
import MessageBubble from "./components/MessageBubble";
import SettingsPanel from "./components/SettingsPanel";
import GroupChatManager from "./components/GroupChatManager";
import ImageGenModal from "./components/ImageGenModal";
import CharacterEditor from "./components/CharacterEditor";
import { useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import DialogHost from "./components/DialogHost";

const AppContent: React.FC = () => {
  const logic = useAppLogic();
  const toast = useToast();

  // Escape key handlers for modals and sidebars
  useEscapeKey(() => logic.setMobileMenuOpen(false), logic.mobileMenuOpen);
  useEscapeKey(() => logic.setMobileSettingsOpen(false), logic.mobileSettingsOpen);
  useEscapeKey(() => logic.setRightSidebarOpen(false), logic.rightSidebarOpen);
  useEscapeKey(() => logic.setShowGroupManager(false), logic.showGroupManager);
  useEscapeKey(() => logic.setShowImageGen(false), logic.showImageGen);
  useEscapeKey(() => logic.setShowCharacterEditor(false), logic.showCharacterEditor);
  useEscapeKey(logic.handleStartFresh, logic.showRestorePrompt);

  return (
    <div
      className="relative w-full h-screen overflow-hidden font-sans text-stone-200 bg-black selection:bg-bath-500/20 selection:text-white"
      style={{ fontSize: `${logic.config.fontSize}px` }}
    >
      {/* Background Layer */}
      <div
        className="absolute inset-0 z-0 transition-opacity duration-1000 ease-in-out"
        style={{
          backgroundImage: `url(${logic.selectedCharacter.backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.2,
          filter: `blur(${logic.config.backgroundBlur}px)`,
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#090b0e]/70 via-[#0e1217]/90 to-[#090b0e] pointer-events-none" />
      <div className="absolute inset-0 z-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay"></div>

      {/* Restore Chat Modal */}
      {logic.showRestorePrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div role="dialog" aria-modal="true" className="bg-[#0e1217]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center border border-bath-500/30">
                <MessageCircle className="text-stone-400" size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {logic.t("chat.restore")}
                </h2>
                <p className="text-sm text-stone-400 mt-0.5">
                  {logic.t("chat.restorePrompt")}
                </p>
              </div>
            </div>

            <div className="bg-black/30 rounded-xl p-4 mb-6 border border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center">
                  <Sparkles className="text-bath-400" size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">
                    {logic.t("chat.restoreWith")} {logic.savedChatCharacterName}
                  </p>
                  <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                    <Clock size={12} />
                    {logic.t("chat.lastActive")} {getTimeSinceLastChat()}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={logic.handleStartFresh}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-stone-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all"
              >
                {logic.t("chat.startFresh")}
              </button>
              <button
                onClick={logic.handleRestoreChat}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-bath-600 to-bath-700 hover:from-bath-500 hover:to-bath-600 shadow-lg shadow-bath-900/50 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {logic.t("chat.continue")} →
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
            <div className="p-4 flex justify-between items-center border-b border-white/5">
              <span className="font-bold text-lg text-stone-100">
                Select Persona
              </span>
              <button
                onClick={() => logic.setMobileMenuOpen(false)}
                className="text-stone-400"
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
            setRightSidebarOpen={logic.setRightSidebarOpen}
            setMobileSettingsOpen={logic.setMobileSettingsOpen}
          />

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth custom-scrollbar bath-reveal bath-reveal-delay-3" style={{ contain: "layout" }}>
            <div
              className={`max-w-4xl mx-auto transition-transform ${logic.leftSidebarOpen ? "" : "md:-translate-x-10"}`}
            >
              {logic.messages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  character={logic.selectedCharacter}
                  userName={logic.config.userName}
                  ttsConfig={logic.config.tts}
                  onSwipeChange={logic.handleSwipeChange}
                  onGenerateSwipe={logic.handleGenerateSwipe}
                  onRegenerate={logic.handleRegenerate}
                  onContinue={logic.handleContinue}
                  onEdit={logic.handleEditMessage}
                  onDelete={logic.handleDeleteMessage}
                  onGenerateImage={logic.handleGenerateImage}
                  isLastMessage={idx === logic.messages.length - 1}
                  isGenerating={logic.isTyping}
                />
              ))}
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
            ${logic.rightSidebarOpen ? "translate-x-0 shadow-[-10px_0_40px_rgba(0,0,0,0.5)]" : "translate-x-full"}
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
      </div>

      {/* Group Chat Manager Modal */}
      <GroupChatManager
        characters={logic.characters}
        onSelectGroup={logic.handleSelectGroup}
        selectedGroupId={logic.activeGroup?.id}
        isOpen={logic.showGroupManager}
        onClose={() => logic.setShowGroupManager(false)}
      />

      {/* Image Generation Modal */}
      <ImageGenModal
        isOpen={logic.showImageGen}
        onClose={() => { logic.setShowImageGen(false); logic.setImageGenPrompt(undefined); }}
        initialPrompt={logic.imageGenPrompt}
        characterAppearance={logic.selectedCharacter?.description}
      />

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
