/** Query-key namespace for the Chatbot feature (the conversation itself is component state). */
export const chatbotKeys = {
  all: ['chatbot'] as const,
  status: () => [...chatbotKeys.all, 'status'] as const,
  config: () => [...chatbotKeys.all, 'config'] as const,
};
