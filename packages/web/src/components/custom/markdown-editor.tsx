import { markdown } from '@codemirror/lang-markdown';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import CodeMirror, { EditorState, EditorView } from '@uiw/react-codemirror';
import React from 'react';

import { useTheme } from '@/components/providers/theme-provider';
import { cn } from '@/lib/utils';

const baseTheme = EditorView.baseTheme({
  '&.cm-editor.cm-focused': {
    outline: 'none',
  },
  '&.cm-editor': {
    fontSize: '13px',
  },
});

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
  const editorTheme = theme === 'dark' ? githubDark : githubLight;
  const extensions = [
    baseTheme,
    EditorState.readOnly.of(readonly),
    EditorView.editable.of(!readonly),
    EditorView.lineWrapping,
    markdown(),
  ];
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-background',
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={editorTheme}
        height="100%"
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          bracketMatching: false,
          indentOnInput: false,
          autocompletion: false,
          searchKeymap: false,
        }}
        placeholder={placeholder}
      />
    </div>
  );
};
