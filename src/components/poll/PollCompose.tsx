import { Button } from "../shared/Button";
import { Plus } from "lucide-react";

interface PollComposeProps {
  options: string[];
  onChange: (options: string[]) => void;
}

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;

export function PollCompose({ options, onChange }: PollComposeProps) {
  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    onChange(next);
  };

  const removeOption = (index: number) => {
    if (options.length <= MIN_OPTIONS) return;
    onChange(options.filter((_, i) => i !== index));
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    onChange([...options, ""]);
  };

  return (
    <div className="border-t border-border-subtle pt-2 mt-2 space-y-1.5">
      <div className="text-text-dim text-caption mb-1">Poll options</div>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={opt}
            onChange={(e) => updateOption(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
            className="flex-1 bg-transparent border border-border-strong rounded-lg px-2 py-1 text-text text-ui placeholder:text-text-dim focus:outline-none focus:border-accent"
            maxLength={100}
          />
          {options.length > MIN_OPTIONS && (
            <button
              onClick={() => removeOption(i)}
              className="text-text-dim hover:text-danger text-[12px] px-1 transition-colors shrink-0"
              title="Remove option"
            >
              &#10005;
            </button>
          )}
        </div>
      ))}
      {options.length < MAX_OPTIONS && (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={addOption}><Plus />Add option</Button>
      )}
    </div>
  );
}
