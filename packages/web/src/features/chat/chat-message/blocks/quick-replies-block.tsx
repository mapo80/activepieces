import { QuickRepliesBlock as QuickRepliesBlockType } from '@activepieces/shared';
import React, { useState } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  block: QuickRepliesBlockType;
  onPick?: (payload: string) => void;
}

const STYLE_CLASSES: Record<string, string> = {
  default: 'border border-border bg-background hover:bg-muted',
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

export const QuickRepliesBlock: React.FC<Props> = ({ block, onPick }) => {
  const [clicked, setClicked] = useState<string | null>(null);

  const handlePick = (reply: QuickRepliesBlockType['replies'][number]) => {
    if (clicked !== null) return;
    setClicked(reply.payload);
    onPick?.(reply.payload);
  };

  return (
    <div className="my-1 flex flex-wrap gap-2">
      {block.replies.map((reply) => (
        <button
          key={reply.payload}
          disabled={clicked !== null && clicked !== reply.payload}
          onClick={() => handlePick(reply)}
          className={cn(
            'rounded-full px-3 py-1 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed',
            clicked === reply.payload
              ? 'bg-primary-100 text-primary hover:bg-primary-100'
              : STYLE_CLASSES[reply.style ?? 'default'],
          )}
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
};
