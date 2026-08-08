'use client';

import type { Script } from './QuranWord';

interface Props {
  script: Script;
  onChange: (script: Script) => void;
}

export function ScriptToggle({ script, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 text-sm">
      {(['tajweed', 'indopak'] as const).map(option => (
        <button
          key={option}
          type="button"
          aria-pressed={script === option}
          onClick={() => onChange(option)}
          className={`rounded-md px-3 py-1 capitalize ${
            script === option ? 'bg-neutral-900 text-white' : 'text-neutral-600'
          }`}
        >
          {option === 'tajweed' ? 'Tajweed' : 'IndoPak'}
        </button>
      ))}
    </div>
  );
}
