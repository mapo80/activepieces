import { PdfViewerBlock as PdfViewerBlockType } from '@activepieces/shared';
import { FileText, X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Button } from '@/components/ui/button';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  block: PdfViewerBlockType;
}

export const PdfViewerBlock: React.FC<Props> = ({ block }) => {
  const [open, setOpen] = useState(false);

  const dataUrl = useMemo(() => {
    if (block.base64 && block.base64.length > 0) {
      return `data:application/pdf;base64,${block.base64}`;
    }
    return block.url;
  }, [block.base64, block.url]);

  const fileName = block.fileName ?? 'documento.pdf';

  const handleDownload = useCallback(() => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [dataUrl, fileName]);

  if (!dataUrl) return null;

  return (
    <div className="my-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-6 w-6 shrink-0 text-red-500" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {fileName}
            </div>
            {block.title && (
              <div className="truncate text-xs text-muted-foreground">
                {block.title}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Anteprima
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
          >
            <Download className="mr-1 h-4 w-4" />
            Scarica
          </Button>
        </div>
      </div>
      {open && (
        <PdfModal
          dataUrl={dataUrl}
          fileName={fileName}
          onClose={() => setOpen(false)}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
};

interface PdfModalProps {
  dataUrl: string;
  fileName: string;
  onClose: () => void;
  onDownload: () => void;
}

const PdfModal: React.FC<PdfModalProps> = ({
  dataUrl,
  fileName,
  onClose,
  onDownload,
}) => {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="truncate text-sm font-medium">{fileName}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Chiudi anteprima"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          <div className="flex justify-center">
            <Document
              file={dataUrl}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              loading={
                <div className="py-8 text-sm text-muted-foreground">
                  Caricamento PDF…
                </div>
              }
              error={
                <div className="py-8 text-sm text-destructive">
                  Impossibile caricare il PDF.
                </div>
              }
            >
              <Page
                pageNumber={page}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                width={700}
              />
            </Document>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Pagina precedente"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Pagina {page} di {numPages || '—'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= numPages}
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
              aria-label="Pagina successiva"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button type="button" size="sm" onClick={onDownload}>
            <Download className="mr-1 h-4 w-4" />
            Scarica
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
