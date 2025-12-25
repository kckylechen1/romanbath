
import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";
import { Character, ChatConfig, LorebookEntry } from '../types';

let chatSession: Chat | null = null;
let genAI: GoogleGenAI | null = null;

export const initializeGenAI = () => {
  if (!genAI) {
    genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return genAI;
};

// Scan the input text and history for keywords to trigger World Info
const getActiveLorebookEntries = (config: ChatConfig, character: Character): string => {
  if (!config.lorebook || config.lorebook.length === 0) return "";

  // For a truly dynamic lorebook, we would scan the actual chat history here.
  // Since we don't pass history to this function in this architecture (handled by ChatSession object),
  // we will inject ALL enabled global entries for now, or assume common keywords are present.
  // In a production app, you would pass the last 5 user messages here to filter.
  
  const activeEntries = config.lorebook
    .filter(entry => entry.enabled)
    .map(entry => entry.content)
    .join("\n\n");

  return activeEntries ? `\n\n[WORLD INFO / LOREBOOK]\n${activeEntries}` : "";
};

const buildSystemInstruction = (character: Character, config: ChatConfig): string => {
  // 1. Character Definition
  let instruction = config.systemPromptOverride && config.systemPromptOverride.trim() !== "" 
    ? config.systemPromptOverride 
    : character.systemInstruction;

  // 2. Example Dialogue
  if (config.exampleDialogue && config.exampleDialogue.trim() !== "") {
    instruction += `\n\n[EXAMPLE DIALOGUE]\n${config.exampleDialogue}`;
  }

  // 3. User Info
  let userInfo = "";
  if ((config.userName && config.userName.trim() !== "User") || (config.userDescription && config.userDescription.trim() !== "")) {
      userInfo = `\n\n[USER INFO]`;
      if (config.userName) userInfo += `\nName: ${config.userName}`;
      if (config.userDescription) userInfo += `\nDescription: ${config.userDescription}`;
      userInfo += `\nRole: User/Interlocutor`;
  }

  // 4. Scenario
  const scenario = config.scenario && config.scenario.trim() !== "" 
    ? `\n\n[SCENARIO]\n${config.scenario}`
    : "";

  // 5. World Info (Lorebook)
  const worldInfo = getActiveLorebookEntries(config, character);

  // 6. Author's Note
  const authorsNote = config.authorsNote && config.authorsNote.trim() !== ""
    ? `\n\n[AUTHOR'S NOTE]\n${config.authorsNote}`
    : "";

  // Strategy Construction
  if (config.promptOrder === 'default') {
    return `${instruction}${userInfo}${scenario}${worldInfo}${authorsNote}`;
  } 
  else if (config.promptOrder === 'style_first') {
    return `${authorsNote}\n\n${instruction}${scenario}${worldInfo}${userInfo}`;
  }
  else {
    return `${instruction}${userInfo}${worldInfo}${authorsNote}${scenario}`;
  }
};

export const createChatSession = (character: Character, config: ChatConfig) => {
  const ai = initializeGenAI();
  const systemInstruction = buildSystemInstruction(character, config);

  // Construct config object
  const generationConfig: any = {
    systemInstruction: systemInstruction,
    temperature: config.temperature,
    topK: config.topK,
    topP: config.topP,
    maxOutputTokens: config.maxOutputTokens,
    presencePenalty: config.presencePenalty,
    frequencyPenalty: config.frequencyPenalty,
  };

  if (config.thinkingBudget > 0) {
    generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
  }

  if (config.stopSequences && config.stopSequences.length > 0) {
    generationConfig.stopSequences = config.stopSequences;
  }
  
  if (config.seed !== -1) {
    generationConfig.seed = config.seed;
  }

  chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: generationConfig
  });
  
  return chatSession;
};

export const sendMessageStream = async function* (message: string) {
  if (!chatSession) {
    throw new Error("Chat session not initialized.");
  }

  const result = await chatSession.sendMessageStream({ message });

  for await (const chunk of result) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      yield c.text;
    }
  }
};

export const hasApiKey = (): boolean => {
  return !!process.env.API_KEY;
};
