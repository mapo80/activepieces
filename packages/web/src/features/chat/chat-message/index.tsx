import { Block, FileResponseInterface } from '@activepieces/shared';
import React from 'react';

import { DataListBlock } from './blocks/data-list-block';
import { QuickRepliesBlock } from './blocks/quick-replies-block';
import { FileMessage } from './file-message';
import { ImageMessage } from './image-message';
import { TextMessage } from './text-message';

interface MultiMediaMessageProps {
  textContent?: string;
  role: 'user' | 'bot';
  attachments?: FileResponseInterface[];
  blocks?: Block[];
  setSelectedImage: (image: string | null) => void;
  onPick?: (payload: string) => void;
}

export const MultiMediaMessage: React.FC<MultiMediaMessageProps> = ({
  textContent,
  role,
  attachments,
  blocks,
  setSelectedImage,
  onPick,
}) => {
  return (
    <div className="flex flex-col gap-2">
      {/* Text content */}
      {textContent && <TextMessage content={textContent} role={role} />}

      {/* Blocks-v1 (data-list, quick-replies, ...) */}
      {blocks && blocks.length > 0 && (
        <div className="flex flex-col gap-2">
          {blocks.map((block, index) => (
            <BlockRenderer
              key={index}
              block={block}
              role={role}
              onPick={onPick}
            />
          ))}
        </div>
      )}

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          {attachments.map((attachment, index) => {
            if ('url' in attachment && 'mimeType' in attachment) {
              const isImage = attachment.mimeType?.startsWith('image/');
              return isImage ? (
                <ImageMessage
                  key={index}
                  content={attachment.url}
                  setSelectedImage={setSelectedImage}
                />
              ) : (
                <FileMessage
                  key={index}
                  content={attachment.url}
                  mimeType={attachment.mimeType}
                  fileName={attachment.fileName}
                  role={role}
                />
              );
            }
          })}
        </div>
      )}
    </div>
  );
};

const BlockRenderer: React.FC<{
  block: Block;
  role: 'user' | 'bot';
  onPick?: (payload: string) => void;
}> = ({ block, role, onPick }) => {
  switch (block.type) {
    case 'text':
      return <TextMessage content={block.value} role={role} />;
    case 'data-list':
      return <DataListBlock block={block} onPick={onPick} />;
    case 'quick-replies':
      return <QuickRepliesBlock block={block} onPick={onPick} />;
    default:
      return null;
  }
};
