import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { importCharacterCard } from '../services/zeroclawService';

export interface UseCharacterImportDropOptions {
  onImported?: (fileName: string) => void;
  onError?: (message: string) => void;
}

export interface UseCharacterImportDropReturn {
  isDragging: boolean;
  rootHandlers: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

const SUPPORTED_EXTENSIONS = ['.png', '.json', '.webp'];

const hasFiles = (e: React.DragEvent): boolean =>
  Array.from(e.dataTransfer.types).includes('Files');

const isSupportedFile = (file: File): boolean => {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
};

export const useCharacterImportDrop = (
  opts: UseCharacterImportDropOptions
): UseCharacterImportDropReturn => {
  const [isDragging, setIsDragging] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Track drag depth so leaving a child element back to its parent doesn't
  // flip the overlay off while still inside the window. The dragenter/dragleave
  // pair fires per element; we increment on enter, decrement on leave, and
  // only clear when depth hits zero (i.e. pointer truly left the window).
  const depthRef = useRef(0);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragging) setIsDragging(true);
    },
    [isDragging]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    // relatedTarget is null when the pointer leaves the viewport entirely;
    // otherwise the drag moved between child elements of the root and we
    // should not react.
    if (e.relatedTarget !== null) return;
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depthRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(isSupportedFile);
    if (files.length === 0) {
      optsRef.current.onError?.('No supported files. Use PNG, JSON, or WebP character cards.');
      return;
    }

    const successes: string[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const result = await importCharacterCard(file);
      if (result.success) {
        successes.push(result.fileName ?? file.name);
      } else {
        failures.push(`${file.name}: ${result.error ?? 'import failed'}`);
      }
    }

    if (successes.length > 0) {
      const label =
        successes.length === 1 ? (successes[0] ?? 'character') : `${successes.length} characters`;
      optsRef.current.onImported?.(label);
    }
    if (failures.length > 0) {
      optsRef.current.onError?.(failures.join('\n'));
    }
  }, []);

  useEffect(() => {
    return () => {
      depthRef.current = 0;
      setIsDragging(false);
    };
  }, []);

  return {
    isDragging,
    rootHandlers: { onDragOver, onDragLeave, onDrop },
  };
};
