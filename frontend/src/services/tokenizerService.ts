export interface TokenCount {
  total: number;
  system: number;
  history: number;
  lastMessage: number;
}

export const countTokensApprox = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export const countMessagesTokens = (
  messages: { content: string }[],
): number => {
  return messages.reduce((acc, msg) => acc + countTokensApprox(msg.content), 0);
};

export const getTokenBreakdown = (
  systemPrompt: string,
  messages: { content: string }[],
): TokenCount => {
  const systemTokens = countTokensApprox(systemPrompt);
  const historyTokens = countMessagesTokens(messages.slice(0, -1));
  const lastMsgTokens =
    messages.length > 0
      ? countTokensApprox(messages[messages.length - 1].content)
      : 0;

  return {
    total: systemTokens + historyTokens + lastMsgTokens,
    system: systemTokens,
    history: historyTokens,
    lastMessage: lastMsgTokens,
  };
};
