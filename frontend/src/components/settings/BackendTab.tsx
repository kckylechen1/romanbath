import React, { useState, useEffect } from 'react';
import { generateText, ensurePairing } from '../../services/zeroclawService';
import { CheckCircle, XCircle, RefreshCw, Server } from 'lucide-react';

const BackendTab: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  useEffect(() => {
    ensurePairing()
      .then(() => {
        setConnectionStatus('success');
        setConnectionMessage('Connected to ZeroClaw gateway');
      })
      .catch((e) => {
        setConnectionStatus('error');
        setConnectionMessage(e instanceof Error ? e.message : 'Gateway not reachable');
      });
  }, []);

  const handleTestConnection = async () => {
    setConnectionStatus('loading');
    setConnectionMessage('Testing ZeroClaw gateway...');
    try {
      await ensurePairing();
      const text = await generateText(
        { messages: [{ role: 'user', content: 'ping' }] },
        {
          temperature: 0.7,
          maxTokens: 16,
          topP: null,
          topK: null,
          frequencyPenalty: null,
          presencePenalty: null,
          stop: null,
          seed: null,
          userName: null,
          userDescription: null,
          sceneMode: null,
        }
      );
      setConnectionStatus('success');
      setConnectionMessage(text ? 'Gateway chat OK ✓' : 'Gateway reachable (empty response)');
    } catch (error: unknown) {
      setConnectionStatus('error');
      setConnectionMessage(
        error instanceof Error ? error.message : String(error) || 'Gateway test failed'
      );
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h3 className="text-lg font-bold text-white">ZeroClaw Gateway</h3>
        <p className="text-sm text-stone-400 mt-2">
          Model provider, API keys, and agent configuration live in ZeroClaw (typically{' '}
          <code className="text-stone-300">~/.zeroclaw/config.toml</code>). Roman Bath sends chat
          requests through the gateway — model keys and providers are configured in ZeroClaw, not in
          this UI.
        </p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          {connectionStatus === 'success' ? (
            <CheckCircle className="text-green-400 shrink-0" size={20} />
          ) : connectionStatus === 'error' ? (
            <XCircle className="text-red-400 shrink-0" size={20} />
          ) : connectionStatus === 'loading' ? (
            <RefreshCw className="text-stone-400 shrink-0 animate-spin" size={20} />
          ) : (
            <Server className="text-stone-400 shrink-0" size={20} />
          )}
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-white">
              {connectionStatus === 'success'
                ? 'Gateway connected'
                : connectionStatus === 'error'
                  ? 'Gateway error'
                  : connectionStatus === 'loading'
                    ? 'Connecting...'
                    : 'Not checked'}
            </h4>
            <p className="text-xs text-stone-400 mt-1">
              {connectionMessage || 'Start zeroclaw gateway, then test the chat endpoint.'}
            </p>
          </div>
          <button
            onClick={handleTestConnection}
            disabled={connectionStatus === 'loading'}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-stone-200 hover:bg-white/10 disabled:opacity-50"
          >
            Test chat
          </button>
        </div>

        <ul className="text-xs text-stone-500 space-y-2 list-disc pl-4">
          <li>
            Characters: <code className="text-stone-400">GET /api/characters</code>
          </li>
          <li>
            Chat: <code className="text-stone-400">POST /api/chat</code> (SSE streaming)
          </li>
          <li>Chat history: stored locally in this browser</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-stone-300">Per-request overrides</h4>
        <p className="text-xs text-stone-500">
          Use the Generation tab to adjust temperature, top-p, max tokens, and scene mode for each
          chat session. These are passed to the gateway on every message.
        </p>
      </div>
    </div>
  );
};

export default BackendTab;
