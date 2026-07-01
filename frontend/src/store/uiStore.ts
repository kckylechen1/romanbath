import { create } from 'zustand';

interface UIState {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  mobileMenuOpen: boolean;
  mobileSettingsOpen: boolean;
  showMoreMenu: boolean;
  showBookmarks: boolean;
  showGroupManager: boolean;
  showImageGen: boolean;
  imageGenPrompt: string | undefined;

  setLeftSidebarOpen: (v: boolean) => void;
  setRightSidebarOpen: (v: boolean) => void;
  setMobileMenuOpen: (v: boolean) => void;
  setMobileSettingsOpen: (v: boolean) => void;
  setShowMoreMenu: (v: boolean) => void;
  setShowBookmarks: (v: boolean) => void;
  setShowGroupManager: (v: boolean) => void;
  setShowImageGen: (v: boolean) => void;
  setImageGenPrompt: (v: string | undefined) => void;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  closeAllPanels: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: false,
  mobileMenuOpen: false,
  mobileSettingsOpen: false,
  showMoreMenu: false,
  showBookmarks: false,
  showGroupManager: false,
  showImageGen: false,
  imageGenPrompt: undefined,

  setLeftSidebarOpen: (v) => set({ leftSidebarOpen: v }),
  setRightSidebarOpen: (v) => set({ rightSidebarOpen: v }),
  setMobileMenuOpen: (v) => set({ mobileMenuOpen: v }),
  setMobileSettingsOpen: (v) => set({ mobileSettingsOpen: v }),
  setShowMoreMenu: (v) => set({ showMoreMenu: v }),
  setShowBookmarks: (v) => set({ showBookmarks: v }),
  setShowGroupManager: (v) => set({ showGroupManager: v }),
  setShowImageGen: (v) => set({ showImageGen: v }),
  setImageGenPrompt: (v) => set({ imageGenPrompt: v }),

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  closeAllPanels: () =>
    set({
      mobileMenuOpen: false,
      mobileSettingsOpen: false,
      rightSidebarOpen: false,
      showGroupManager: false,
      showImageGen: false,
    }),
}));
