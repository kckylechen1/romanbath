import { useCallback } from 'react';
import { ChatConfig, Character, Message, Role, GroupMessage, GroupChat } from '../types';
import { ChatOptions, ChatRequestPayload, ChatMessage } from '../services/zeroclawService';
import { buildGroupSystemPrompt } from '../services/groupChatService';
import { DEFAULT_CONFIG } from '../constants';
import { expandMacros, type MacroContext } from '../services/macroService';

export const characterNameForMessage = (msg: Message, fallback: Character): string => {
  const extra = (msg as GroupMessage).extra;
  return extra?.characterName ?? fallback.name;
};

export const useChatHelpers = (
  config: ChatConfig,
  activeGroup: GroupChat | null,
  characters: Character[]
) => {
  const buildChatOptions = useCallback(
    (): ChatOptions => ({
      temperature: config.temperature,
      maxTokens: config.maxOutputTokens,
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      stop: config.stopSequences?.length ? config.stopSequences : null,
      seed: config.seed !== -1 ? config.seed : null,
      userName: config.userName,
      userDescription: config.userDescription,
      sceneMode: config.sceneMode,
      scenario: config.scenario,
      exampleDialogue: config.exampleDialogue,
      lorebook: config.lorebook,
      systemPromptOverride: config.systemPromptOverride,
      authorsNote: config.authorsNote,
      authorsNoteDepth: config.authorsNoteDepth,
      promptOrder: config.promptOrder,
      userPrefix: config.userPrefix !== DEFAULT_CONFIG.userPrefix ? config.userPrefix : null,
      modelPrefix: config.modelPrefix !== DEFAULT_CONFIG.modelPrefix ? config.modelPrefix : null,
      contextTemplate:
        config.contextTemplate !== DEFAULT_CONFIG.contextTemplate ? config.contextTemplate : null,
      promptTemplate: config.promptTemplate ?? null,
      negativePrompt: config.negativePrompt,
    }),
    [config]
  );

  const buildChatRequest = useCallback(
    (chatMessages: ChatMessage[], respondingCharacter: Character): ChatRequestPayload => {
      const request: ChatRequestPayload = {
        messages: chatMessages,
        character_name: respondingCharacter.name,
      };

      if (activeGroup) {
        const groupCharacters = characters.filter((char) =>
          activeGroup.characterIds.includes(char.id)
        );
        const groupPrompt = buildGroupSystemPrompt(respondingCharacter, groupCharacters, {
          scenario: config.scenario,
          userName: config.userName,
          userDescription: config.userDescription,
        });
        request.system_prompts = [groupPrompt];
      }

      return request;
    },
    [activeGroup, characters, config.scenario, config.userDescription, config.userName]
  );

  const buildChatMessagesForContext = useCallback(
    (contextMessages: Message[], respondingCharacterName?: string): ChatMessage[] => {
      // ST macros expand on the client before the request goes out — that's
      // how SillyTavern cards carry {{user}}, {{char}}, {{random:...}} etc.
      // The character name is whatever character will respond; in group
      // chats the caller already knows the next speaker and passes it.
      // When omitted we fall back to a placeholder so history expansion of
      // {{char}} inside non-group flows still works for legacy callers.
      const macroCtx: MacroContext = {
        userName: config.userName,
        characterName: respondingCharacterName ?? 'Assistant',
        personaDescription: config.userDescription,
      };
      return contextMessages.map((msg) => {
        const groupMsg = msg as GroupMessage;
        const shouldPrefix =
          activeGroup && msg.role === Role.Model && groupMsg.extra?.characterName;
        const raw = shouldPrefix
          ? `[${groupMsg.extra?.characterName}]: ${msg.content}`
          : msg.content;
        return {
          role: msg.role === Role.User ? 'user' : 'assistant',
          content: expandMacros(raw, macroCtx),
        };
      });
    },
    [activeGroup, config.userName, config.userDescription]
  );

  return { buildChatOptions, buildChatRequest, buildChatMessagesForContext };
};
