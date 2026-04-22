import React from 'react';
import { Button } from '@/components/ui/button';
import { Undo2, History } from 'lucide-react';

export function SummaryCard(props: {
  text: string;
  appliedCount: number;
  questions: string[];
  showResetToSnapshot: boolean;
  onUndoCopilotOnly: () => void;
  onResetToSnapshot: () => void;
}) {
  return (
    <div
      className="border rounded-md p-3 bg-primary/5 my-2 space-y-2"
      data-testid="copilot-summary-card"
    >
      <div className="text-sm whitespace-pre-wrap">{props.text}</div>
      {props.appliedCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {props.appliedCount} {props.appliedCount === 1 ? 'modifica' : 'modifiche'} applicat{props.appliedCount === 1 ? 'a' : 'e'}.
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
