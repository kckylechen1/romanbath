export interface PromptTemplate {
  id: string;
  name: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  stopSequences: string[];
}

export const PRESET_TEMPLATES: PromptTemplate[] = [
  {
    id: "chatml",
    name: "ChatML",
    systemPrefix: "<|im_start|>system\n",
    systemSuffix: "<|im_end|>\n",
    userPrefix: "<|im_start|>user\n",
    userSuffix: "<|im_end|>\n",
    assistantPrefix: "<|im_start|>assistant\n",
    assistantSuffix: "<|im_end|>\n",
    stopSequences: ["<|im_end|>"],
  },
  {
    id: "llama2",
    name: "Llama 2",
    systemPrefix: "[INST] <<SYS>>\n",
    systemSuffix: "\n<</SYS>>\n\n",
    userPrefix: "",
    userSuffix: " [/INST] ",
    assistantPrefix: "",
    assistantSuffix: " </s><s>[INST] ",
    stopSequences: ["</s>", "[INST]"],
  },
  {
    id: "alpaca",
    name: "Alpaca",
    systemPrefix: "### Instruction:\n",
    systemSuffix: "\n\n",
    userPrefix: "### Input:\n",
    userSuffix: "\n\n",
    assistantPrefix: "### Response:\n",
    assistantSuffix: "\n\n",
    stopSequences: ["### Input:", "### Instruction:"],
  },
  {
    id: "mistral",
    name: "Mistral",
    systemPrefix: "<s>[INST] ",
    systemSuffix: "\n",
    userPrefix: "",
    userSuffix: " [/INST]",
    assistantPrefix: "",
    assistantSuffix: "</s> [INST] ",
    stopSequences: ["</s>"],
  },
];

export const applyTemplate = (
  template: PromptTemplate,
  systemPrompt: string,
  messages: { role: string; content: string }[],
): string => {
  let prompt = "";

  prompt += template.systemPrefix + systemPrompt + template.systemSuffix;

  messages.forEach((msg) => {
    if (msg.role === "user") {
      prompt += template.userPrefix + msg.content + template.userSuffix;
    } else if (msg.role === "assistant") {
      prompt +=
        template.assistantPrefix + msg.content + template.assistantSuffix;
    }
  });

  prompt += template.assistantPrefix;

  return prompt;
};
