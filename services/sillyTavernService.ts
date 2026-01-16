import { Character } from '../types';

let csrfToken: string | null = null;
let csrfTokenFetching: Promise<string | null> | null = null;

// Force get a fresh CSRF token
const getCsrfToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  // Return cached token if available and not forcing refresh
  if (csrfToken && !forceRefresh) return csrfToken;

  // Avoid duplicate requests
  if (csrfTokenFetching && !forceRefresh) return csrfTokenFetching;

  csrfTokenFetching = (async () => {
    try {
      const response = await fetch('/csrf-token', {
        credentials: 'include',
      });
      if (!response.ok) {
        console.error('CSRF token fetch failed:', response.status);
        return null;
      }
      const data = await response.json();
      csrfToken = data.token;
      return csrfToken;
    } catch (error) {
      console.error("Error fetching CSRF token:", error);
      return null;
    } finally {
      csrfTokenFetching = null;
    }
  })();

  return csrfTokenFetching;
};

// Reset CSRF token on 403 errors
const resetCsrfToken = () => {
  csrfToken = null;
};

export const getCharacters = async (): Promise<Character[]> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const response = await fetch('/api/characters/all', {
      method: 'POST',
      headers,
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Failed to fetch characters: ${response.statusText}`);
    const data = await response.json();
    return data.map((char: any) => {
      // Build a comprehensive system instruction from all available character data
      let fullSystemInstruction = '';

      // Character's persona/personality
      if (char.personality) {
        fullSystemInstruction += char.personality + '\n\n';
      }

      // Character's scenario (story/setting)
      if (char.scenario) {
        fullSystemInstruction += `[Scenario: ${char.scenario}]\n\n`;
      }

      // Character's system prompt (if any)
      if (char.system_prompt) {
        fullSystemInstruction += char.system_prompt + '\n\n';
      }

      // Post-history instructions
      if (char.post_history_instructions) {
        fullSystemInstruction += `[Instructions: ${char.post_history_instructions}]\n\n`;
      }

      return {
        id: char.avatar,
        name: char.name,
        avatar: `/characters/${char.avatar}`,
        description: char.description || '',
        systemInstruction: fullSystemInstruction.trim(),
        firstMessage: char.first_mes || '',
        exampleDialogue: char.mes_example || '',
        backgroundImage: ''
      };
    });
  } catch (error) {
    console.error("Error fetching characters from SillyTavern:", error);
    return [];
  }
};

export const getHordeModels = async (): Promise<string[]> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const response = await fetch('/api/horde/text-models', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ force: false }),
    });

    if (!response.ok) throw new Error(`Failed to fetch Horde models: ${response.statusText}`);
    const data = await response.json();
    // API returns array of objects with 'name' property or just strings?
    // Based on usage in ST, it returns array of objects usually.
    // Let's assume strings or map them.
    // Looking at ST code: data is the array.
    // Usually it's [{name: "model1", ...}, ...]
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return data.map((m: any) => m.name);
    }
    return data;
  } catch (error) {
    console.error("Error fetching Horde models:", error);
    return [];
  }
};

export const getGenericModels = async (apiUrl: string, apiType: string = 'textgenerationwebui'): Promise<string[]> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    // This proxies through SillyTavern's backend which can talk to the remote API
    // SillyTavern has /api/backends/text-completions/models
    const response = await fetch('/api/backends/text-completions/models', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        api_server: apiUrl,
        api_type: apiType
      })
    });

    if (!response.ok) return [];

    const data = await response.json();
    // data is usually { result: ["model1", "model2"] } or just array
    if (data.result && Array.isArray(data.result)) return data.result;
    if (Array.isArray(data)) return data;
    if (data.data && Array.isArray(data.data)) return data.data.map((m: any) => m.id || m.name || m); // For some APIs

    return [];
  } catch (error) {
    console.error("Error fetching generic models:", error);
    return [];
  }
};

export const detectApiType = async (url: string): Promise<{ type: string, models: string[] } | null> => {
  // Simple heuristic and probing
  // 1. Try Ooba/TextGenWebUI (common)
  try {
    const models = await getGenericModels(url, 'textgenerationwebui');
    if (models.length > 0) {
      return { type: 'textgenerationwebui', models };
    }
  } catch (e) { }

  // 2. Try Kobold (common)
  try {
    const models = await getGenericModels(url, 'koboldcpp');
    if (models.length > 0) {
      return { type: 'kobold', models };
    }
  } catch (e) { }

  // 3. Try Llama.cpp
  try {
    const models = await getGenericModels(url, 'llamacpp');
    if (models.length > 0) {
      return { type: 'llamacpp', models };
    }
  } catch (e) { }

  return null;
}

export const getSettings = async (): Promise<any> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const response = await fetch('/api/settings/get', {
      method: 'POST',
      headers,
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`Failed to fetch settings: ${response.statusText}`);
    const data = await response.json();

    // SillyTavern returns settings as a JSON string in the 'settings' field
    if (data.settings && typeof data.settings === 'string') {
      return JSON.parse(data.settings);
    }
    return data;
  } catch (error) {
    console.error("Error fetching settings from SillyTavern:", error);
    return {};
  }
};

export const saveSettings = async (settings: any): Promise<boolean> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const response = await fetch('/api/settings/save', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(settings),
    });

    if (!response.ok) throw new Error(`Failed to save settings: ${response.statusText}`);
    return true;
  } catch (error) {
    console.error("Error saving settings to SillyTavern:", error);
    return false;
  }
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  messages?: ChatMessage[];  // For chat completion APIs
  prompt?: string;           // For text completion APIs
  systemPrompt?: string;     // System instruction for the character
}

/**
 * Poll AI Horde for task completion
 */
const pollHordeTask = async (taskId: string, headers: HeadersInit): Promise<string> => {
  const maxAttempts = 60; // 5 minutes max
  const pollInterval = 5000; // 5 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const response = await fetch('/api/horde/check-text', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ id: taskId }),
    });

    if (!response.ok) {
      throw new Error(`Horde polling failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.done) {
      // Task completed
      if (data.generations && data.generations.length > 0) {
        return data.generations[0].text || '';
      }
      return '';
    }

    if (data.faulted) {
      throw new Error('Horde task faulted');
    }

    // Still processing, continue polling
    console.log(`Horde task ${taskId}: ${data.wait_time}s remaining, position ${data.queue_position}`);
  }

  throw new Error('Horde task timed out');
};

export const generateText = async (options: GenerateOptions, settings: any): Promise<string> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const mainApi = settings.main_api;
    let endpoint = '';
    let body: any = {};

    // Build prompt from messages if not provided directly
    const prompt = options.prompt || (options.messages?.map(m =>
      m.role === 'system' ? m.content : `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n') || '');

    if (mainApi === 'local') {
      // Call local OpenAI-compatible proxy through Vite's proxy to bypass CORS
      // The Vite proxy rewrites /local-api/* to localhost:8045/*
      const apiUrl = '/local-api/v1';

      // Try multiple sources for API key
      const localApiKey = settings.apiKey || settings.localApiKey || '';
      const model = settings.modelName || 'gemini-2.5-pro';

      // Use provided messages array
      const chatMessages: ChatMessage[] = options.messages || [
        { role: 'user', content: prompt }
      ];

      const localHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localApiKey}`,
      };

      const localBody = {
        model: model,
        messages: chatMessages,
        max_tokens: settings.maxOutputTokens || settings.amount_gen || 4096,
        temperature: settings.textgenerationwebui_settings?.temp || settings.temperature || 1.0,
        stream: false,
      };

      console.log('Calling local proxy via Vite proxy, model:', model);

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: localHeaders,
        body: JSON.stringify(localBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Local proxy error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Local proxy response:', data);

      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message?.content || data.choices[0].text || '';
      }
      return '';
    } else if (mainApi === 'koboldhorde') {
      endpoint = '/api/horde/generate-text';
      body = {
        prompt: prompt,
        models: settings.koboldhorde_settings?.models || ["koboldcpp/L3-8B-Stheno-v3.2"],
        params: {
          n: 1,
          max_length: settings.amount_gen || 200,
          temperature: settings.textgenerationwebui_settings?.temp || 0.7,
          top_p: settings.textgenerationwebui_settings?.top_p || 0.9,
          top_k: settings.textgenerationwebui_settings?.top_k || 0,
          rep_pen: settings.textgenerationwebui_settings?.rep_pen || 1.1,
        }
      };
    } else if (mainApi === 'openai' || mainApi === 'claude' || mainApi === 'makersuite' || mainApi === 'custom' || mainApi === 'perplexity' || mainApi === 'openrouter' || mainApi === 'google' || mainApi === 'grok') {
      // Chat Completion APIs (OpenAI, Claude, Google, Perplexity, OpenRouter, Grok, etc.)
      const sourceMap: Record<string, string> = {
        'openai': 'openai',
        'claude': 'claude',
        'makersuite': 'makersuite',
        'custom': 'custom',
        'google': 'makersuite',
        'perplexity': 'perplexity',
        'openrouter': 'openrouter',
        'grok': 'xai',
      };
      const chatCompletionSource = sourceMap[mainApi] || 'openai';

      const defaultModels: Record<string, string> = {
        'perplexity': 'sonar',
        'openai': 'gpt-4o',
        'openrouter': 'anthropic/claude-sonnet-4',
        'google': 'gemini-2.5-flash',
        'grok': 'grok-4-1-fast-non-reasoning',
      };
      const model = settings.modelName || settings.model_openai_select || settings.model || defaultModels[mainApi] || 'gpt-3.5-turbo';

      // Use provided messages array, or construct from prompt
      let messages: ChatMessage[];
      if (options.messages && options.messages.length > 0) {
        messages = options.messages;
      } else {
        // Fallback: wrap prompt in messages format
        messages = [
          { role: 'system', content: options.systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ];
      }

      // Calculate max tokens - use maxOutputTokens from config, fallback to amount_gen
      const maxOutputTokens = settings.maxOutputTokens || settings.amount_gen || 4096;
      const thinkingBudget = settings.thinkingBudget || 0;

      // Ensure we have enough tokens for output after thinking
      const effectiveMaxTokens = thinkingBudget > 0
        ? Math.max(maxOutputTokens, thinkingBudget + 2048) // Ensure at least 2048 for actual response
        : maxOutputTokens;

      endpoint = '/api/backends/chat-completions/generate';
      body = {
        chat_completion_source: chatCompletionSource,
        messages: messages,
        model: model,
        max_tokens: effectiveMaxTokens,
        temperature: settings.textgenerationwebui_settings?.temp || settings.temperature || 1.0,
        stream: false,
        // New: Advanced Control Parameters
        logit_bias: settings.logitBias?.length > 0 ? settings.logitBias : undefined,
        grammar_string: settings.grammarString || undefined,
        json_schema: settings.jsonSchemaAllowEmpty && settings.jsonSchema ? settings.jsonSchema : undefined,
        negative_prompt: settings.negativePrompt || undefined,
      };
    } else {
      // Text Completion APIs (Ooba, Kobold, LlamaCpp, etc.)
      const apiServer = settings.api_server_textgenerationwebui || 'http://127.0.0.1:5000';

      // Map frontend API types to backend types
      const apiTypeMap: Record<string, string> = {
        'textgenerationwebui': 'ooba',
        'koboldcpp': 'koboldcpp',
        'llamacpp': 'llamacpp',
        'ollama': 'ollama',
        'ooba': 'ooba',
      };
      const apiType = apiTypeMap[mainApi] || 'ooba';

      endpoint = '/api/backends/text-completions/generate';

      // Process banned tokens if enabled
      let customTokenBans: string[] = [];
      let bannedStrings: string[] = [];

      if (settings.sendBannedTokens) {
        if (settings.bannedTokens) {
          const bannedList = settings.bannedTokens.split(',').map(s => s.trim()).filter(s => s.length > 0);
          bannedList.forEach(token => {
            if (token.startsWith('[') && token.endsWith(']')) {
              try {
                customTokenBans.push(...JSON.parse(token));
              } catch (e) {
                console.warn('Failed to parse banned token:', token);
              }
            } else if (token.startsWith('"') && token.endsWith('"')) {
              bannedStrings.push(token.slice(1, -1));
            } else {
              customTokenBans.push(...token.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)));
            }
          });
        }

        if (settings.globalBannedTokens) {
          const globalBannedList = settings.globalBannedTokens.split(',').map(s => s.trim()).filter(s => s.length > 0);
          globalBannedList.forEach(token => {
            if (token.startsWith('[') && token.endsWith(']')) {
              try {
                customTokenBans.push(...JSON.parse(token));
              } catch (e) {
                console.warn('Failed to parse global banned token:', token);
              }
            } else if (token.startsWith('"') && token.endsWith('"')) {
              bannedStrings.push(token.slice(1, -1));
            } else {
              customTokenBans.push(...token.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)));
            }
          });
        }
      }

      body = {
        prompt: prompt,
        api_type: apiType,
        api_server: apiServer,
        max_new_tokens: settings.amount_gen || 200,
        temperature: settings.textgenerationwebui_settings?.temp || 0.7,
        top_p: settings.textgenerationwebui_settings?.top_p || 0.9,
        top_k: settings.textgenerationwebui_settings?.top_k || 0,
        rep_pen: settings.textgenerationwebui_settings?.rep_pen || 1.1,
        stream: false,
        // New: Advanced Control Parameters
        logit_bias: settings.logitBias?.length > 0 ? settings.logitBias : undefined,
        grammar: settings.grammarString || undefined,
        json_schema: settings.jsonSchemaAllowEmpty && settings.jsonSchema ? settings.jsonSchema : undefined,
        banned_tokens: customTokenBans.length > 0 ? customTokenBans : undefined,
        banned_strings: bannedStrings.length > 0 ? bannedStrings : undefined,
        negative_prompt: settings.negativePrompt || undefined,
      };
    }

    console.log('Generating with:', { endpoint, mainApi, bodyKeys: Object.keys(body) });

    let response = await fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });

    // Retry on 403 CSRF error
    if (response.status === 403) {
      console.log('Got 403, refreshing CSRF token and retrying...');
      resetCsrfToken();
      const newToken = await getCsrfToken(true);
      if (newToken) {
        headers['X-CSRF-Token'] = newToken;
      }
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Generation failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Generation response:', data);

    // Handle error response from backend
    if (data.error) {
      throw new Error(`Backend error: ${data.response || data.message || 'Unknown error'}`);
    }

    // Parse response based on API
    if (mainApi === 'koboldhorde') {
      if (data.id) {
        return await pollHordeTask(data.id, headers);
      }
      return "";
    } else {
      // Standard completion response
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].text || data.choices[0].message?.content || '';
      }
      if (data.results && data.results.length > 0) {
        return data.results[0].text || '';
      }
      // Some APIs return response directly
      if (typeof data.response === 'string') {
        return data.response;
      }
      if (typeof data.text === 'string') {
        return data.text;
      }
    }

    console.warn('Unexpected response format, returning empty:', data);
    return "";

  } catch (error) {
    console.error("Error generating text:", error);
    throw error;
  }
};

// Map of frontend API names to backend secret keys
const SECRET_KEY_MAP: Record<string, string> = {
  'perplexity': 'api_key_perplexity',
  'openai': 'api_key_openai',
  'openrouter': 'api_key_openrouter',
  'google': 'api_key_makersuite',
  'custom': 'api_key_custom',
  'koboldhorde': 'api_key_horde',
  'grok': 'api_key_xai',
};

export const saveSecret = async (mainApi: string, value: string): Promise<boolean> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    const secretKey = SECRET_KEY_MAP[mainApi];
    if (!secretKey) {
      console.warn('No secret key mapping for:', mainApi);
      return false;
    }

    const response = await fetch('/api/secrets/write', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        key: secretKey,
        value: value,
        label: `${mainApi} API Key`,
      }),
    });

    if (!response.ok) {
      console.error('Failed to save secret:', response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving secret:', error);
    return false;
  }
};

/**
 * Streaming text generation - yields chunks as they arrive
 * Only works with OpenAI-compatible APIs (openai, openrouter, google, local, custom)
 */
export const generateTextStream = async (
  options: GenerateOptions,
  settings: any,
  onChunk: (chunk: string, fullText: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: Error) => void,
): Promise<void> => {
  const mainApi = settings.main_api;

  // Only certain APIs support streaming
  const streamableApis = ["openai", "openrouter", "google", "local", "custom", "perplexity", "grok"];
  if (!streamableApis.includes(mainApi)) {
    // Fall back to non-streaming for unsupported APIs
    try {
      const result = await generateText(options, settings);
      onComplete(result);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }

  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    // Build the prompt from messages
    const prompt = options.prompt ||
      options.messages?.map((m) =>
        m.role === "system" ? m.content : `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      ).join("\n") || "";

    if (mainApi === "local") {
      // Call local OpenAI-compatible proxy with streaming
      const apiUrl = "/local-api/v1";
      const localApiKey = settings.apiKey || settings.localApiKey || "";
      const model = settings.modelName || "gemini-2.5-pro";

      const chatMessages: ChatMessage[] = options.messages || [{ role: "user", content: prompt }];

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: chatMessages,
          max_tokens: settings.maxOutputTokens || settings.amount_gen || 4096,
          temperature: settings.textgenerationwebui_settings?.temp || settings.temperature || 1.0,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Local proxy error: ${response.status} - ${errorText}`);
      }

      await processSSEStream(response, onChunk, onComplete, onError);
    } else {
      // Chat Completion APIs with streaming
      const sourceMap: Record<string, string> = {
        openai: "openai",
        claude: "claude",
        makersuite: "makersuite",
        custom: "custom",
        google: "makersuite",
        perplexity: "perplexity",
        openrouter: "openrouter",
        grok: "xai",
      };
      const chatCompletionSource = sourceMap[mainApi] || "openai";

      const defaultModels: Record<string, string> = {
        perplexity: "sonar",
        openai: "gpt-4o",
        openrouter: "anthropic/claude-sonnet-4",
        google: "gemini-2.5-flash",
        grok: "grok-4-1-fast-non-reasoning",
      };
      const model = settings.modelName || settings.model_openai_select || settings.model || defaultModels[mainApi] || "gpt-3.5-turbo";

      const messages: ChatMessage[] = options.messages && options.messages.length > 0
        ? options.messages
        : [
            { role: "system", content: options.systemPrompt || "You are a helpful assistant." },
            { role: "user", content: prompt },
          ];

      const maxOutputTokens = settings.maxOutputTokens || settings.amount_gen || 4096;
      const thinkingBudget = settings.thinkingBudget || 0;
      const effectiveMaxTokens = thinkingBudget > 0 ? Math.max(maxOutputTokens, thinkingBudget + 2048) : maxOutputTokens;

      const response = await fetch("/api/backends/chat-completions/generate", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          chat_completion_source: chatCompletionSource,
          messages,
          model,
          max_tokens: effectiveMaxTokens,
          temperature: settings.textgenerationwebui_settings?.temp || settings.temperature || 1.0,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Generation failed: ${response.statusText} - ${errorText}`);
      }

      await processSSEStream(response, onChunk, onComplete, onError);
    }
  } catch (error) {
    console.error("Error in streaming generation:", error);
    onError(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Process SSE (Server-Sent Events) stream from OpenAI-compatible APIs
 */
const processSSEStream = async (
  response: Response,
  onChunk: (chunk: string, fullText: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: Error) => void,
): Promise<void> => {
  const reader = response.body?.getReader();
  if (!reader) {
    onError(new Error("No response body"));
    return;
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();

          // End of stream markers
          // Check for stream end markers
          if (data === "[DONE]" || data === "") {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            
            // Handle OpenAI format
            if (parsed.choices && parsed.choices[0]) {
              const choice = parsed.choices[0];
              const delta = choice.delta?.content || choice.text || "";
              if (delta) {
                fullText += delta;
                onChunk(delta, fullText);
              }
              
              // Check for finish reason
              if (choice.finish_reason) {
                break;
              }
            }
            
            // Handle other formats
            if (parsed.response) {
              fullText += parsed.response;
              onChunk(parsed.response, fullText);
            }
          } catch (e) {
            // Not valid JSON, might be partial data
            console.warn("Failed to parse SSE data:", data);
          }
        }
      }
    }
    
    onComplete(fullText);
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
};

export const importCharacterCard = async (file: File): Promise<{ success: boolean; fileName?: string; error?: string }> => {
  try {
    const token = await getCsrfToken();

    // Determine file type from extension
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const supportedFormats = ['png', 'json', 'yaml', 'yml', 'charx'];

    if (!supportedFormats.includes(extension)) {
      return {
        success: false,
        error: `Unsupported file format: ${extension}. Supported formats: ${supportedFormats.join(', ')}`
      };
    }

    // Create FormData for file upload
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('file_type', extension);

    const headers: HeadersInit = {};
    if (token) {
      headers['X-CSRF-Token'] = token;
    }

    let response = await fetch('/api/characters/import', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    });

    // Retry on 403 CSRF error
    if (response.status === 403) {
      console.log('Got 403, refreshing CSRF token and retrying...');
      resetCsrfToken();
      const newToken = await getCsrfToken(true);
      if (newToken) {
        headers['X-CSRF-Token'] = newToken;
      }
      response = await fetch('/api/characters/import', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Import failed:', response.status, errorText);
      return {
        success: false,
        error: `Import failed: ${response.statusText}`
      };
    }

    const data = await response.json();

    if (data.error) {
      return {
        success: false,
        error: data.message || 'Import failed'
      };
    }

    return {
      success: true,
      fileName: data.file_name
    };
  } catch (error) {
    console.error('Error importing character card:', error);

    const message = error instanceof Error ? error.message : '';
    const isNetworkError =
      message.includes('Failed to fetch') ||
      message.includes('NetworkError') ||
      message.includes('ECONNREFUSED');

    return {
      success: false,
      error: isNetworkError
        ? '无法连接到 SillyTavern 后端（http://127.0.0.1:8000）'
        : (error instanceof Error ? error.message : 'Unknown error occurred')
    };
  }
};

// ==================== CHARACTER CRUD OPERATIONS ====================

export interface CharacterFormData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings?: string[];
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes?: string;
  tags?: string[];
  avatar?: File | string;
}

/**
 * Create a new character
 */
export const createCharacter = async (
  data: CharacterFormData,
): Promise<{ success: boolean; fileName?: string; error?: string }> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {};
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("description", data.description || "");
    formData.append("personality", data.personality || "");
    formData.append("scenario", data.scenario || "");
    formData.append("first_mes", data.firstMessage || "");
    formData.append("mes_example", data.exampleDialogue || "");
    formData.append("system_prompt", data.systemPrompt || "");
    formData.append("post_history_instructions", data.postHistoryInstructions || "");
    formData.append("creator_notes", data.creatorNotes || "");
    formData.append("tags", JSON.stringify(data.tags || []));

    if (data.alternateGreetings && data.alternateGreetings.length > 0) {
      formData.append("alternate_greetings", JSON.stringify(data.alternateGreetings));
    }

    if (data.avatar instanceof File) {
      formData.append("avatar", data.avatar);
    }

    let response = await fetch("/api/characters/create", {
      method: "POST",
      headers,
      credentials: "include",
      body: formData,
    });

    if (response.status === 403) {
      resetCsrfToken();
      const newToken = await getCsrfToken(true);
      if (newToken) {
        headers["X-CSRF-Token"] = newToken;
      }
      response = await fetch("/api/characters/create", {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      });
    }

    if (!response.ok) {
      return { success: false, error: `Failed to create character: ${response.statusText}` };
    }

    const result = await response.json();
    return { success: true, fileName: result.file_name || result.avatar };
  } catch (error) {
    console.error("Error creating character:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};

/**
 * Update an existing character
 */
export const updateCharacter = async (
  avatarUrl: string,
  data: Partial<CharacterFormData>,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = {};
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    const formData = new FormData();
    formData.append("avatar_url", avatarUrl);

    if (data.name !== undefined) formData.append("name", data.name);
    if (data.description !== undefined) formData.append("description", data.description);
    if (data.personality !== undefined) formData.append("personality", data.personality);
    if (data.scenario !== undefined) formData.append("scenario", data.scenario);
    if (data.firstMessage !== undefined) formData.append("first_mes", data.firstMessage);
    if (data.exampleDialogue !== undefined) formData.append("mes_example", data.exampleDialogue);
    if (data.systemPrompt !== undefined) formData.append("system_prompt", data.systemPrompt);
    if (data.postHistoryInstructions !== undefined) formData.append("post_history_instructions", data.postHistoryInstructions);
    if (data.creatorNotes !== undefined) formData.append("creator_notes", data.creatorNotes);
    if (data.tags !== undefined) formData.append("tags", JSON.stringify(data.tags));
    if (data.alternateGreetings !== undefined) formData.append("alternate_greetings", JSON.stringify(data.alternateGreetings));

    if (data.avatar instanceof File) {
      formData.append("avatar", data.avatar);
    }

    let response = await fetch("/api/characters/edit", {
      method: "POST",
      headers,
      credentials: "include",
      body: formData,
    });

    if (response.status === 403) {
      resetCsrfToken();
      const newToken = await getCsrfToken(true);
      if (newToken) {
        headers["X-CSRF-Token"] = newToken;
      }
      response = await fetch("/api/characters/edit", {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      });
    }

    if (!response.ok) {
      return { success: false, error: `Failed to update character: ${response.statusText}` };
    }

    return { success: true };
  } catch (error) {
    console.error("Error updating character:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};

/**
 * Delete a character
 */
export const deleteCharacter = async (
  avatarUrl: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    let response = await fetch("/api/characters/delete", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ avatar_url: avatarUrl, delete_chats: false }),
    });

    if (response.status === 403) {
      resetCsrfToken();
      const newToken = await getCsrfToken(true);
      if (newToken) {
        headers["X-CSRF-Token"] = newToken;
      }
      response = await fetch("/api/characters/delete", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ avatar_url: avatarUrl, delete_chats: false }),
      });
    }

    if (!response.ok) {
      return { success: false, error: `Failed to delete character: ${response.statusText}` };
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting character:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};

/**
 * Get full character details (for editing)
 */
export const getCharacterDetails = async (
  avatarUrl: string,
): Promise<CharacterFormData | null> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    const response = await fetch("/api/characters/get", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });

    if (!response.ok) {
      console.error("Get character details failed:", response.status);
      return null;
    }

    const char = await response.json();

    return {
      name: char.name || "",
      description: char.description || "",
      personality: char.personality || "",
      scenario: char.scenario || "",
      firstMessage: char.first_mes || "",
      alternateGreetings: char.alternate_greetings || [],
      exampleDialogue: char.mes_example || "",
      systemPrompt: char.system_prompt || "",
      postHistoryInstructions: char.post_history_instructions || "",
      creatorNotes: char.creator_notes || "",
      tags: char.tags || [],
      avatar: `/characters/${avatarUrl}`,
    };
  } catch (error) {
    console.error("Error getting character details:", error);
    return null;
  }
};

/**
 * Duplicate a character
 */
export const duplicateCharacter = async (
  avatarUrl: string,
): Promise<{ success: boolean; fileName?: string; error?: string }> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    const response = await fetch("/api/characters/duplicate", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });

    if (!response.ok) {
      return { success: false, error: `Failed to duplicate character: ${response.statusText}` };
    }

    const result = await response.json();
    return { success: true, fileName: result.file_name };
  } catch (error) {
    console.error("Error duplicating character:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};

/**
 * Export a character as PNG
 */
export const exportCharacter = async (avatarUrl: string): Promise<Blob | null> => {
  try {
    const token = await getCsrfToken();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;
    }

    const response = await fetch("/api/characters/export", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ avatar_url: avatarUrl, format: "png" }),
    });

    if (!response.ok) {
      console.error("Export character failed:", response.status);
      return null;
    }

    return await response.blob();
  } catch (error) {
    console.error("Error exporting character:", error);
    return null;
  }
};
