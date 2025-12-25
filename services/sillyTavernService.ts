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

    if (mainApi === 'koboldhorde') {
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
    } else if (mainApi === 'openai' || mainApi === 'claude' || mainApi === 'makersuite' || mainApi === 'custom' || mainApi === 'perplexity' || mainApi === 'openrouter' || mainApi === 'google') {
      // Chat Completion APIs (OpenAI, Claude, Google, Perplexity, OpenRouter, etc.)
      const sourceMap: Record<string, string> = {
        'openai': 'openai',
        'claude': 'claude',
        'makersuite': 'makersuite',
        'custom': 'custom',
        'google': 'makersuite',
        'perplexity': 'perplexity',
        'openrouter': 'openrouter',
      };
      const chatCompletionSource = sourceMap[mainApi] || 'openai';

      const defaultModels: Record<string, string> = {
        'perplexity': 'sonar',
        'openai': 'gpt-4o',
        'openrouter': 'anthropic/claude-sonnet-4',
        'google': 'gemini-2.5-flash',
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
  'koboldhorde': 'api_key_horde',
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

const pollHordeTask = async (taskId: string, headers: HeadersInit): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 60; // 60 * 2s = 2 minutes

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 2000));
    const response = await fetch('/api/horde/task-status', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ taskId })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.done) {
        return data.generations[0].text;
      }
      if (!data.is_possible || data.faulted) {
        throw new Error("Horde generation failed or impossible");
      }
    }
    attempts++;
  }
  throw new Error("Horde generation timed out");
};
