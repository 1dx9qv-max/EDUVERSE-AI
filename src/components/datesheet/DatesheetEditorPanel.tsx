import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  FilePlus2,
  Info,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  DatesheetMetadata,
  DatesheetValidationWarning,
  ExamEntryType,
  ExtractedExamEntry,
} from '../../types/datesheet';
import {
  canConfirmDatesheet,
  getExpectedWeekday,
  sortExamEntriesChronologically,
  validateExtractedDatesheet,
} from '../../utils/datesheetEngine';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input } from '../common/Input';

interface DatesheetEditorPanelProps {
  title: string;
  onTitleChange: (title: string) => void;
  metadata: DatesheetMetadata;
  onMetadataChange: (metadata: DatesheetMetadata) => void;
  entries: ExtractedExamEntry[];
  onEntriesChange: (entries: ExtractedExamEntry[]) => void;
  isSaving: boolean;
  onSaveDraft: () => void;
  onConfirmAndSave: () => void;
  onReupload?: () => void;
}

export const DatesheetEditorPanel: React.FC<DatesheetEditorPanelProps> = ({
  title,
  onTitleChange,
  metadata,
  onMetadataChange,
  entries,
  onEntriesChange,
  isSaving,
  onSaveDraft,
  onConfirmAndSave,
  onReupload,
}) => {
  const [newInstruction, setNewInstruction] = useState('');

  const warnings: DatesheetValidationWarning[] = useMemo(
    () => validateExtractedDatesheet(metadata, entries),
    [metadata, entries]
  );

  const confirmGate = useMemo(
    () => canConfirmDatesheet(metadata, entries, warnings),
    [metadata, entries, warnings]
  );

  const updateEntry = (entryId: string, patch: Partial<ExtractedExamEntry>) => {
    onEntriesChange(
      entries.map((item) => (item.id === entryId ? { ...item, ...patch } : item))
    );
  };

  const addEmptyEntry = () => {
    const newEntry: ExtractedExamEntry = {
      id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      subject: '',
      subjectCode: '',
      date: '',
      weekday: '',
      startTime: '',
      endTime: '',
      rawTimeText: '',
      entryType: 'theory',
      notes: '',
      isUncertain: false,
    };
    onEntriesChange([...entries, newEntry]);
  };

  const deleteEntry = (entryId: string) => {
    onEntriesChange(entries.filter((e) => e.id !== entryId));
  };

  const handleSortChronologically = () => {
    onEntriesChange(sortExamEntriesChronologically(entries));
  };

  const handleSyncWeekday = (entryId: string, dateStr: string) => {
    const expected = getExpectedWeekday(dateStr);
    if (!expected) return;
    updateEntry(entryId, { weekday: expected });
  };

  const handleAddInstruction = () => {
    const clean = newInstruction.trim();
    if (!clean) return;
    onMetadataChange({
      ...metadata,
      importantInstructions: [...metadata.importantInstructions, clean],
    });
    setNewInstruction('');
  };

  const handleRemoveInstruction = (index: number) => {
    onMetadataChange({
      ...metadata,
      importantInstructions: metadata.importantInstructions.filter((_, idx) => idx !== index),
    });
  };

  const errorWarnings = warnings.filter((w) => w.severity === 'error');
  const cautionWarnings = warnings.filter((w) => w.severity === 'warning');
  const infoWarnings = warnings.filter((w) => w.severity === 'info');

  return (
    <div className="space-y-6">
      {/* Header & Metadata Editor */}
      <Card className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Step 2 • Verify &amp; Edit Extracted Datesheet
            </p>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
              Review Every Subject, Date &amp; Timing
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onReupload && (
              <Button type="button" variant="outline" size="sm" onClick={onReupload}>
                Upload Different File
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSortChronologically}
              icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            >
              Sort by Date
            </Button>
          </div>
        </div>

        {metadata.isUncertain && metadata.uncertaintyReasons.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Header details marked uncertain by AI extraction:
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              {metadata.uncertaintyReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input
            label="Datesheet Title"
            placeholder="e.g. CBSE Class 10 Board 2026"
            value={title}
            onChange={(e) => {
              const val = e.target.value;
              onTitleChange(val);
              onMetadataChange({ ...metadata, examName: val });
            }}
            required
          />
          <Input
            label="Board"
            placeholder="CBSE / ICSE / State"
            value={metadata.board}
            onChange={(e) => onMetadataChange({ ...metadata, board: e.target.value })}
          />
          <Input
            label="Class / Grade"
            placeholder="Class 10 / Class 12"
            value={metadata.classGrade}
            onChange={(e) => onMetadataChange({ ...metadata, classGrade: e.target.value })}
          />
          <Input
            label="Academic Session"
            placeholder="e.g. 2025-26"
            value={metadata.academicSession}
            onChange={(e) =>
              onMetadataChange({ ...metadata, academicSession: e.target.value })
            }
          />
        </div>

        {/* Important Exam Instructions */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
            Extracted Datesheet Rules &amp; Instructions
          </label>
          {metadata.importantInstructions.length > 0 ? (
            <div className="space-y-1.5">
              {metadata.importantInstructions.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300"
                >
                  <span>{rule}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveInstruction(idx)}
                    aria-label="Remove instruction"
                    className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No special hall instructions listed yet.</p>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newInstruction}
              onChange={(e) => setNewInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddInstruction();
                }
              }}
              placeholder="Add an exam-hall instruction (e.g. Reach center by 9:45 AM)"
              className="flex-1 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleAddInstruction}>
              Add Rule
            </Button>
          </div>
        </div>
      </Card>

      {/* Validation Warnings Summary */}
      {warnings.length > 0 && (
        <Card className="space-y-3 border-amber-300 dark:border-amber-500/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Validation Checks ({errorWarnings.length} error{errorWarnings.length === 1 ? '' : 's'},{' '}
              {cautionWarnings.length} warning{cautionWarnings.length === 1 ? '' : 's'},{' '}
              {infoWarnings.length} notice{infoWarnings.length === 1 ? '' : 's'})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Fields are never auto-edited silently — review and approve any adjustments below.
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {warnings.map((w) => {
              const targetEntry = w.entryId
                ? entries.find((e) => e.id === w.entryId)
                : undefined;
              const expectedWeekday =
                w.code === 'WEEKDAY_MISMATCH' && targetEntry
                  ? getExpectedWeekday(targetEntry.date)
                  : null;

              const colorClass =
                w.severity === 'error'
                  ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/25 text-rose-800 dark:text-rose-200'
                  : w.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-200'
                    : 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/25 text-blue-800 dark:text-blue-200';

              return (
                <div
                  key={w.id}
                  className={`p-2.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${colorClass}`}
                >
                  <div className="flex items-start gap-2">
                    {w.severity === 'error' ? (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : w.severity === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{w.message}</span>
                  </div>

                  {expectedWeekday && targetEntry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 bg-white dark:bg-slate-900"
                      onClick={() => handleSyncWeekday(targetEntry.id, targetEntry.date)}
                      icon={<Wand2 className="w-3 h-3" />}
                    >
                      Sync to {expectedWeekday}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Exam Entries Editor */}
      <Card className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
              Extracted Exam Papers ({entries.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Edit subject names, subject codes, dates (YYYY-MM-DD), weekdays, and exam timings.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={addEmptyEntry}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Add Exam Row
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              No exam entries present
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add exam rows manually or upload a clearer datesheet file.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addEmptyEntry}
              icon={<FilePlus2 className="w-3.5 h-3.5" />}
            >
              Add First Exam Row
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, idx) => {
              const rowWarnings = warnings.filter((w) => w.entryId === entry.id);
              const hasRowError = rowWarnings.some((w) => w.severity === 'error');
              const expectedWeekday = getExpectedWeekday(entry.date);
              const weekdayMismatch =
                expectedWeekday &&
                entry.weekday.trim() &&
                expectedWeekday.toLowerCase() !== entry.weekday.trim().toLowerCase();

              return (
                <div
                  key={entry.id}
                  className={`p-4 rounded-xl border space-y-3 transition-colors ${
                    hasRowError
                      ? 'bg-rose-50/40 dark:bg-rose-950/10 border-rose-300 dark:border-rose-500/40'
                      : entry.isUncertain
                        ? 'bg-amber-50/40 dark:bg-amber-950/10 border-amber-300 dark:border-amber-500/40'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-num text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        #{idx + 1}
                      </span>
                      {entry.isUncertain && (
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {entry.uncertaintyReason || 'Uncertain extraction — please verify'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {entry.isUncertain && (
                        <button
                          type="button"
                          onClick={() =>
                            updateEntry(entry.id, { isUncertain: false, uncertaintyReason: '' })
                          }
                          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                        >
                          Mark Verified
                        </button>
                      )}
                      {weekdayMismatch && expectedWeekday && (
                        <button
                          type="button"
                          onClick={() => handleSyncWeekday(entry.id, entry.date)}
                          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          Sync Day ({expectedWeekday})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteEntry(entry.id)}
                        aria-label={`Delete ${entry.subject || `row ${idx + 1}`}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="lg:col-span-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Subject *
                      </label>
                      <input
                        type="text"
                        value={entry.subject}
                        onChange={(e) => updateEntry(entry.id, { subject: e.target.value })}
                        placeholder="e.g. Mathematics Standard"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Subject Code
                      </label>
                      <input
                        type="text"
                        value={entry.subjectCode || ''}
                        onChange={(e) => updateEntry(entry.id, { subjectCode: e.target.value })}
                        placeholder="e.g. 041"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Exam Date *
                      </label>
                      <input
                        type="date"
                        value={entry.date}
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          const autoWeekday =
                            !entry.weekday.trim() && nextDate ? getExpectedWeekday(nextDate) : null;
                          updateEntry(entry.id, {
                            date: nextDate,
                            ...(autoWeekday ? { weekday: autoWeekday } : {}),
                          });
                        }}
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-2 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Weekday
                      </label>
                      <input
                        type="text"
                        value={entry.weekday}
                        onChange={(e) => updateEntry(entry.id, { weekday: e.target.value })}
                        placeholder={expectedWeekday || 'e.g. Monday'}
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Paper Type
                      </label>
                      <select
                        value={entry.entryType}
                        onChange={(e) =>
                          updateEntry(entry.id, {
                            entryType: e.target.value as ExamEntryType,
                          })
                        }
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        <option value="theory">Theory</option>
                        <option value="practical">Practical</option>
                        <option value="optional">Optional</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Timing Label
                      </label>
                      <input
                        type="text"
                        value={entry.rawTimeText || ''}
                        onChange={(e) => updateEntry(entry.id, { rawTimeText: e.target.value })}
                        placeholder="e.g. 10:30 AM - 01:30 PM"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Start Time
                      </label>
                      <input
                        type="text"
                        value={entry.startTime || ''}
                        onChange={(e) => updateEntry(entry.id, { startTime: e.target.value })}
                        placeholder="10:30 AM"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        End Time
                      </label>
                      <input
                        type="text"
                        value={entry.endTime || ''}
                        onChange={(e) => updateEntry(entry.id, { endTime: e.target.value })}
                        placeholder="01:30 PM"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        Notes / Shift Info
                      </label>
                      <input
                        type="text"
                        value={entry.notes || ''}
                        onChange={(e) => updateEntry(entry.id, { notes: e.target.value })}
                        placeholder="Optional paper notes"
                        className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Confirmation Gate & Action Bar */}
      <Card className="space-y-4 border-indigo-200 dark:border-indigo-500/30">
        {!confirmGate.canConfirm && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-xs text-rose-700 dark:text-rose-300 space-y-1">
            <p className="font-bold">Resolve before confirming final datesheet:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {confirmGate.blockers.map((blocker, idx) => (
                <li key={idx}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            Save as a draft anytime, or confirm to activate live Dashboard countdowns and prep
            gap alerts.
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={isSaving}
              onClick={onSaveDraft}
              icon={<Save className="w-4 h-4" />}
            >
              Save Draft
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={isSaving}
              disabled={!confirmGate.canConfirm}
              onClick={onConfirmAndSave}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Confirm &amp; Save Datesheet
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
