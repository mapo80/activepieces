import MDEditor from '@uiw/react-md-editor';
import React from 'react';

import { useTheme } from '@/components/providers/theme-provider';
import { cn } from '@/lib/utils';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  className?: string;
  placeholder?: string;
  minHeight?: string;
};

export const MarkdownEditor: React.FC<Props> = ({
  value,
  onChange,
  readonly = false,
  className,
  placeholder,
  minHeight = '360px',
}) => {
  const { theme } = useTheme();
  const colorMode = theme === 'dark' ? 'dark' : 'light';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border',
        className,
      )}
      data-color-mode={colorMode}
      data-testid="markdown-editor"
    >
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        preview={readonly ? 'preview' : 'live'}
        visibleDragbar={false}
        height="100%"
        minHeight={parseInt(minHeight, 10) || 360}
        textareaProps={{
          placeholder,
          readOnly: readonly,
          spellCheck: false,
        }}
      />
    </div>
  );
};
