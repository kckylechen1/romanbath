/**
 * Toast Notification Component
 * Displays temporary notifications for success, error, warning, and info messages
 */

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastMessage {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = no auto-dismiss
}

interface ToastProps {
    toast: ToastMessage;
    onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
    useEffect(() => {
        if (toast.duration !== 0) {
            const timer = setTimeout(() => {
                onDismiss(toast.id);
            }, toast.duration || 5000);
            return () => clearTimeout(timer);
        }
    }, [toast, onDismiss]);

    const icons = {
        success: <CheckCircle2 className="text-emerald-400" size={20} />,
        error: <AlertCircle className="text-red-400" size={20} />,
        warning: <AlertTriangle className="text-amber-400" size={20} />,
        info: <Info className="text-blue-400" size={20} />,
        loading: <Loader2 className="text-slate-400 animate-spin" size={20} />,
    };

    const bgColors = {
        success: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20',
        error: 'from-red-500/10 to-red-500/5 border-red-500/20',
        warning: 'from-amber-500/10 to-amber-500/5 border-amber-500/20',
        info: 'from-blue-500/10 to-blue-500/5 border-blue-500/20',
        loading: 'from-slate-500/10 to-slate-500/5 border-slate-500/20',
    };

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-xl
                bg-gradient-to-r ${bgColors[toast.type]}
                border backdrop-blur-xl shadow-lg
                animate-in slide-in-from-right-5 fade-in duration-300
                min-w-[300px] max-w-[400px]
            `}
        >
            <div className="flex-shrink-0 mt-0.5">
                {icons[toast.type]}
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-white">{toast.title}</h4>
                {toast.message && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{toast.message}</p>
                )}
            </div>
            {toast.type !== 'loading' && (
                <button
                    onClick={() => onDismiss(toast.id)}
                    className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
};

// Toast Container - manages multiple toasts
interface ToastContainerProps {
    toasts: ToastMessage[];
    onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
};

// Hook for managing toasts
export const useToast = () => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = (toast: Omit<ToastMessage, 'id'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setToasts(prev => [...prev, { ...toast, id }]);
        return id;
    };

    const dismissToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    const updateToast = (id: string, updates: Partial<Omit<ToastMessage, 'id'>>) => {
        setToasts(prev => prev.map(t =>
            t.id === id ? { ...t, ...updates } : t
        ));
    };

    // Convenience methods
    const success = (title: string, message?: string) =>
        addToast({ type: 'success', title, message });

    const error = (title: string, message?: string) =>
        addToast({ type: 'error', title, message, duration: 8000 });

    const warning = (title: string, message?: string) =>
        addToast({ type: 'warning', title, message });

    const info = (title: string, message?: string) =>
        addToast({ type: 'info', title, message });

    const loading = (title: string, message?: string) =>
        addToast({ type: 'loading', title, message, duration: 0 });

    return {
        toasts,
        addToast,
        dismissToast,
        updateToast,
        success,
        error,
        warning,
        info,
        loading,
        ToastContainer: () => <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    };
};

export default Toast;
