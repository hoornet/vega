import { useState } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Frequent", emojis: ["😂", "❤️", "🔥", "👍", "🤙", "⚡", "🫡", "👀", "🙏", "😎", "🎉", "💯"] },
  { label: "Faces", emojis: ["😀", "😁", "😅", "🤣", "😊", "😇", "🥰", "😍", "🤩", "😘", "😜", "🤔", "😏", "😢", "😤", "🤯", "😱", "🥺", "😴", "🤡"] },
  { label: "Gestures", emojis: ["👋", "🤝", "👏", "🤟", "✌️", "🤞", "💪", "🙌", "👊", "✊", "🫶", "🫂"] },
  { label: "Objects", emojis: ["☕", "🍺", "🎵", "📝", "💡", "🔑", "🛠️", "📌", "🏆", "🎯", "🚀", "💎"] },
  { label: "Symbols", emojis: ["✅", "❌", "⭐", "💜", "💙", "💚", "🧡", "🤍", "🖤", "♾️", "🏴", "🤖"] },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [group, setGroup] = useState(0);

  return (
    <>
      <div className="fixed inset-0 z-[9]" onClick={onClose} />
      <div className="absolute bottom-7 left-0 bg-bg-raised border border-border shadow-lg z-10 w-64">
        {/* Group tabs */}
        <div className="flex border-b border-border">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.label}
              onClick={() => setGroup(i)}
              className={`flex-1 px-1 py-1.5 text-[9px] transition-colors ${
                group === i ? "text-accent border-b border-accent" : "text-text-dim hover:text-text"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        {/* Emoji grid */}
        <div className="grid grid-cols-8 gap-0.5 p-2">
          {EMOJI_GROUPS[group].emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onSelect(emoji); onClose(); }}
              className="text-[18px] hover:scale-125 transition-transform p-0.5 text-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
