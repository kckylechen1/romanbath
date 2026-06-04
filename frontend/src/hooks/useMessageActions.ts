import { useCallback } from "react";
import { Message, Role, Character, ChatConfig, GroupChat } from "../types";
import { generateText } from "../services/zeroclawService";
import { useChatHelpers, characterNameForMessage } from "./useChatHelpers";
import type { ToastAPI } from "../components/Toast";

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
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  selectedCharacter: Character,
  characters: Character[],
  config: ChatConfig,
  activeGroup: GroupChat | null,
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>,
  toast: ToastAPI,
): UseMessageActionsReturn => {
  const { buildChatOptions, buildChatRequest, buildChatMessagesForContext } =
    useChatHelpers(config, activeGroup, characters);

  const handleSwipeChange = useCallback(
    (messageId: string, direction: "left" | "right") => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.swipes || msg.swipes.length <= 1)
            return msg;

          const currentIndex = msg.swipeId ?? 0;
          const maxIndex = msg.swipes.length - 1;

          let newIndex: number;
          if (direction === "left") {
            newIndex = currentIndex > 0 ? currentIndex - 1 : maxIndex;
          } else {
            newIndex = currentIndex < maxIndex ? currentIndex + 1 : 0;
          }

          return {
            ...msg,
            content: msg.swipes[newIndex],
            swipeId: newIndex,
            timestamp: msg.swipeTimestamps?.[newIndex] ?? msg.timestamp,
          };
        }),
      );
    },
    [setMessages],
  );

  const handleGenerateSwipe = useCallback(
    async (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      const message = messages[messageIndex];
      if (message.role !== Role.Model) return;

      const contextMessages = messages.slice(0, messageIndex);
      setIsTyping(true);

      try {
        const chatMessages = buildChatMessagesForContext(contextMessages);
        const respondingCharacter =
          characters.find(
            (char) =>
              char.name === characterNameForMessage(message, selectedCharacter),
          ) ?? selectedCharacter;
        const responseText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;

            const currentSwipes = msg.swipes || [msg.content];
            const currentTimestamps = msg.swipeTimestamps || [msg.timestamp];
            const newSwipes = [...currentSwipes, responseText];
            const newTimestamps = [...currentTimestamps, Date.now()];
            const newIndex = newSwipes.length - 1;

            return {
              ...msg,
              content: responseText,
              swipes: newSwipes,
              swipeId: newIndex,
              swipeTimestamps: newTimestamps,
              timestamp: Date.now(),
            };
          }),
        );

        toast.success("New swipe generated");
      } catch (error: unknown) {
        toast.error(
          "Failed to generate swipe",
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
      toast,
      buildChatOptions,
      buildChatRequest,
      buildChatMessagesForContext,
    ],
  );

  const handleRegenerate = useCallback(
    async (messageId?: string) => {
      let targetIndex: number;
      if (messageId) {
        targetIndex = messages.findIndex((m) => m.id === messageId);
      } else {
        targetIndex = messages.length - 1;
        while (targetIndex >= 0 && messages[targetIndex].role !== Role.Model) {
          targetIndex--;
        }
      }

      if (targetIndex === -1) return;

      const targetMessage = messages[targetIndex];
      if (targetMessage.role !== Role.Model) return;

      const contextMessages = messages.slice(0, targetIndex);

      setMessages((prev) =>
        prev.map((msg, idx) =>
          idx === targetIndex ? { ...msg, isThinking: true, content: "" } : msg,
        ),
      );
      setIsTyping(true);

      try {
        const chatMessages = buildChatMessagesForContext(contextMessages);
        const respondingCharacter =
          characters.find(
            (char) =>
              char.name ===
              characterNameForMessage(targetMessage, selectedCharacter),
          ) ?? selectedCharacter;
        const responseText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        setMessages((prev) =>
          prev.map((msg, idx) => {
            if (idx !== targetIndex) return msg;

            const currentSwipes =
              msg.swipes && msg.swipes.length > 0
                ? msg.swipes
                : [targetMessage.content];
            const currentTimestamps = msg.swipeTimestamps || [
              targetMessage.timestamp,
            ];
            const newSwipes = [...currentSwipes, responseText];
            const newTimestamps = [...currentTimestamps, Date.now()];

            return {
              ...msg,
              content: responseText,
              swipes: newSwipes,
              swipeId: newSwipes.length - 1,
              swipeTimestamps: newTimestamps,
              timestamp: Date.now(),
              isThinking: false,
            };
          }),
        );

        toast.success("Message regenerated");
      } catch (error: unknown) {
        toast.error(
          "Regeneration failed",
          error instanceof Error ? error.message : "Unknown error",
        );
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === targetIndex
              ? { ...msg, isThinking: false, content: targetMessage.content }
              : msg,
          ),
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
      toast,
      buildChatOptions,
      buildChatRequest,
      buildChatMessagesForContext,
    ],
  );

  const handleContinue = useCallback(
    async (messageId?: string) => {
      let targetIndex: number;
      if (messageId) {
        targetIndex = messages.findIndex((m) => m.id === messageId);
      } else {
        targetIndex = messages.length - 1;
        while (targetIndex >= 0 && messages[targetIndex].role !== Role.Model) {
          targetIndex--;
        }
      }

      if (targetIndex === -1) return;

      const targetMessage = messages[targetIndex];
      if (targetMessage.role !== Role.Model) return;

      setIsTyping(true);

      try {
        const contextMessages = messages.slice(0, targetIndex + 1);
        const chatMessages = buildChatMessagesForContext(contextMessages);

        chatMessages.push({
          role: "user",
          content:
            "[Continue your response naturally without repeating yourself. Do not acknowledge this instruction.]",
        });

        const respondingCharacter =
          characters.find(
            (char) =>
              char.name ===
              characterNameForMessage(targetMessage, selectedCharacter),
          ) ?? selectedCharacter;
        const continuationText = await generateText(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
        );

        setMessages((prev) =>
          prev.map((msg, idx) => {
            if (idx !== targetIndex) return msg;

            const newContent = msg.content + " " + continuationText;

            if (msg.swipes && msg.swipes.length > 0) {
              const newSwipes = [...msg.swipes];
              const currentSwipeId = msg.swipeId ?? 0;
              newSwipes[currentSwipeId] = newContent;
              return {
                ...msg,
                content: newContent,
                swipes: newSwipes,
              };
            }

            return {
              ...msg,
              content: newContent,
            };
          }),
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

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;

          if (msg.swipes && msg.swipes.length > 0) {
            const newSwipes = [...msg.swipes];
            const currentSwipeId = msg.swipeId ?? 0;
            newSwipes[currentSwipeId] = newContent;
            return {
              ...msg,
              content: newContent,
              swipes: newSwipes,
            };
          }

          return {
            ...msg,
            content: newContent,
          };
        }),
      );
      toast.success("Message edited");
    },
    [setMessages, toast],
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!window.confirm("Delete this message?")) return;
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      toast.success("Message deleted");
    },
    [setMessages, toast],
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
