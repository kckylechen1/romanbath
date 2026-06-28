import { useState, useRef, useCallback, useEffect } from 'react';
import type React from 'react';
import { Character, Message, Role, ChatConfig, GroupChat, GroupMessage } from '../types';
import {
  generateTextStream,
  WsChatConnection,
  getCharacterDetails,
  type AffectState,
  type WsChatCallbacks,
  type WsSendIds,
  type TurnContext,
  type WsHistoryNode,
} from '../services/zeroclawService';
import { selectNextCharacter, updateGroupChat } from '../services/groupChatService';
import { getTombstones, addTombstones } from '../services/tombstoneStore';
import { useChatHelpers } from './useChatHelpers';
import { mergeServerNodes, shouldAdoptServerLeaf } from './useMessageTree';
import { generateId } from '../utils/id';
import type { ToastAPI } from '../components/Toast';
import { expandMacros, type MacroContext } from '../services/macroService';
import { appFeatures } from '../config/features';

export interface UseChatGenerationReturn {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  isTyping: boolean;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  handleSendMessage: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: React.MutableRefObject<boolean>;
  wsChatRef: React.MutableRefObject<WsChatConnection | null>;
  /** Latest perceived affect (drives the avatar mood glow); null = neutral. */
  currentAffect: AffectState | null;
  /** Regenerate/generate-swipe over the WS pipeline: reuse the target's user
   *  node and grow a server-synced alternate assistant sibling. Resolves true
   *  if handled, false to decline (no user node) so the caller falls back to
   *  the REST branch helper. Companion (WS) path only. */
  regenerateAssistant: (target: Message) => Promise<boolean>;
  /** Persist deleted node ids (the delete handler + broadcast reconciler call
   *  this) so a later hydration never resurrects them. */
  recordTombstones: (ids: string[]) => void;
  /** Resolved system prompt for the current session (Studio inspector). Set on
   *  connect via the context_meta frame; null until a companion chat connects. */
  systemPrompt: string | null;
  /** Last turn's recalled memories + token/cost accounting (Studio inspector).
   *  Set on each done frame; null before the first turn / after a chat switch. */
  turnContext: TurnContext | null;
}

export const useChatGeneration = (
  characters: Character[],
  selectedCharacter: Character,
  activeGroup: GroupChat | null,
  config: ChatConfig,
  messages: Message[],
  activePath: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setActiveLeafId: React.Dispatch<React.SetStateAction<string | null>>,
  toast: ToastAPI,
  t: (key: string) => string,
  currentChatFileName: string | null,
  setActiveGroup: React.Dispatch<React.SetStateAction<GroupChat | null>>
): UseChatGenerationReturn => {
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentAffect, setCurrentAffect] = useState<AffectState | null>(null);
  // Studio inspector state: the resolved system prompt (from the connect-time
  // context_meta frame) and the latest turn's recalled-memory + token/cost
  // accounting (from each done frame). Both reset on chat switch below so stale
  // context never bleeds across conversations.
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [turnContext, setTurnContext] = useState<TurnContext | null>(null);
  // Chats already reconciled with the server snapshot this session (keyed by
  // character+chat), so the per-message connection's repeated snapshots merge
  // only once — see onHistory.
  const hydratedChatsRef = useRef<Set<string>>(new Set());
  // Ids the user deleted in THIS chat, loaded from IndexedDB on entry. Passed
  // to mergeServerNodes so a delete that didn't reach the server can't be
  // resurrected by a later hydration (survives reload). See tombstoneStore.
  const tombstonesRef = useRef<Set<string>>(new Set());
  const tombstoneLoadRef = useRef<Promise<void>>(Promise.resolve());
  const tombstoneLoadSeqRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const wsChatRef = useRef<WsChatConnection | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Mirror `messages` into a ref so handleSendMessage can capture the
  // pre-mutation snapshot for the outgoing request body without depending
  // on `messages` itself. Keeping `messages` out of the useCallback deps
  // stops the callback (and therefore handleKeyDown) from rebuilding on
  // every streaming token — which previously cost the textarea its focus.
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Affect is per-conversation; drop it when switching character so a new
  // companion doesn't inherit the previous one's mood glow.
  useEffect(() => {
    setCurrentAffect(null);
  }, [selectedCharacter.id]);

  // Same trick for activePath — used both for the outgoing context body
  // (only the rendered branch should go to the model, not sibling
  // branches) and for assigning parentId on the new messages.
  const activePathRef = useRef<Message[]>(activePath);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  // Reconcile a server-broadcast in-place edit. Idempotent with the optimistic
  // local edit: if the content already matches (this device's own echo) it's a
  // referential no-op so React bails out.
  const applyNodeEdited = useCallback(
    (msgId: string, content: string) => {
      setMessages((prev) => {
        const target = prev.find((m) => m.id === msgId);
        if (!target || target.content === content) return prev;
        return prev.map((m) => (m.id === msgId ? { ...m, content } : m));
      });
    },
    [setMessages]
  );

  // Reconcile a server-broadcast subtree delete. Idempotent with the optimistic
  // local delete: if none of the removed ids are present (this device already
  // deleted them) it's a no-op. childrenIds are patched so a deleted branch
  // doesn't leave a phantom leaf in BranchMiniMap. The activeLeafId effect in
  // useAppLogic recovers the active branch if it pointed into the deleted set.
  // Remember deleted ids (in-memory ref + persisted) so a later hydration never
  // resurrects them. Called by the local delete handler and by the broadcast
  // reconciler below.
  const recordTombstones = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      for (const id of ids) tombstonesRef.current.add(id);
      void addTombstones(selectedCharacter.id, currentChatFileName ?? 'default', ids);
    },
    [selectedCharacter.id, currentChatFileName]
  );

  const applyNodeDeleted = useCallback(
    (msgId: string, removed: string[]) => {
      const toRemove = new Set<string>(removed.length > 0 ? removed : [msgId]);
      if (msgId) toRemove.add(msgId);
      // A delete broadcast (this device's echo or another device) is also a
      // tombstone: persist it so a future reload doesn't resurrect the subtree.
      recordTombstones([...toRemove]);
      setMessages((prev) => {
        if (!prev.some((m) => toRemove.has(m.id))) return prev;
        return prev
          .filter((m) => !toRemove.has(m.id))
          .map((m) => ({
            ...m,
            childrenIds: (m.childrenIds ?? []).filter((id) => !toRemove.has(id)),
          }));
      });
    },
    [setMessages, recordTombstones]
  );

  const { buildChatOptions, buildChatRequest, buildChatMessagesForContext } = useChatHelpers(
    config,
    activeGroup,
    characters
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Close WS chat and abort pending REST requests when the conversation
  // changes (character OR chat thread) — the persistent socket is bound to one
  // (character, chat) session, so a switch must drop it; the next send opens a
  // fresh one for the new session.
  useEffect(() => {
    wsChatRef.current?.close();
    wsChatRef.current = null;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = null;
    // Re-hydrate from the server on (re)entry: clear the once-per-chat gate so
    // switching away and back — or reconnecting — reconciles with the server
    // tree again instead of trusting a possibly-stale local snapshot.
    hydratedChatsRef.current.clear();
    // Drop the previous conversation's resolved prompt + turn accounting so the
    // Studio inspector doesn't show stale context while the new session connects.
    setSystemPrompt(null);
    setTurnContext(null);
    // Load this chat's tombstones before any history_snapshot merge is allowed
    // to run. The server sends history_snapshot before the connect ack, so the
    // merge path awaits tombstoneLoadRef instead of racing IndexedDB.
    const loadSeq = tombstoneLoadSeqRef.current + 1;
    tombstoneLoadSeqRef.current = loadSeq;
    tombstonesRef.current = new Set();
    tombstoneLoadRef.current = getTombstones(selectedCharacter.id, currentChatFileName ?? 'default')
      .then((ids) => {
        if (tombstoneLoadSeqRef.current === loadSeq) {
          tombstonesRef.current = new Set(ids);
        }
      })
      .catch(() => {
        if (tombstoneLoadSeqRef.current === loadSeq) {
          tombstonesRef.current = new Set();
        }
      });
    return () => {
      if (tombstoneLoadSeqRef.current === loadSeq) {
        tombstoneLoadSeqRef.current += 1;
      }
    };
  }, [selectedCharacter.id, currentChatFileName]);

  const hydrateHistoryOnce = useCallback(
    (chatKey: string, nodes: WsHistoryNode[], activeLeaf?: string | null, adoptLeaf = false) => {
      if (nodes.length === 0) return;
      const loadSeq = tombstoneLoadSeqRef.current;
      void tombstoneLoadRef.current.then(() => {
        if (tombstoneLoadSeqRef.current !== loadSeq) return;
        if (hydratedChatsRef.current.has(chatKey)) return;
        hydratedChatsRef.current.add(chatKey);
        setMessages((prev) => {
          const merged = mergeServerNodes(prev, nodes, tombstonesRef.current);
          if (adoptLeaf) {
            const localIds = new Set(prev.map((m) => m.id));
            const mergedIds = new Set(merged.map((m) => m.id));
            if (shouldAdoptServerLeaf(localIds, mergedIds, activeLeaf)) {
              setActiveLeafId(activeLeaf);
            }
          }
          return merged;
        });
      });
    },
    [setMessages, setActiveLeafId]
  );

  // Connect-on-load: open the persistent socket when a chat WITH HISTORY is
  // selected — not just on first send — so the server tree is hydrated and the
  // active branch adopted up front (the thin-client "load → view server state"
  // path). Gated to chats that already have local history: a brand-new chat has
  // nothing to hydrate, and connecting fresh would emit the first_mes greeting,
  // which no-op hydration callbacks would swallow — so fresh chats keep being
  // opened lazily by the first send (greeting intact). The send path reuses this
  // socket (session match) and rebinds the real turn callbacks.
  useEffect(() => {
    if (selectedCharacter.id === 'default' || activeGroup || !currentChatFileName) return;
    if (messagesRef.current.length === 0) return; // fresh chat → lazy connect on send
    const sessionId = `companion:${selectedCharacter.id}:${currentChatFileName}`;
    if (wsChatRef.current?.isConnected && wsChatRef.current.session === sessionId) return;
    const chatKey = `${selectedCharacter.id}:${currentChatFileName}`;
    let cancelled = false;
    const ws = new WsChatConnection({
      onChunk: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onDone: () => {},
      onError: () => {},
      onAffect: (affect) => setCurrentAffect(affect),
      onHistory: (nodes, activeLeaf) => {
        // X3 (re-enabled in inc 3b): adopt the server's active_leaf on FIRST
        // hydration. Regenerate/swipe/delete are now server-synced (alternate
        // turns + delete frames), so the server's active_leaf is no longer
        // stale relative to local branches.
        // SAFETY: only adopt a leaf that EXISTS in the post-merge local tree.
        // A locally-deleted node the server still has (e.g. a delete sent while
        // offline) is not resurrected by mergeServerNodes here beyond the union,
        // and we never point the active branch at a node absent from the merged
        // tree — so X3 can't yank the user into a vanished subtree.
        hydrateHistoryOnce(chatKey, nodes, activeLeaf, true);
      },
      onNodeEdited: applyNodeEdited,
      onNodeDeleted: applyNodeDeleted,
      onContextMeta: (prompt) => setSystemPrompt(prompt),
      onTurnContext: (ctx) => setTurnContext(ctx),
    });
    ws.connect(
      selectedCharacter.name,
      'play',
      config.userName || undefined,
      undefined,
      sessionId,
      config.userDescription || undefined
    )
      .then(() => {
        // If a fast first send already opened a socket for this session, don't
        // leak a second one — keep the send's socket, drop the load socket.
        if (cancelled || wsChatRef.current?.isConnected) ws.close();
        else wsChatRef.current = ws;
      })
      .catch(() => ws.close());
    return () => {
      cancelled = true;
    };
  }, [
    selectedCharacter.id,
    selectedCharacter.name,
    currentChatFileName,
    activeGroup,
    config.userName,
    config.userDescription,
    setMessages,
    setActiveLeafId,
    applyNodeEdited,
    applyNodeDeleted,
    hydrateHistoryOnce,
  ]);

  // Shared per-turn WS callbacks: stream chunks/tools into the assistant
  // placeholder `botMsgId`, settle on done/error, and reconcile server
  // broadcasts. Used by BOTH the normal send and the alternate (regenerate/
  // swipe) turn so the streaming/placeholder/done machinery lives in one place.
  // NOTE: onHistory here MERGES but does NOT adopt active_leaf — during a live
  // turn the user is on the freshly-grown branch; adopting the server leaf would
  // yank them off it. active_leaf adoption (X3) happens only on connect-on-load.
  const buildTurnCallbacks = useCallback(
    (botMsgId: string): WsChatCallbacks => ({
      onChunk: (_chunk: string, fullText: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? { ...msg, content: fullText, isThinking: false } : msg
          )
        );
      },
      onToolCall: (toolName: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId
              ? {
                  ...msg,
                  toolCalls: [...(msg.toolCalls || []), { toolName, status: 'running' as const }],
                }
              : msg
          )
        );
      },
      onToolResult: (
        toolName: string,
        output: string,
        mediaUrl?: string,
        mediaType?: 'image' | 'audio' | 'video'
      ) => {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== botMsgId) return msg;
            const calls = [...(msg.toolCalls || [])];
            const idx = calls.findIndex(
              (tc) => tc.toolName === toolName && tc.status === 'running'
            );
            if (idx !== -1) {
              calls[idx] = { ...calls[idx], status: 'done' as const, output, mediaUrl, mediaType };
            }
            return { ...msg, toolCalls: calls, isThinking: false };
          })
        );
      },
      onDone: (fullText: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? { ...msg, content: fullText, isThinking: false } : msg
          )
        );
        setIsTyping(false);
      },
      onError: (error: string) => {
        console.error('WS chat error:', error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? { ...msg, content: `⚠️ ${error}`, isThinking: false } : msg
          )
        );
        setIsTyping(false);
      },
      onAffect: (affect) => setCurrentAffect(affect),
      onHistory: (nodes) => {
        // Reconcile with the server-authoritative tree ONCE per chat
        // (cross-device / fresh client). Union by id keeps local nodes.
        const chatKey = `${selectedCharacter.id}:${currentChatFileName ?? 'default'}`;
        hydrateHistoryOnce(chatKey, nodes);
      },
      onNodeEdited: applyNodeEdited,
      onNodeDeleted: applyNodeDeleted,
      onContextMeta: (prompt) => setSystemPrompt(prompt),
      onTurnContext: (ctx) => setTurnContext(ctx),
    }),
    [
      setMessages,
      setIsTyping,
      setCurrentAffect,
      selectedCharacter.id,
      currentChatFileName,
      applyNodeEdited,
      applyNodeDeleted,
      hydrateHistoryOnce,
    ]
  );

  // Connect-or-reuse the persistent (character, chat) socket, then send. The
  // gateway's WS loop handles many turns per connection, so an established
  // socket for THIS session is reused (rebind this turn's callbacks); otherwise
  // a stale/absent one is replaced. Shared by the normal send and the alternate
  // (regenerate/swipe) turn so the connection lifecycle lives in one place.
  const connectOrReuseAndSend = useCallback(
    async (content: string, sendIds: WsSendIds, callbacks: WsChatCallbacks): Promise<void> => {
      const sessionId = `companion:${selectedCharacter.id}:${currentChatFileName ?? 'default'}`;
      const existing = wsChatRef.current;
      if (existing?.isConnected && existing.session === sessionId) {
        existing.rebindCallbacks(callbacks);
        existing.send(content, sendIds);
      } else {
        existing?.close();
        const ws = new WsChatConnection(callbacks);
        await ws.connect(
          selectedCharacter.name,
          'play',
          config.userName || undefined,
          undefined,
          sessionId,
          config.userDescription || undefined
        );
        wsChatRef.current = ws;
        ws.send(content, sendIds);
      }
    },
    [
      selectedCharacter.id,
      selectedCharacter.name,
      currentChatFileName,
      config.userName,
      config.userDescription,
    ]
  );

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || isTyping) return;

    // Capture the pre-mutation snapshot. The bot placeholder added below
    // must NOT end up in the request body — sending an empty assistant
    // turn confuses the model. Using the ref also means `messages` no
    // longer needs to be in the dependency array.
    const priorPath = activePathRef.current;
    const parentForUser = priorPath.length > 0 ? priorPath[priorPath.length - 1].id : null;

    let respondingCharacter = selectedCharacter;
    if (activeGroup) {
      const nextChar = selectNextCharacter(activeGroup, characters, inputText);
      if (nextChar) {
        respondingCharacter = nextChar;
        // Persist AND sync the in-memory group, or selectNextCharacter keeps
        // reading the stale lastActiveCharacterId next turn and round-robin
        // returns the same speaker forever.
        const updated = updateGroupChat(activeGroup.id, {
          lastActiveCharacterId: nextChar.id,
        });
        if (updated) setActiveGroup(updated);
      }
    }

    if (characters.length === 0 || !characters.some((c) => c.name === respondingCharacter.name)) {
      toast.error(
        `角色「${respondingCharacter.name}」不在 ZeroClaw 后端。请从左侧选择已导入的角色。`
      );
      return;
    }

    // Expand ST macros client-side before the message hits either stored
    // history or the outgoing request body. Storing the expanded form is
    // intentional: regenerates/swipes must see the same text the model saw
    // on the original turn, and re-rolling {{random}} on every regenerate
    // would otherwise produce inconsistent context.
    const macroCtx: MacroContext = {
      userName: config.userName,
      characterName: respondingCharacter.name,
      personaDescription: config.userDescription,
    };
    const expandedInput = expandMacros(inputText, macroCtx);

    const userMsg: Message = {
      id: generateId(),
      role: Role.User,
      content: expandedInput,
      timestamp: Date.now(),
      parentId: parentForUser,
      childrenIds: [],
    };

    setMessages((prev) => {
      const next = [...prev, userMsg];
      // Patch the parent's childrenIds so the in-memory tree matches what
      // linkLinearTree would rebuild on next load. Without this, the parent
      // still looks like a leaf until reload and shows up as a spurious dot
      // in BranchMiniMap.
      if (parentForUser) {
        const parentIdx = next.findIndex((m) => m.id === parentForUser);
        if (parentIdx >= 0) {
          const parent = { ...next[parentIdx] };
          parent.childrenIds = [...(parent.childrenIds ?? []), userMsg.id];
          next[parentIdx] = parent;
        }
      }
      return next;
    });
    setInputText('');
    setIsTyping(true);

    const botMsgId = generateId();

    setMessages((prev) => {
      const next = [
        ...prev,
        {
          id: botMsgId,
          role: Role.Model,
          content: '',
          timestamp: Date.now(),
          isThinking: true,
          parentId: userMsg.id,
          childrenIds: [],
          extra: activeGroup
            ? {
                characterId: respondingCharacter.id,
                characterName: respondingCharacter.name,
              }
            : undefined,
        } as GroupMessage,
      ];
      // Record the bot as a child of the user message we just appended, for
      // the same reason as the parent patch above.
      const userIdx = next.findIndex((m) => m.id === userMsg.id);
      if (userIdx >= 0) {
        const user = { ...next[userIdx] };
        user.childrenIds = [...(user.childrenIds ?? []), botMsgId];
        next[userIdx] = user;
      }
      return next;
    });

    // New tip becomes the active leaf so the chat surface renders the
    // branch we just grew.
    setActiveLeafId(botMsgId);

    const useWs = !activeGroup && respondingCharacter.name !== 'Assistant';
    let usedWs = false;

    try {
      if (appFeatures.imageGeneration) {
        const { buildCharacterPhotoPrompt, generateImage, isPhotoRequest } =
          await import('../services/imageGenService');
        if (isPhotoRequest(expandedInput)) {
          const toolName = 'xai_image_gen';
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMsgId
                ? {
                    ...msg,
                    isThinking: false,
                    toolCalls: [{ toolName, status: 'running' }],
                  }
                : msg
            )
          );

          const details = await getCharacterDetails(respondingCharacter.name);
          const prompt = buildCharacterPhotoPrompt(expandedInput, respondingCharacter, details);
          const result = await generateImage({ prompt, resolution: '1k' });

          if (!result.success || !result.image_data_url) {
            throw new Error(result.error || 'Image generation failed');
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMsgId
                ? {
                    ...msg,
                    content: '',
                    isThinking: false,
                    toolCalls: [
                      {
                        toolName,
                        status: 'done',
                        output: JSON.stringify({ prompt }),
                        mediaUrl: result.image_data_url,
                        mediaType: 'image',
                      },
                    ],
                  }
                : msg
            )
          );
          return;
        }
      }

      if (useWs) {
        try {
          // Client-minted node ids so the server stores the same tree the client
          // renders: this user turn (userMsg.id under parentForUser) + the
          // assistant placeholder (botMsgId). Per-turn callbacks close over THIS
          // turn's botMsgId; connectOrReuseAndSend rebinds them on a reused
          // socket or installs them on a fresh one.
          const sendIds: WsSendIds = {
            msgId: userMsg.id,
            parentId: parentForUser,
            assistantMsgId: botMsgId,
          };
          await connectOrReuseAndSend(expandedInput, sendIds, buildTurnCallbacks(botMsgId));
          usedWs = true;
        } catch (wsErr) {
          console.warn('WebSocket chat unavailable for character, falling back to REST:', wsErr);
          wsChatRef.current?.close();
          wsChatRef.current = null;
        }
      }

      if (!usedWs) {
        abortCtrlRef.current?.abort();
        abortCtrlRef.current = new AbortController();

        const chatMessages = buildChatMessagesForContext(
          [...priorPath, userMsg],
          respondingCharacter.name
        );

        await generateTextStream(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
          (_chunk: string, fullText: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, content: fullText, isThinking: false } : msg
              )
            );
          },
          (fullText: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, content: fullText, isThinking: false } : msg
              )
            );
          },
          (error: Error) => {
            throw error;
          },
          abortCtrlRef.current.signal
        );
      }
    } catch (error: unknown) {
      // Silently ignore abort errors (user switched character or stopped)
      if (error instanceof Error && error.name === 'AbortError') {
        setIsTyping(false);
        return;
      }
      console.error('Error generating response:', error);

      let errorTitle = t('error.generation') || 'Generation Failed';
      let errorMessage =
        (error instanceof Error ? error.message : String(error)) || 'Unknown error occurred';

      if (errorMessage.includes('API key')) {
        errorTitle = t('error.apiKey') || 'API Key Error';
        errorMessage = t('error.apiKeyMessage') || 'Please check your API key in settings.';
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorTitle = t('error.rateLimit') || 'Rate Limited';
        errorMessage = t('error.rateLimitMessage') || 'Too many requests. Please wait a moment.';
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        errorTitle = t('error.network') || 'Network Error';
        errorMessage = t('error.networkMessage') || 'Could not connect to the server.';
      } else if (errorMessage.includes('timeout')) {
        errorTitle = t('error.timeout') || 'Request Timeout';
        errorMessage = t('error.timeoutMessage') || 'The request took too long. Try again.';
      } else if (errorMessage.toLowerCase().includes('websocket')) {
        errorTitle = 'Connection issue';
        errorMessage = 'Retrying with standard connection...';
      }

      if (!errorMessage.includes('standard connection')) {
        toast.error(errorTitle, errorMessage);
      }

      const isTransportIssue = errorMessage.includes('standard connection');
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                ...msg,
                content: isTransportIssue ? '(Retrying...)' : `⚠️ ${errorTitle}: ${errorMessage}`,
                isThinking: false,
              }
            : msg
        )
      );
    } finally {
      // WS path clears isTyping in onDone/onError once the stream resolves.
      // REST path and error paths need it cleared here.
      if (!usedWs) {
        setIsTyping(false);
      }
    }
  }, [
    inputText,
    isTyping,
    selectedCharacter,
    activeGroup,
    characters,
    config,
    setMessages,
    setActiveLeafId,
    toast,
    t,
    buildChatOptions,
    buildChatRequest,
    buildChatMessagesForContext,
    setActiveGroup,
    buildTurnCallbacks,
    connectOrReuseAndSend,
  ]);

  // Regenerate / generate-swipe over the WS pipeline. `target` is an assistant
  // message; its parent is the user node U. We REUSE U (no new user bubble) and
  // grow a NEW assistant SIBLING under it as an alternate turn (alternate:true →
  // server reuses U + skips memory). Streams via the same machinery as a normal
  // send. The companion (WS) path only — group/Assistant regenerate stays REST.
  const regenerateAssistant = useCallback(
    async (target: Message): Promise<boolean> => {
      const all = messagesRef.current;
      const userNode = target.parentId ? (all.find((m) => m.id === target.parentId) ?? null) : null;
      // No user turn to reuse (e.g. the greeting / a root assistant) — nothing to
      // regenerate against on the server. Decline so the caller falls back to the
      // REST branch helper.
      if (!userNode || userNode.role !== Role.User) return false;

      const newBotId = generateId();
      setIsTyping(true);

      // Append the NEW assistant placeholder as a sibling under U and make it the
      // active tip, so the chat surface renders the branch we're growing.
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            id: newBotId,
            role: Role.Model,
            content: '',
            timestamp: Date.now(),
            isThinking: true,
            parentId: userNode.id,
            childrenIds: [],
            extra: target.extra,
          } as Message,
        ];
        const uIdx = next.findIndex((m) => m.id === userNode.id);
        if (uIdx >= 0) {
          const u = { ...next[uIdx] };
          u.childrenIds = [...(u.childrenIds ?? []), newBotId];
          next[uIdx] = u;
        }
        return next;
      });
      setActiveLeafId(newBotId);

      // Reuse U (msgId = U.id, parent = U.parentId, content = U.content) and add
      // a NEW assistant sibling (assistantMsgId), alternate:true.
      const sendIds: WsSendIds = {
        msgId: userNode.id,
        parentId: userNode.parentId ?? null,
        assistantMsgId: newBotId,
        alternate: true,
      };

      try {
        await connectOrReuseAndSend(userNode.content, sendIds, buildTurnCallbacks(newBotId));
      } catch (err) {
        // Connect failed: roll back the placeholder so a failed regenerate
        // doesn't strand a thinking bubble, and restore the prior tip. (Stream
        // errors after a successful send are shown in-bubble by onError.)
        console.error('Regenerate failed:', err);
        setMessages((prev) => prev.filter((m) => m.id !== newBotId));
        setActiveLeafId(target.id);
        setIsTyping(false);
        toast.error('Regeneration failed', err instanceof Error ? err.message : 'Unknown error');
      }
      // Handled (sent, or attempted-and-rolled-back) — don't double-attempt via
      // REST. A no-user-node decline returned false earlier.
      return true;
    },
    [setMessages, setActiveLeafId, setIsTyping, connectOrReuseAndSend, buildTurnCallbacks, toast]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      handleSendMessage();
    },
    [handleSendMessage]
  );

  return {
    inputText,
    setInputText,
    isTyping,
    setIsTyping,
    handleSendMessage,
    handleKeyDown,
    chatEndRef,
    isComposingRef,
    wsChatRef,
    currentAffect,
    regenerateAssistant,
    recordTombstones,
    systemPrompt,
    turnContext,
  };
};
