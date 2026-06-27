import React from 'react';
import { Character, ChatConfig, GroupChat, Message } from '../../types';
import { ChatBookmark } from '../../services/bookmarkService';
import { CharacterAvatar } from '../CharacterAvatar';
import { ChatInfo, loadChat, stripChatExtension } from '../../services/chatService';
import {
  Menu,
  Globe,
  EllipsisVertical,
  Plus,
  Sparkles,
  Bookmark,
  History,
  Users,
  X,
  Trash2,
  Settings as SettingsIcon,
  Gauge,
} from 'lucide-react';
import { useLanguage } from '../../i18n';
import type { MessageTree } from '../../hooks/useMessageTree';
import { BranchMiniMap } from './BranchMiniMap';

interface ChatHeaderProps {
  selectedCharacter: Character;
  language: string;
  setLanguage: (lang: 'en' | 'zh-CN' | 'zh-TW') => void;
  config: ChatConfig;
  setMobileMenuOpen: (open: boolean) => void;
  showMoreMenu: boolean;
  setShowMoreMenu: (show: boolean) => void;
  startNewChat: () => void;
  setShowImageGen: (show: boolean) => void;
  showBookmarks: boolean;
  setShowBookmarks: (show: boolean) => void;
  bookmarks: ChatBookmark[];
  showChatHistory: boolean;
  setShowChatHistory: (show: boolean) => void;
  chatHistory: ChatInfo[];
  currentChatFileName: string | null;
  setCurrentChatFileName: (name: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  activeGroup: GroupChat | null;
  setShowGroupManager: (show: boolean) => void;
  handleExitGroup: () => void;
  handleCreateBookmark: () => void;
  handleRestoreBookmark: (bookmark: ChatBookmark) => void;
  handleDeleteBookmark: (id: string, e: React.MouseEvent) => void;
  isSavingChat: boolean;
  clearChat: () => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  setMobileSettingsOpen: (open: boolean) => void;
  studioOpen: boolean;
  onToggleStudio: () => void;
  messages: Message[];
  messageTree: MessageTree;
  activeLeafId: string | null;
  setActiveLeafId: (id: string) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  selectedCharacter,
  language,
  setLanguage,
  setMobileMenuOpen,
  showMoreMenu,
  setShowMoreMenu,
  startNewChat,
  setShowImageGen,
  showBookmarks,
  setShowBookmarks,
  bookmarks,
  showChatHistory,
  setShowChatHistory,
  chatHistory,
  currentChatFileName,
  setCurrentChatFileName,
  setMessages,
  activeGroup,
  setShowGroupManager,
  handleExitGroup,
  handleCreateBookmark,
  handleRestoreBookmark,
  handleDeleteBookmark,
  isSavingChat,
  clearChat,
  rightSidebarOpen,
  setRightSidebarOpen,
  setMobileSettingsOpen,
  studioOpen,
  onToggleStudio,
  messages,
  messageTree,
  activeLeafId,
  setActiveLeafId,
}) => {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col border-b border-white/5 backdrop-blur-md z-20 bath-reveal bath-reveal-delay-2">
      <header className="h-16 flex items-center justify-between px-6 md:px-8">
        <div className="flex items-center gap-3 md:hidden">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="text-stone-400 p-2 hover:bg-white/5 rounded-lg"
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
          <CharacterAvatar
            name={selectedCharacter.name}
            avatar={selectedCharacter.avatar}
            size="sm"
            ringClassName="ring-white/10"
          />
          <span className="font-semibold text-lg text-stone-100">{selectedCharacter.name}</span>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <CharacterAvatar
            name={selectedCharacter.name}
            avatar={selectedCharacter.avatar}
            size="md"
            ringClassName="ring-bath-500/20"
          />
          <h1 className="text-xl font-bold text-stone-100 tracking-tight">
            {selectedCharacter.name}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <div className="relative group mr-2 hidden md:block">
            <button className="flex items-center gap-2 px-3 py-2 text-sm text-stone-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
              <Globe size={18} />
              <span className="uppercase text-xs font-bold tracking-wider">
                {language === 'zh-CN' ? 'CN' : language === 'zh-TW' ? 'TW' : 'EN'}
              </span>
            </button>
            <div className="absolute right-0 top-full pt-2 w-32 hidden group-hover:block animate-in fade-in slide-in-from-top-2 duration-200 z-50">
              <div className="bg-[#0d0b09] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                <button
                  onClick={() => setLanguage('en')}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                  English
                </button>
                <button
                  onClick={() => setLanguage('zh-CN')}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                  简体中文
                </button>
                <button
                  onClick={() => setLanguage('zh-TW')}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                  繁體中文
                </button>
              </div>
            </div>
          </div>

          {/* More Dropdown */}
          <div className="relative hidden md:block">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              aria-label="More options"
            >
              <EllipsisVertical size={18} />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-[#0d0b09] border border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="p-1">
                  <button
                    onClick={() => {
                      startNewChat();
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Plus size={16} />
                    <span>New Chat</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowImageGen(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Sparkles size={16} />
                    <span>Image</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowBookmarks(!showBookmarks);
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Bookmark size={16} />
                    <span>Bookmarks</span>
                    {bookmarks.length > 0 && (
                      <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-bath-500/20 text-bath-300 rounded-full">
                        {bookmarks.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowChatHistory(!showChatHistory);
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <History size={16} />
                    <span>Chat History</span>
                    {chatHistory.length > 0 && (
                      <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-bath-500/20 text-bath-300 rounded-full">
                        {chatHistory.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowGroupManager(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-stone-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Users size={16} />
                    <span>{activeGroup ? activeGroup.name : 'Groups'}</span>
                  </button>
                  {activeGroup && (
                    <button
                      onClick={() => {
                        handleExitGroup();
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <X size={16} />
                      <span>Exit Group</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Bookmarks Dropdown Panel */}
            {showBookmarks && (
              <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-[#0d0b09] border border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="p-3 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Bookmarks
                  </h3>
                  <button
                    onClick={handleCreateBookmark}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-bath-400 hover:text-bath-300 hover:bg-bath-500/10 rounded-lg transition-colors"
                  >
                    <Plus size={12} />
                    Save
                  </button>
                </div>
                {bookmarks.length === 0 ? (
                  <div className="p-4 text-center text-stone-500 text-sm">
                    No bookmarks yet. Create one to save your chat state.
                  </div>
                ) : (
                  <div className="p-1">
                    {bookmarks.map((bookmark) => (
                      <div
                        key={bookmark.id}
                        onClick={() => handleRestoreBookmark(bookmark)}
                        className="w-full text-left p-3 rounded-lg hover:bg-white/5 cursor-pointer group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-stone-200 truncate max-w-[200px]">
                            {bookmark.name}
                          </span>
                          <button
                            onClick={(e) => handleDeleteBookmark(bookmark.id, e)}
                            className="p-1 text-stone-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            aria-label="Delete bookmark"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-stone-500">
                            {bookmark.messageCount} messages
                          </span>
                          <span className="text-[10px] text-stone-600">•</span>
                          <span className="text-[10px] text-stone-500">
                            {new Date(bookmark.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {bookmark.previewText && (
                          <p className="text-xs text-stone-500 mt-1 truncate">
                            {bookmark.previewText}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Chat History Dropdown Panel */}
            {showChatHistory && (
              <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-[#0d0b09] border border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="p-2 border-b border-white/5">
                  <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-2">
                    Chat History
                  </h3>
                </div>
                {chatHistory.length === 0 ? (
                  <div className="p-4 text-center text-stone-500 text-sm">No previous chats</div>
                ) : (
                  <div className="p-1">
                    {chatHistory.map((chat, index) => (
                      <button
                        key={chat.file_name}
                        onClick={async () => {
                          const fileName = stripChatExtension(chat.file_name);
                          const { messages: loadedMessages } = await loadChat(
                            selectedCharacter.id,
                            fileName
                          );
                          if (loadedMessages.length > 0) {
                            setMessages(loadedMessages);
                            setCurrentChatFileName(fileName);
                          }
                          setShowChatHistory(false);
                        }}
                        className={`w-full text-left p-3 rounded-lg transition-colors ${
                          currentChatFileName === stripChatExtension(chat.file_name)
                            ? 'bg-bath-500/10 border border-bath-500/20'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-stone-200 truncate max-w-[200px]">
                            {chat.file_name.replace('.jsonl', '').split(' - ')[1] ||
                              `Chat ${index + 1}`}
                          </span>
                          <span className="text-[10px] text-stone-500">
                            {chat.message_count || chat.chat_items || 0} msgs
                          </span>
                        </div>
                        {chat.preview_message && (
                          <p className="text-xs text-stone-500 truncate mt-1">
                            {chat.preview_message}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Saving indicator */}
          {isSavingChat && (
            <div className="hidden md:flex items-center gap-1 px-2 py-1 text-xs text-stone-500">
              <div className="w-2 h-2 bg-bath-500 rounded-full animate-pulse"></div>
              Saving...
            </div>
          )}

          {/* Reset Button */}
          <button
            onClick={clearChat}
            className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/5 border border-transparent hover:border-red-500/10"
          >
            <Trash2 size={16} />
            <span>{t('app.reset')}</span>
          </button>
          <div className="w-px h-6 bg-white/5 mx-2 hidden md:block"></div>
          {/* Studio Button — the right-rail instrument panel (Cmd+J) */}
          <button
            onClick={onToggleStudio}
            className={`p-2.5 rounded-lg border transition-all duration-300 hidden md:flex items-center justify-center
                      ${studioOpen ? 'bg-bath-900/50 text-bath-200 border-bath-700/50 shadow-lg' : 'text-stone-500 border-white/5 hover:bg-white/5 hover:text-stone-100'}
                  `}
            aria-label="Studio"
            title="Studio (Cmd+J)"
          >
            <Gauge size={20} />
          </button>
          {/* Mobile Studio Button */}
          <button
            onClick={onToggleStudio}
            className="md:hidden p-2 text-stone-400 hover:text-stone-100"
            aria-label="Studio"
          >
            <Gauge size={20} />
          </button>
          {/* Settings Button */}
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className={`p-2.5 rounded-lg border transition-all duration-300 hidden md:flex items-center justify-center
                      ${rightSidebarOpen ? 'bg-bath-900/50 text-bath-200 border-bath-700/50 shadow-lg' : 'text-stone-500 border-white/5 hover:bg-white/5 hover:text-stone-100'}
                  `}
            aria-label="Settings"
          >
            <SettingsIcon size={20} />
          </button>
          {/* Mobile Settings Button */}
          <button
            onClick={() => setMobileSettingsOpen(true)}
            className="md:hidden p-2 text-stone-400 hover:text-stone-100"
            aria-label="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>
      <BranchMiniMap
        messages={messages}
        messageTree={messageTree}
        activeLeafId={activeLeafId}
        onSelectLeaf={setActiveLeafId}
      />
    </div>
  );
};
