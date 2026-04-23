import {
  AlertTriangle,
  CheckCircle2,
  History,
  Undo2,
  XCircle,
} from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { CopilotMarkdown } from './copilot-markdown';

type Status = 'success' | 'partial' | 'error' | 'info';

export function SummaryCard(props: {
  status: Status;
  text: string;
  appliedCount: number;
  failedAttempts: number;
  questions: string[];
  showResetToSnapshot: boolean;
  onUndoCopilotOnly: () => void;
  onResetToSnapshot: () => void;
}) {
  // Conversational turn (greetings, clarifying questions): the assistant
  // already rendered the reply in the normal message bubble. Suppress the
  // summary card — there's nothing to summarize and a generic "success"
  // frame would be misleading.
  if (props.status === 'info') return null;
  const tone = STATUS_STYLES[props.status];
  const Icon = tone.icon;
  return (
    <div
      className={cn('border rounded-md p-3 my-2 space-y-2', tone.container)}
      data-testid={`copilot-summary-${props.status}`}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-sm font-medium',
          tone.heading,
        )}
      >
        <Icon className="size-4" />
        {tone.title}
      </div>
      <CopilotMarkdown content={props.text} />
      {props.appliedCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {props.appliedCount}{' '}
          {props.appliedCount === 1 ? 'modifica' : 'modifiche'} applicat
          {props.appliedCount === 1 ? 'a' : 'e'}
          {props.failedAttempts > 0 && (
            <>
              {' '}
              ({props.failedAttempts}{' '}
              {props.failedAttempts === 1 ? 'tentativo' : 'tentativi'}{' '}
              auto-corretti)
            </>
          )}
          .
        </div>
      )}
      {props.questions.length > 0 && (
        <ul className="list-disc list-inside text-xs">
          {props.questions.map((q, idx) => (
            <li key={idx}>{q}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={props.onUndoCopilotOnly}
          data-testid="copilot-undo-copilot-only"
        >
          <Undo2 className="size-4 mr-1" />
          Annulla solo le modifiche del copilot
        </Button>
        {props.showResetToSnapshot && (
          <Button
            size="sm"
            variant="destructive"
            onClick={props.onResetToSnapshot}
            data-testid="copilot-reset-snapshot"
          >
            <History className="size-4 mr-1" />
            Ripristina stato iniziale
          </Button>
        )}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<
  Exclude<Status, 'info'>,
  {
    container: string;
    heading: string;
    icon: typeof CheckCircle2;
    title: string;
  }
> = {
  success: {
    container: 'border-green-600/50 bg-green-50 dark:bg-green-950/20',
    heading: 'text-green-700 dark:text-green-400',
    icon: CheckCircle2,
    title: 'Flow pronto',
  },
  partial: {
    container: 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/20',
    heading: 'text-amber-700 dark:text-amber-400',
    icon: AlertTriangle,
    title: 'Flow creato con correzioni',
  },
  error: {
    container: 'border-red-600/50 bg-red-50 dark:bg-red-950/20',
    heading: 'text-red-700 dark:text-red-400',
    icon: XCircle,
    title: 'Operazione non completata',
  },
};
