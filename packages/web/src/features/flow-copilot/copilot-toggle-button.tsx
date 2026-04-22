import React from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopilotStore } from './copilot-store';
import { platformHooks } from '@/hooks/platform-hooks';

export function CopilotToggleButton() {
  const { platform } = platformHooks.useCurrentPlatform();
  const toggle = useCopilotStore((s) => s.toggle);
  if (!platform.plan.copilotEnabled) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      data-testid="copilot-toggle"
      aria-label="Open Flow Copilot"
    >
      <Bot className="size-4 mr-1" />
      Copilot
    </Button>
  );
}
