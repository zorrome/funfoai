import React from 'react';
import { cn } from '../../components/ui/utils';

export type WorkspaceMode = 'create' | 'edit' | 'rewrite';

export interface WorkspaceModeMeta {
  label: string;
  hint: string;
}

interface ModeSwitcherProps {
  value: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  getMeta: (mode: WorkspaceMode) => WorkspaceModeMeta;
  disabled?: boolean;
}

export default function ModeSwitcher({ value, onChange, getMeta, disabled = false }: ModeSwitcherProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['create', 'edit', 'rewrite'] as WorkspaceMode[]).map(mode => {
        const meta = getMeta(mode);
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={cn(
              'px-3 py-1.5 rounded-full border text-xs transition-colors',
              active
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-700',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            title={meta.hint}
          >
            {meta.label}
          </button>
        );
      })}
      <span className="text-xs text-muted-foreground">{getMeta(value).hint}</span>
    </div>
  );
}
