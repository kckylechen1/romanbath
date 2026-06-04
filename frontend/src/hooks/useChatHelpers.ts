import { useCallback } from "react";
import { ChatConfig, Character, Message, Role, GroupMessage, GroupChat } from "../types";
import { ChatOptions, ChatRequestPayload, ChatMessage } from "../services/zeroclawService";
import { buildGroupSystemPrompt } from "../services/groupChatService";
import { DEFAULT_CONFIG } from "../constants";

export const characterNameForMessage = (msg: Message, fallback: Character): string => {
  const extra = (msg as GroupMessage).extra;
  return extra?.characterName ?? fallback.name;
};

export const useChatHelpers = (
  config: ChatConfig,
  activeGroup: GroupChat | null,
  characters: Character[],
) => {
  const buildChatOptions = useCallback((): ChatOptions => ({
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
    contextTemplate: config.contextTemplate !== DEFAULT_CONFIG.contextTemplate ? config.contextTemplate : null,
    promptTemplate: config.promptTemplate ?? null,
    negativePrompt: config.negativePrompt,
  }), [config]);

  const buildChatRequest = useCallback((
    chatMessages: ChatMessage[],
    respondingCharacter: Character,
  ): ChatRequestPayload => {
    const request: ChatRequestPayload = {
      messages: chatMessages,
      character_name: respondingCharacter.name,
    };

    if (activeGroup) {
      const groupCharacters = characters.filter((char) =>
        activeGroup.characterIds.includes(char.id),
      );
      const groupPrompt = buildGroupSystemPrompt(respondingCharacter, groupCharacters, {
        scenario: config.scenario,
        userName: config.userName,
        userDescription: config.userDescription,
      });
      request.system_prompts = [groupPrompt];
    }

    return request;
  }, [activeGroup, characters, config.scenario, config.userDescription, config.userName]);

  const buildChatMessagesForContext = (
    contextMessages: Message[],
  ): ChatMessage[] => {
    return contextMessages.map((msg) => {
      const groupMsg = msg as GroupMessage;
      const shouldPrefix =
        activeGroup && msg.role === Role.Model && groupMsg.extra?.characterName;
      return {
        role: msg.role === Role.User ? "user" : "assistant",
        content: shouldPrefix ? `[${groupMsg.extra?.characterName}]: ${msg.content}` : msg.content,
      };
    });
  };

  return { buildChatOptions, buildChatRequest, buildChatMessagesForContext };
};
