/**
 * Markdown Renderer Component
 * Parses and renders markdown content with syntax highlighting for code blocks
 * Supports: bold, italic, code, code blocks, links, lists, and roleplay actions (*asterisks*)
 */

import React, { useMemo } from 'react';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

// Simple markdown parser
const parseMarkdown = (text: string): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    let key = 0;

    // Split by code blocks first (```...```)
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    const processInline = (text: string): React.ReactNode[] => {
        const inlineElements: React.ReactNode[] = [];
        let inlineKey = 0;

        // Process text for inline elements
        // Order matters: process multi-char patterns before single-char
        const patterns = [
            // Bold: **text** or __text__
            { regex: /\*\*(.+?)\*\*|__(.+?)__/g, render: (m: string[]) => <strong key={`b-${inlineKey++}`} className="font-semibold text-white">{m[1] || m[2]}</strong> },
            // Italic: *text* or _text_ (but not inside asterisk actions)
            { regex: /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, render: (m: string[]) => <em key={`i-${inlineKey++}`} className="italic text-slate-300">{m[1] || m[2]}</em> },
            // Inline code: `code`
            { regex: /`([^`]+)`/g, render: (m: string[]) => <code key={`c-${inlineKey++}`} className="px-1.5 py-0.5 rounded bg-slate-800/80 text-emerald-400 font-mono text-sm">{m[1]}</code> },
            // Links: [text](url)
            { regex: /\[([^\]]+)\]\(([^)]+)\)/g, render: (m: string[]) => <a key={`a-${inlineKey++}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">{m[1]}</a> },
        ];

        // For roleplay: detect *action* patterns (single asterisks around text)
        // We'll handle this specially to show actions in a different color
        const roleplayActionRegex = /\*([^*]+)\*/g;

        // First, let's just do a simple split and process approach
        let remaining = text;
        let lastPos = 0;

        // Process roleplay actions (*action*)
        const actionMatches = [...text.matchAll(roleplayActionRegex)];
        if (actionMatches.length > 0) {
            actionMatches.forEach(match => {
                // Add text before the match
                if (match.index! > lastPos) {
                    inlineElements.push(
                        <span key={`t-${inlineKey++}`}>{text.slice(lastPos, match.index)}</span>
                    );
                }
                // Add the action with special styling
                inlineElements.push(
                    <span key={`action-${inlineKey++}`} className="italic text-amber-300/90">
                        *{match[1]}*
                    </span>
                );
                lastPos = match.index! + match[0].length;
            });
            // Add remaining text
            if (lastPos < text.length) {
                inlineElements.push(
                    <span key={`t-${inlineKey++}`}>{text.slice(lastPos)}</span>
                );
            }
            return inlineElements;
        }

        // If no roleplay actions, just return the text
        return [<span key={`t-${inlineKey++}`}>{text}</span>];
    };

    const processTextBlock = (text: string): React.ReactNode[] => {
        const lines = text.split('\n');
        const blockElements: React.ReactNode[] = [];
        let blockKey = 0;

        lines.forEach((line, idx) => {
            // Headers
            if (line.startsWith('### ')) {
                blockElements.push(
                    <h3 key={`h3-${blockKey++}`} className="text-lg font-bold text-white mt-4 mb-2">
                        {processInline(line.slice(4))}
                    </h3>
                );
            } else if (line.startsWith('## ')) {
                blockElements.push(
                    <h2 key={`h2-${blockKey++}`} className="text-xl font-bold text-white mt-4 mb-2">
                        {processInline(line.slice(3))}
                    </h2>
                );
            } else if (line.startsWith('# ')) {
                blockElements.push(
                    <h1 key={`h1-${blockKey++}`} className="text-2xl font-bold text-white mt-4 mb-2">
                        {processInline(line.slice(2))}
                    </h1>
                );
            }
            // Unordered list
            else if (line.match(/^[\s]*[-*]\s/)) {
                const indent = line.match(/^(\s*)/)?.[1].length || 0;
                const content = line.replace(/^[\s]*[-*]\s/, '');
                blockElements.push(
                    <div key={`li-${blockKey++}`} className="flex items-start gap-2" style={{ marginLeft: indent * 4 }}>
                        <span className="text-slate-500 mt-1">•</span>
                        <span>{processInline(content)}</span>
                    </div>
                );
            }
            // Ordered list
            else if (line.match(/^[\s]*\d+\.\s/)) {
                const numMatch = line.match(/^[\s]*(\d+)\.\s/);
                const num = numMatch?.[1] || '1';
                const content = line.replace(/^[\s]*\d+\.\s/, '');
                blockElements.push(
                    <div key={`ol-${blockKey++}`} className="flex items-start gap-2">
                        <span className="text-slate-500 min-w-[1.5rem]">{num}.</span>
                        <span>{processInline(content)}</span>
                    </div>
                );
            }
            // Blockquote
            else if (line.startsWith('> ')) {
                blockElements.push(
                    <blockquote key={`bq-${blockKey++}`} className="border-l-2 border-slate-600 pl-4 py-1 my-2 text-slate-400 italic">
                        {processInline(line.slice(2))}
                    </blockquote>
                );
            }
            // Horizontal rule
            else if (line.match(/^[-*_]{3,}$/)) {
                blockElements.push(
                    <hr key={`hr-${blockKey++}`} className="border-slate-700 my-4" />
                );
            }
            // Empty line = paragraph break
            else if (line.trim() === '') {
                blockElements.push(<div key={`br-${blockKey++}`} className="h-2" />);
            }
            // Regular paragraph
            else {
                blockElements.push(
                    <p key={`p-${blockKey++}`} className="leading-relaxed">
                        {processInline(line)}
                    </p>
                );
            }
        });

        return blockElements;
    };

    // Find all code blocks
    while ((match = codeBlockRegex.exec(text)) !== null) {
        // Add text before code block
        if (match.index > lastIndex) {
            const textBefore = text.slice(lastIndex, match.index);
            elements.push(...processTextBlock(textBefore));
        }

        // Add code block
        const language = match[1] || 'text';
        const code = match[2].trim();
        elements.push(
            <div key={`code-${key++}`} className="my-3 rounded-xl overflow-hidden border border-slate-700/50">
                <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50">
                    <span className="text-xs font-mono text-slate-500 uppercase">{language}</span>
                    <button
                        onClick={() => navigator.clipboard.writeText(code)}
                        className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                        Copy
                    </button>
                </div>
                <pre className="p-4 bg-slate-900/80 overflow-x-auto">
                    <code className="text-sm font-mono text-slate-300 whitespace-pre">
                        {code}
                    </code>
                </pre>
            </div>
        );

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last code block
    if (lastIndex < text.length) {
        elements.push(...processTextBlock(text.slice(lastIndex)));
    }

    return elements;
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
    const rendered = useMemo(() => parseMarkdown(content), [content]);

    return (
        <div className={`markdown-content space-y-1 ${className}`}>
            {rendered}
        </div>
    );
};

export default MarkdownRenderer;
