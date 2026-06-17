import { useCallback } from "react";
import { Message, Role, Character, ChatConfig, GroupChat } from "../types";
import { generateText } from "../services/zeroclawService";
import { useChatHelpers, characterNameForMessage } from "./useChatHelpers";
import type { ToastAPI } from "../components/Toast";
import { confirm as confirmDialog } from "../services/dialogService";
import { pathToRoot, indexMessages, deepestLeaf } from "./useMessageTree";
import { generateId } from "../utils/id";

export interface UseMessageActionsReturn {
  handleSwipeChange: (messageId: string, direction: "left" | "right") => void;
  handleGenerateSwipe: (messageId: string) => Promise<void>;
  handleRegenerate: (messageId?: string) => Promise<void>;
  handleContinue: (messageId?: string) => Promise<void>;
  handleEditMessage: (messageId: string, newContent: string) => void;
  handleDeleteMessage: (messageId: string) => void;
}

export const useMessageActions = (
  messages: Message[],
  activePath: Message[],
  activeLeafId: string | null,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setActiveLeafId: React.Dispatch<React.SetStateAction<string | null>>,
  selectedCharacter: Character,
  characters: Character[],
  config: ChatConfig,
  activeGroup: GroupChat | null,
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>,
  toast: ToastAPI,
): UseMessageActionsReturn => {
  const { buildChatOptions, buildChatRequest, buildChatMessagesForContext } =
    useChatHelpers(config, activeGroup, characters);

  // Append `child` to `messages`, recording the back-reference on the
  // parent so childrenIds stays consistent without re-indexing the world.
  const appendChild = useCallback(
    (parent: Message | null, child: Message): void => {
      setMessages((prev) => {
        const next = [...prev, { ...child, parentId: parent?.id ?? null }];
        if (parent) {
          const parentIdx = next.findIndex((m) => m.id === parent.id);
          if (parentIdx >= 0) {
            const updated = { ...next[parentIdx] };
            updated.childrenIds = [...(updated.childrenIds ?? []), child.id];
            next[parentIdx] = updated;
          }
        }
        return next;
      });
    },
    [setMessages],
  );

  // handleSwipeChange now navigates siblings in the tree. We pick the
  // prev/next sibling under the same parent, then walk down to whatever
  // leaf that sibling currently resolves to and make it the active tip.
  // The name is kept for backwards-compatibility with the message toolbar.
  const handleSwipeChange = useCallback(
    (messageId: string, direction: "left" | "right") => {
      const target = messages.find((m) => m.id === messageId);
      if (!target) return;

      const siblings = messages
        .filter((m) => (m.parentId ?? null) === (target.parentId ?? null) && m.role === target.role)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (siblings.length <= 1) return;

      const currentIdx = siblings.findIndex((m) => m.id === messageId);
      const nextIdx =
        direction === "left"
          ? (currentIdx - 1 + siblings.length) % siblings.length
          : (currentIdx + 1) % siblings.length;
      const nextSibling = siblings[nextIdx];

      const tree = indexMessages(messages);
      const newLeaf = deepestLeaf(tree, nextSibling.id);
      setActiveLeafId(newLeaf.id);
    },
    [messages, setActiveLeafId],
  );

  const handleGenerateSwipe = useCallback(
    async (messageId: string) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target || target.role !== Role.Model) return;

      const parent = target.parentId ? messages.find((m) => m.id === target.parentId) ?? null : null;
      const contextMessages = pathToRoot(indexMessages(messages), target.parentId ?? null);

      setIsTyping(true);

      const placeholderId = generateId();
      appendChild(parent, {
        id: placeholderId,
        role: Role.Model,
        content: "",
        timestamp: Date.now(),
        isThinking: true,
        childrenIds: [],
        extra: target.extra,
      } as Message);
      setActiveLeafId(placeholderId);

      try {
        const chatMessages = buildChatMessagesForContext(contextMessages);
        const respondingCharacter =
          characters.find(
            (char) => char.name === characterNameForMessage(target, selectedCharacter),
          ) ?? selectedCharacter;
        const responseText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === placeholderId
              ? { ...msg, content: responseText, isThinking: false, timestamp: Date.now() }
              : msg,
          ),
        );
        toast.success("New branch generated");
      } catch (error: unknown) {
        // Roll back the placeholder branch so a failed generation doesn't
        // leave a dangling thinking bubble on the active path.
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
        setActiveLeafId(target.id);
        toast.error(
          "Failed to generate branch",
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setIsTyping(false);
      }
    },
    [
      messages,
      characters,
      selectedCharacter,
      setIsTyping,
      setMessages,
      setActiveLeafId,
      appendChild,
      toast,
      buildChatOptions,
      buildChatRequest,
      buildChatMessagesForContext,
    ],
  );

  const handleRegenerate = useCallback(
    async (messageId?: string) => {
      // Resolve the target. With no id, default to the last assistant
      // message on the active path.
      let target: Message | undefined;
      if (messageId) {
        target = messages.find((m) => m.id === messageId);
      } else {
        for (let i = activePath.length - 1; i >= 0; i -= 1) {
          if (activePath[i].role === Role.Model) {
            target = activePath[i];
            break;
          }
        }
      }
      if (!target || target.role !== Role.Model) return;

      const parent = target.parentId ? messages.find((m) => m.id === target.parentId) ?? null : null;
      const contextMessages = pathToRoot(indexMessages(messages), target.parentId ?? null);

      const placeholderId = generateId();
      const previousLeafId = activeLeafId;

      setIsTyping(true);
      appendChild(parent, {
        id: placeholderId,
        role: Role.Model,
        content: "",
        timestamp: Date.now(),
        isThinking: true,
        childrenIds: [],
        extra: target.extra,
      } as Message);
      setActiveLeafId(placeholderId);

      try {
        const chatMessages = buildChatMessagesForContext(contextMessages);
        const respondingCharacter =
          characters.find(
            (char) => char.name === characterNameForMessage(target, selectedCharacter),
          ) ?? selectedCharacter;
        const responseText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === placeholderId
              ? { ...msg, content: responseText, isThinking: false, timestamp: Date.now() }
              : msg,
          ),
        );
        toast.success("Branch regenerated");
      } catch (error: unknown) {
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
        setActiveLeafId(previousLeafId);
        toast.error(
          "Regeneration failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setIsTyping(false);
      }
    },
    [
      messages,
      activePath,
      activeLeafId,
      characters,
      selectedCharacter,
      setIsTyping,
      setMessages,
      setActiveLeafId,
      appendChild,
      toast,
      buildChatOptions,
      buildChatRequest,
      buildChatMessagesForContext,
    ],
  );

  const handleContinue = useCallback(
    async (messageId?: string) => {
      let target: Message | undefined;
      if (messageId) {
        target = messages.find((m) => m.id === messageId);
      } else {
        for (let i = activePath.length - 1; i >= 0; i -= 1) {
          if (activePath[i].role === Role.Model) {
            target = activePath[i];
            break;
          }
        }
      }
      if (!target || target.role !== Role.Model) return;

      const targetId = target.id;
      const targetIndex = activePath.findIndex((m) => m.id === targetId);
      if (targetIndex === -1) return;

      setIsTyping(true);

      try {
        const contextMessages = activePath.slice(0, targetIndex + 1);
        const chatMessages = buildChatMessagesForContext(contextMessages);
        chatMessages.push({
          role: "user",
          content:
            "[Continue your response naturally without repeating yourself. Do not acknowledge this instruction.]",
        });

        const respondingCharacter =
          characters.find(
            (char) => char.name === characterNameForMessage(target, selectedCharacter),
          ) ?? selectedCharacter;
        const continuationText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        // Continue appends to the active branch's content in place. This
        // is intentionally not a new branch — extending a half-finished
        // answer is a correction, not an exploration.
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === targetId
              ? { ...msg, content: `${msg.content} ${continuationText}` }
              : msg,
          ),
        );
        toast.success("Message continued");
      } catch (error: unknown) {
        toast.error(
          "Continue failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setIsTyping(false);
      }
    },
    [
      messages,
      activePath,
      characters,
      selectedCharacter,
      setIsTyping,
      setMessages,
      toast,
      buildChatOptions,
      buildChatRequest,
      buildChatMessagesForContext,
    ],
  );

  // Edit stays in-place for MVP. The user uses edit to fix typos, not to
  // fork the conversation — that's what regenerate is for. We can promote
  // this to branch-on-edit later if the UX calls for it.
  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content: newContent } : msg)),
      );
      toast.success("Message edited");
    },
    [setMessages, toast],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      const ok = await confirmDialog({
        title: "Delete message?",
        message: "This message and any branches below it will be removed from the conversation.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;

      // Removing a node also removes every descendant branch. We compute
      // the descendant set with a BFS so a single setMessages pass
      // cleans them all.
      const childrenOf = new Map<string, string[]>();
      for (const msg of messages) {
        const parent = msg.parentId ?? "";
        const list = childrenOf.get(parent) ?? [];
        list.push(msg.id);
        childrenOf.set(parent, list);
      }

      const toRemove = new Set<string>([messageId]);
      const queue = [messageId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const childId of childrenOf.get(cur) ?? []) {
          if (!toRemove.has(childId)) {
            toRemove.add(childId);
            queue.push(childId);
          }
        }
      }

      const target = messages.find((m) => m.id === messageId);
      const targetParentId = target?.parentId ?? null;

      setMessages((prev) => {
        const next = prev.filter((m) => !toRemove.has(m.id));
        // Patch the parent's childrenIds so the deleted branch doesn't
        // leave a dangling reference.
        if (targetParentId) {
          const parentIdx = next.findIndex((m) => m.id === targetParentId);
          if (parentIdx >= 0) {
            const parent = { ...next[parentIdx] };
            parent.childrenIds = (parent.childrenIds ?? []).filter((id) => !toRemove.has(id));
            next[parentIdx] = parent;
          }
        }
        return next;
      });

      // If the active leaf was inside the deleted subtree, fall back to
      // the target's parent (or its nearest surviving sibling). The
      // activeLeafId effect in useAppLogic will further recover if this
      // still points at a removed node.
      if (activeLeafId && toRemove.has(activeLeafId)) {
        setActiveLeafId(targetParentId);
      }
      toast.success("Message deleted");
    },
    [messages, activeLeafId, setMessages, setActiveLeafId, toast],
  );

  return {
    handleSwipeChange,
    handleGenerateSwipe,
    handleRegenerate,
    handleContinue,
    handleEditMessage,
    handleDeleteMessage,
  };
};
