import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  FileImage,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  MAX_DATESHEET_FILES,
  MAX_DATESHEET_TOTAL_BYTES,
  computeResizedImageDimensions,
  validateDatesheetUploadBatch,
} from '../../utils/datesheetEngine';
import type {
  AnalyzeDatesheetResponsePayload,
  DatesheetUploadAttachment,
} from '../../types/datesheet';
import { AiApiClientError, analyzeDatesheetFiles } from '../../api/client';
import { Button } from '../common/Button';
import { Card } from '../common/Card';

interface SelectedPreviewFile {
  id: string;
  file: File;
  objectUrl: string;
  attachment: DatesheetUploadAttachment;
}

interface DatesheetUploadPanelProps {
  studentBoard?: string;
  studentClassGrade?: string;
  onAnalysisComplete: (result: AnalyzeDatesheetResponsePayload) => void;
  onCancel?: () => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Unable to read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageForDatesheet(
  file: File,
  mimeType: string
): Promise<{ file: File; mimeType: string }> {
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    (mimeType !== 'image/jpeg' && mimeType !== 'image/png') ||
    file.size <= 900 * 1024
  ) {
    return { file, mimeType };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    const scaled = computeResizedImageDimensions(img.naturalWidth, img.naturalHeight, 2048);
    if (!scaled.resized && file.size <= 1_400 * 1024) {
      return { file, mimeType };
    }

    const canvas = document.createElement('canvas');
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, mimeType };

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88)
    );
    if (!blob || blob.size >= file.size) {
      return { file, mimeType };
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'datesheet';
    const optimizedFile = new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
    return { file: optimizedFile, mimeType: 'image/jpeg' };
  } catch {
    return { file, mimeType };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const DatesheetUploadPanel: React.FC<DatesheetUploadPanelProps> = ({
  studentBoard,
  studentClassGrade,
  onAnalysisComplete,
  onCancel,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<SelectedPreviewFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStepLabel, setAnalysisStepLabel] = useState<string>('');
  const [previewPdfExpanded, setPreviewPdfExpanded] = useState(false);

  const selectedFilesRef = useRef<SelectedPreviewFile[]>([]);
  selectedFilesRef.current = selectedFiles;

  useEffect(() => {
    return () => {
      for (const item of selectedFilesRef.current) {
        URL.revokeObjectURL(item.objectUrl);
      }
    };
  }, []);

  const totalSizeBytes = useMemo(
    () => selectedFiles.reduce((acc, f) => acc + f.attachment.sizeBytes, 0),
    [selectedFiles]
  );

  const hasPdf = selectedFiles.some((f) => f.attachment.mimeType === 'application/pdf');

  const handleFilesAdded = async (incomingList: FileList | File[]) => {
    setValidationError(null);
    setErrorCode(null);
    setErrorRetryable(false);
    const incoming = Array.from(incomingList);
    if (incoming.length === 0) return;

    try {
      const newAttachments: Array<{
        file: File;
        attachment: DatesheetUploadAttachment;
      }> = [];

      for (const file of incoming) {
        const lowerName = file.name.toLowerCase();
        let mimeType = file.type.toLowerCase();
        if (!mimeType) {
          if (lowerName.endsWith('.pdf')) mimeType = 'application/pdf';
          else if (lowerName.endsWith('.png')) mimeType = 'image/png';
          else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
          }
        }
        if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

        const optimized = await optimizeImageForDatesheet(file, mimeType);
        const dataBase64 = await readFileAsBase64(optimized.file);
        newAttachments.push({
          file: optimized.file,
          attachment: {
            fileName: optimized.file.name,
            mimeType: optimized.mimeType as DatesheetUploadAttachment['mimeType'],
            sizeBytes: optimized.file.size,
            pageCount: 1,
            dataBase64,
          },
        });
      }

      // If uploading a PDF, replace current batch or validate combined batch cleanly
      const incomingHasPdf = newAttachments.some(
        (item) => item.attachment.mimeType === 'application/pdf'
      );
      const combinedInputs = incomingHasPdf
        ? newAttachments
        : [
            ...selectedFiles.map((s) => ({ file: s.file, attachment: s.attachment })),
            ...newAttachments,
          ];

      const check = validateDatesheetUploadBatch(combinedInputs.map((i) => i.attachment));
      if (!check.valid || !check.sanitizedFiles) {
        setValidationError(
          check.error || 'Selected file(s) could not be validated as a PDF or JPG/PNG datesheet.'
        );
        return;
      }

      if (incomingHasPdf) {
        for (const old of selectedFiles) {
          URL.revokeObjectURL(old.objectUrl);
        }
      }

      const nextList: SelectedPreviewFile[] = check.sanitizedFiles.map((sanitized, idx) => {
        const sourceItem = combinedInputs[idx];
        const existingMatch = !incomingHasPdf
          ? selectedFiles.find((s) => s.file === sourceItem.file)
          : undefined;
        return {
          id:
            existingMatch?.id ||
            `file_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          file: sourceItem.file,
          objectUrl: existingMatch?.objectUrl || URL.createObjectURL(sourceItem.file),
          attachment: sanitized,
        };
      });

      setSelectedFiles(nextList);
      setPreviewPdfExpanded(false);
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error ? err.message : 'Unable to process the selected files.'
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = (id: string) => {
    setValidationError(null);
    setErrorCode(null);
    setErrorRetryable(false);
    setSelectedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) {
        URL.revokeObjectURL(target.objectUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleClearAll = () => {
    setValidationError(null);
    setErrorCode(null);
    setErrorRetryable(false);
    for (const item of selectedFiles) {
      URL.revokeObjectURL(item.objectUrl);
    }
    setSelectedFiles([]);
    setPreviewPdfExpanded(false);
  };

  const handleAnalyze = async () => {
    setValidationError(null);
    setErrorCode(null);
    setErrorRetryable(false);
    if (selectedFiles.length === 0) {
      setValidationError('Please upload a datesheet PDF or JPG/PNG image(s) before analyzing.');
      return;
    }

    const batchCheck = validateDatesheetUploadBatch(selectedFiles.map((f) => f.attachment));
    if (!batchCheck.valid || !batchCheck.sanitizedFiles) {
      setValidationError(batchCheck.error || 'Invalid datesheet upload batch.');
      return;
    }

    setAnalyzing(true);
    setAnalysisStepLabel('Sending datesheet to Gemini AI...');

    const progressTimer = window.setTimeout(() => {
      setAnalysisStepLabel('Extracting subjects, dates, timings, instructions & checks...');
    }, 2800);

    try {
      const result = await analyzeDatesheetFiles({
        files: batchCheck.sanitizedFiles,
        studentBoard,
        studentClassGrade,
      });
      onAnalysisComplete(result);
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error
          ? err.message
          : 'Failed to analyze the uploaded datesheet. Please retry with a clearer file.'
      );
      if (err instanceof AiApiClientError) {
        setErrorCode(
          err.statusCode > 0 ? `HTTP ${err.statusCode} • ${err.code}` : err.code
        );
        setErrorRetryable(err.retryable);
      } else {
        setErrorCode(null);
        setErrorRetryable(false);
      }
    } finally {
      window.clearTimeout(progressTimer);
      setAnalyzing(false);
      setAnalysisStepLabel('');
    }
  };

  return (
    <Card className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Step 1 • Upload Official Datesheet
          </p>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
            Upload PDF or Image Pages
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Upload a single PDF (multi-page supported) or up to {MAX_DATESHEET_FILES} JPG/PNG pages
            (max {Math.round(MAX_DATESHEET_TOTAL_BYTES / (1024 * 1024))} MB total).
          </p>
        </div>

        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={analyzing}>
            Cancel
          </Button>
        )}
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!analyzing) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!analyzing && e.dataTransfer.files) {
            void handleFilesAdded(e.dataTransfer.files);
          }
        }}
        className={`relative rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-all ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-500/10'
            : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 hover:border-indigo-400 dark:hover:border-indigo-500/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple={!hasPdf}
          disabled={analyzing}
          onChange={(e) => {
            if (e.target.files) void handleFilesAdded(e.target.files);
          }}
          className="sr-only"
          id="datesheet-file-upload"
        />

        <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center mb-3">
          <Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>

        <p className="text-sm font-bold text-slate-900 dark:text-white">
          Drag &amp; drop your exam datesheet here
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Supports official school/board PDFs, scanned schedules, or clear phone photos (JPG, PNG)
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={analyzing}
            onClick={() => fileInputRef.current?.click()}
            icon={<Upload className="w-3.5 h-3.5" />}
          >
            {selectedFiles.length > 0 && !hasPdf ? 'Add More Pages' : 'Choose Datesheet File(s)'}
          </Button>
          {selectedFiles.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={analyzing}
              onClick={handleClearAll}
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Clear Selection
            </Button>
          )}
        </div>
      </div>

      {validationError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {errorCode && (
                <p className="font-mono-num text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  {errorCode}
                </p>
              )}
              <p>{validationError}</p>
            </div>
          </div>
          {errorRetryable && selectedFiles.length > 0 && !analyzing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleAnalyze()}
              className="shrink-0 bg-white dark:bg-slate-900"
            >
              Retry Analysis
            </Button>
          )}
        </div>
      )}

      {/* Selected File Previews */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold">
              Selected {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'}
            </span>
            <span className="font-mono-num">
              Total size: {formatFileSize(totalSizeBytes)} / 6.00 MB
            </span>
          </div>

          {hasPdf ? (
            <div className="space-y-3">
              {selectedFiles.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {item.attachment.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                          PDF • ~{item.attachment.pageCount} page
                          {item.attachment.pageCount === 1 ? '' : 's'} •{' '}
                          {formatFileSize(item.attachment.sizeBytes)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewPdfExpanded((prev) => !prev)}
                      >
                        {previewPdfExpanded ? 'Hide Preview' : 'Preview PDF'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(item.id)}
                        disabled={analyzing}
                        aria-label={`Remove ${item.attachment.fileName}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {previewPdfExpanded && (
                    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-80">
                      <iframe
                        src={item.objectUrl}
                        title={`Preview of ${item.attachment.fileName}`}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {selectedFiles.map((item, idx) => (
                <div
                  key={item.id}
                  className="rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col"
                >
                  <div className="relative h-44 bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                    <img
                      src={item.objectUrl}
                      alt={`Datesheet page ${idx + 1}: ${item.attachment.fileName}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/75 text-white text-[10px] font-bold font-mono-num">
                      Page {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(item.id)}
                      disabled={analyzing}
                      aria-label={`Remove ${item.attachment.fileName}`}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-950/75 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-2.5 flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileImage className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                        {item.attachment.fileName}
                      </span>
                    </div>
                    <span className="text-slate-500 font-mono-num shrink-0">
                      {formatFileSize(item.attachment.sizeBytes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Analyze Trigger */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {analyzing ? (
                <span className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {analysisStepLabel || 'Analyzing datesheet...'}
                </span>
              ) : (
                <span>
                  Gemini extracts subjects, dates, weekdays, timings &amp; rules for you to verify.
                </span>
              )}
            </div>

            <Button
              type="button"
              variant="primary"
              size="lg"
              loading={analyzing}
              onClick={handleAnalyze}
              icon={<Sparkles className="w-4 h-4" />}
            >
              {analyzing ? 'Extracting Datesheet...' : 'Analyze Datesheet with AI'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
