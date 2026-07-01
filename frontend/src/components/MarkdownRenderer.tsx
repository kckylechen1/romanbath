import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-slate-700/50">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <span className="text-xs font-mono text-slate-500 uppercase">{lang || 'text'}</span>
        <button onClick={handleCopy} className="text-xs text-slate-500 hover:text-white transition-colors">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 bg-slate-900/80 overflow-x-auto">
        <code className="text-sm font-mono text-slate-300 whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-content space-y-1 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          em: ({ children }) => (
            <span className="italic text-amber-300/90">*{children}*</span>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className: cls, children }) => {
            const match = /language-(\w+)/.exec(cls || '');
            const isBlock = (cls || '').includes('language-');
            if (isBlock) {
              return <CodeBlock lang={match?.[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-slate-800 text-sm font-mono text-emerald-300">
                {children}
              </code>
            );
          },
          h1: ({ children }) => <h1 className="text-2xl font-bold text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold text-white mt-4 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-bold text-white mt-4 mb-2">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-slate-600 pl-4 py-1 my-2 text-slate-400 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-slate-700 my-4" />,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-bath-400 hover:text-bath-300 underline">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <table className="my-3 border-collapse border border-slate-700 w-full text-sm">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-slate-700 px-3 py-1.5 bg-slate-800/60 text-left font-semibold text-white">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-700 px-3 py-1.5 text-slate-300">{children}</td>
          ),
          ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
          li: ({ children }) => <li className="text-slate-200">{children}</li>,
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
          del: ({ children }) => <del className="text-slate-500 line-through">{children}</del>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
