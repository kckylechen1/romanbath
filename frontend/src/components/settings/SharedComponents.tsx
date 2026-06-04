import React, { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { useLanguage } from "../../i18n";

interface BufferedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string | number;
  onSave: (val: string | number) => void;
  label?: React.ReactNode;
}

export const BufferedInput: React.FC<BufferedInputProps> = ({
  value,
  onSave,
  label,
  className,
  type = "text",
  ...props
}) => {
  const { t } = useLanguage();
  const [localValue, setLocalValue] = useState<string | number>(value ?? "");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!isDirty) {
      setLocalValue(value ?? "");
    }
  }, [value, isDirty]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(localValue);
      setIsDirty(false);
      setIsTyping(false);
    } finally {
      setIsSaving(false);
    }
  };

  const isEmpty = localValue === "" || localValue === undefined || localValue === null;
  const shouldShowAsPassword = type === "password" && (isTyping || !isEmpty);
  const inputType = shouldShowAsPassword ? "password" : type === "password" ? "text" : type;

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {label}
        </label>
      )}
      <input
        {...props}
        type={inputType}
        value={localValue}
        onChange={(e) => {
          const val = type === "number" ? parseFloat(e.target.value) : e.target.value;
          setLocalValue(val);
          setIsDirty(true);
          if (type === "password") {
            setIsTyping(true);
          }
        }}
        onFocus={() => {
          if (type === "password" && !isEmpty) {
            setIsTyping(true);
          }
        }}
        onBlur={() => {
          if (type === "password" && isEmpty) {
            setIsTyping(false);
          }
        }}
        className={className}
      />
      <button
        onClick={handleSave}
        disabled={!isDirty || isSaving}
        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                    ${
                      isDirty
                        ? "bg-stone-200 text-stone-900 hover:bg-white shadow-sm cursor-pointer"
                        : "bg-white/5 text-stone-600 cursor-not-allowed"
                    }
                `}
      >
        <Save size={14} />
        {isSaving ? t("common.saving") : isDirty ? t("common.save") : t("common.saved")}
      </button>
    </div>
  );
};

interface BufferedTextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string | number;
  onSave: (val: string | number) => void;
  label?: React.ReactNode;
}

export const BufferedTextArea: React.FC<BufferedTextAreaProps> = ({
  value,
  onSave,
  label,
  className,
  ...props
}) => {
  const { t } = useLanguage();
  const [localValue, setLocalValue] = useState<string | number>(value);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setLocalValue(value);
    setIsDirty(false);
  }, [value]);

  const handleSave = () => {
    onSave(localValue);
    setIsDirty(false);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {label}
        </label>
      )}
      <textarea
        {...props}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          setIsDirty(true);
        }}
        className={className}
      />
      <button
        onClick={handleSave}
        disabled={!isDirty}
        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                    ${
                      isDirty
                        ? "bg-stone-200 text-stone-900 hover:bg-white shadow-sm"
                        : "bg-white/5 text-stone-600 cursor-not-allowed"
                    }
                `}
      >
        <Save size={14} />
        {isDirty ? t("common.save") : t("common.saved")}
      </button>
    </div>
  );
};
