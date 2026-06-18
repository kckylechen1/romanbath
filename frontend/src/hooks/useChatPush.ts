import { useEffect, useRef } from "react";
import type React from "react";
import { Message, Role, GroupMessage } from "../types";
import { ChatPushSubscriber, type ChatPushEvent } from "../services/zeroclawService";
import { generateId } from "../utils/id";

interface UseChatPushOptions {
  agentAlias: string;
  characterName: string | undefined;
  activeLeafId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveLeafId: React.Dispatch<React.SetStateAction<string | null>>;
  onPush?: (event: ChatPushEvent) => void;
}

/**
 * Subscribes to /api/chat/subscribe for server-initiated chat pushes
 * (cron-fired "always-on" messages, dreaming milestones, etc.) and
 * injects received pushes as new Model messages into the chat.
 *
 * The subscriber is scoped to the current character — switching
 * characters disconnects and reconnects with the new filter.
 *
 * Push messages get parentId = activeLeafId so they continue the
 * current conversation branch. They are indistinguishable from normal
 * model responses in the rendered chat — the user just sees "Ada
 * sent a message" without any "this was a push" badge (记忆无痕).
 */
export const useChatPush = ({
  agentAlias,
  characterName,
  activeLeafId,
  setMessages,
  setActiveLeafId,
  onPush,
}: UseChatPushOptions): void => {
  const subscriberRef = useRef<ChatPushSubscriber | null>(null);
  const activeLeafIdRef = useRef<string | null>(activeLeafId);

  // Keep the ref fresh so the push callback always sees the latest leaf.
  useEffect(() => {
    activeLeafIdRef.current = activeLeafId;
  }, [activeLeafId]);

  useEffect(() => {
    // Only subscribe when we have both an agent and a character.
    if (!agentAlias || !characterName) return;

    const subscriber = new ChatPushSubscriber(
      agentAlias,
      {
        onPush: (event: ChatPushEvent) => {
          const msgId = generateId();
          const parent = activeLeafIdRef.current;

          const pushMsg: Message = {
            id: msgId,
            role: Role.Model,
            content: event.content,
            timestamp: Date.now(),
            parentId: parent,
            childrenIds: [],
            extra: {
              characterName: event.character_name || characterName,
            },
          } as GroupMessage;

          setMessages((prev) => {
            const next = [...prev, pushMsg];
            // Patch parent's childrenIds if parent exists.
            if (parent) {
              const idx = next.findIndex((m) => m.id === parent);
              if (idx >= 0) {
                const p = { ...next[idx] };
                p.childrenIds = [...(p.childrenIds ?? []), msgId];
                next[idx] = p;
              }
            }
            return next;
          });
          setActiveLeafId(msgId);
          onPush?.(event);
        },
      },
      characterName,
    );

    subscriberRef.current = subscriber;
    subscriber.connect();

    return () => {
      subscriber.disconnect();
      subscriberRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAlias, characterName]);
};
