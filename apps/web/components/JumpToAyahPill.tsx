'use client';

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function JumpToAyahPill({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      Jump to current ayah
    </button>
  );
}
