import { useState, useRef, useCallback, useEffect } from 'react';
import type React from 'react';
import { Character, Message, Role, ChatConfig, GroupChat, GroupMessage } from '../types';
import {
  generateTextStream,
  WsChatConnection,
  getCharacterDetails,
  type AffectState,
} from '../services/zeroclawService';
import {
  buildCharacterPhotoPrompt,
  generateImage,
  isPhotoRequest,
} from '../services/imageGenService';
import { selectNextCharacter, updateGroupChat } from '../services/groupChatService';
import { useChatHelpers } from './useChatHelpers';
import { generateId } from '../utils/id';
import type { ToastAPI } from '../components/Toast';
import { expandMacros, type MacroContext } from '../services/macroService';

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

  const { buildChatOptions, buildChatRequest, buildChatMessagesForContext } = useChatHelpers(
    config,
    activeGroup,
    characters
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Close WS chat and abort pending REST requests on character switch
  useEffect(() => {
    wsChatRef.current?.close();
    wsChatRef.current = null;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = null;
  }, [selectedCharacter.id]);

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

      if (useWs) {
        try {
          // Always create a fresh connection per message so onChunk/onDone/onToolResult
          // close over the correct botMsgId. Reusing an existing connection would leave
          // callbacks pointing at the previous message's id.
          wsChatRef.current?.close();
          const ws = new WsChatConnection({
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
                        toolCalls: [
                          ...(msg.toolCalls || []),
                          { toolName, status: 'running' as const },
                        ],
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
                    calls[idx] = {
                      ...calls[idx],
                      status: 'done' as const,
                      output,
                      mediaUrl,
                      mediaType,
                    };
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
                  msg.id === botMsgId
                    ? { ...msg, content: `⚠️ ${error}`, isThinking: false }
                    : msg
                )
              );
              setIsTyping(false);
            },
            onAffect: (affect) => setCurrentAffect(affect),
          });
          // Stable session id per (character, chat thread) so the gateway
          // resumes this conversation's server-side session instead of
          // starting amnesiac each message. Different threads / characters
          // get different ids, so context never bleeds across them.
          const sessionId = `companion:${respondingCharacter.id}:${currentChatFileName ?? 'default'}`;
          await ws.connect(
            respondingCharacter.name,
            'play',
            config.userName || undefined,
            undefined,
            sessionId
          );
          wsChatRef.current = ws;
          wsChatRef.current.send(expandedInput);
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
    currentChatFileName,
    setActiveGroup,
  ]);

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
  };
};
