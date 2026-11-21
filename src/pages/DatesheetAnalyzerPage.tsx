import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Edit3,
  FileText,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  deleteExamDatesheet,
  fetchExamDatesheets,
  logExamActivity,
  saveExamDatesheet,
} from '../lib/firestoreService';
import type {
  AnalyzeDatesheetResponsePayload,
  DatesheetMetadata,
  DatesheetSourceFileMeta,
  ExtractedExamEntry,
  SavedDatesheet,
} from '../types/datesheet';
import { formatDisplayDate } from '../utils/datesheetEngine';
import { DatesheetUploadPanel } from '../components/datesheet/DatesheetUploadPanel';
import { DatesheetEditorPanel } from '../components/datesheet/DatesheetEditorPanel';
import { DatesheetViewsPanel } from '../components/datesheet/DatesheetViewsPanel';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

type WorkspaceMode = 'upload' | 'edit' | 'view';

export const DatesheetAnalyzerPage: React.FC = () => {
  const { user } = useAuth();

  const [savedDatesheets, setSavedDatesheets] = useState<SavedDatesheet[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>('upload');

  // Working Draft / Editor state
  const [draftId, setDraftId] = useState<string>('');
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [draftMetadata, setDraftMetadata] = useState<DatesheetMetadata>({
    examName: '',
    board: user?.board || 'CBSE',
    classGrade: user?.classGrade || 'Class 10',
    academicSession: '',
    importantInstructions: [],
    isUncertain: false,
    uncertaintyReasons: [],
  });
  const [draftEntries, setDraftEntries] = useState<ExtractedExamEntry[]>([]);
  const [draftSourceFiles, setDraftSourceFiles] = useState<DatesheetSourceFileMeta[]>([]);
  const [draftCreatedAt, setDraftCreatedAt] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedDatesheet | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hydrateDraftFromSaved = useCallback((ds: SavedDatesheet) => {
    setDraftId(ds.id);
    setDraftTitle(ds.title);
    setDraftMetadata(ds.metadata);
    setDraftEntries(ds.entries);
    setDraftSourceFiles(ds.sourceFiles || []);
    setDraftCreatedAt(ds.createdAt);
  }, []);

  const loadDatesheets = useCallback(async () => {
    if (!user?.uid) {
      setLoadingList(false);
      return;
    }
    try {
      const list = await fetchExamDatesheets(user.uid);
      setSavedDatesheets(list);

      if (list.length > 0) {
        const preferred =
          list.find((d) => d.id === selectedId) ||
          list.find((d) => d.status === 'confirmed') ||
          list[0];
        setSelectedId(preferred.id);
        hydrateDraftFromSaved(preferred);
        setMode(preferred.status === 'confirmed' ? 'view' : 'edit');
      } else {
        setSelectedId(null);
        setMode('upload');
      }
    } catch (err: unknown) {
      setPageError(
        err instanceof Error ? err.message : 'Unable to load saved exam datesheets.'
      );
    } finally {
      setLoadingList(false);
    }
  }, [user?.uid, selectedId, hydrateDraftFromSaved]);

  useEffect(() => {
    void loadDatesheets();
    // Load initial list once per user session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const activeSaved = savedDatesheets.find((d) => d.id === selectedId) || null;

  const handleStartNewUpload = () => {
    setPageError(null);
    setStatusNotice(null);
    setMode('upload');
  };

  const handleSelectSaved = (ds: SavedDatesheet) => {
    setPageError(null);
    setStatusNotice(null);
    setSelectedId(ds.id);
    hydrateDraftFromSaved(ds);
    setMode(ds.status === 'confirmed' ? 'view' : 'edit');
  };

  const handleAnalysisComplete = async (result: AnalyzeDatesheetResponsePayload) => {
    setPageError(null);
    setStatusNotice(
      'Datesheet extracted by AI. Please verify every subject, date, and timing before confirming.'
    );
    const newId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const resolvedTitle =
      result.metadata.examName?.trim() ||
      `${result.metadata.board || user?.board || 'Exam'} ${result.metadata.classGrade || user?.classGrade || ''} Datesheet`.trim();

    const nextDraft: SavedDatesheet = {
      id: newId,
      userId: user?.uid || '',
      title: resolvedTitle,
      status: 'draft',
      metadata: {
        ...result.metadata,
        examName: result.metadata.examName || resolvedTitle,
      },
      entries: result.entries,
      sourceFiles: result.sourceFiles,
      createdAt: now,
      updatedAt: now,
    };

    setDraftId(nextDraft.id);
    setDraftTitle(nextDraft.title);
    setDraftMetadata(nextDraft.metadata);
    setDraftEntries(nextDraft.entries);
    setDraftSourceFiles(nextDraft.sourceFiles);
    setDraftCreatedAt(now);
    setSelectedId(nextDraft.id);
    setMode('edit');

    if (user?.uid) {
      try {
        const persisted = await saveExamDatesheet(nextDraft);
        setSavedDatesheets((prev) => [
          persisted,
          ...prev.filter((d) => d.id !== persisted.id),
        ]);
        await logExamActivity({
          datesheetId: persisted.id,
          action: 'analyzed',
          title: `Analyzed ${persisted.title}`,
          detail: `Extracted ${persisted.entries.length} exam row${persisted.entries.length === 1 ? '' : 's'} from uploaded file(s).`,
        });
      } catch {
        // Student still retains local draft in editor to retry saving
      }
    }
  };

  const persistWorkingDatesheet = async (targetStatus: 'draft' | 'confirmed') => {
    if (!user?.uid) {
      setPageError('Please sign in to save your exam datesheet.');
      return;
    }
    setPageError(null);
    setStatusNotice(null);
    setSaving(true);

    try {
      const now = new Date().toISOString();
      const existing = savedDatesheets.find((d) => d.id === draftId);
      const isUpdatingConfirmed = existing?.status === 'confirmed' && targetStatus === 'confirmed';

      const payload: SavedDatesheet = {
        id: draftId || `ds_${Date.now()}`,
        userId: user.uid,
        title: draftTitle.trim() || draftMetadata.examName.trim() || 'Exam Datesheet',
        status: targetStatus,
        metadata: {
          ...draftMetadata,
          examName:
            draftTitle.trim() || draftMetadata.examName.trim() || 'Exam Datesheet',
        },
        entries: draftEntries,
        sourceFiles: draftSourceFiles,
        ...(targetStatus === 'confirmed' ? { confirmedAt: existing?.confirmedAt || now } : {}),
        createdAt: draftCreatedAt || existing?.createdAt || now,
        updatedAt: now,
      };

      const saved = await saveExamDatesheet(payload);
      setSavedDatesheets((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)]);
      setSelectedId(saved.id);
      hydrateDraftFromSaved(saved);

      await logExamActivity({
        datesheetId: saved.id,
        action:
          targetStatus === 'confirmed'
            ? isUpdatingConfirmed
              ? 'updated'
              : 'confirmed'
            : 'saved_draft',
        title:
          targetStatus === 'confirmed'
            ? isUpdatingConfirmed
              ? `Updated ${saved.title}`
              : `Confirmed ${saved.title}`
            : `Saved draft: ${saved.title}`,
        detail: `${saved.entries.length} scheduled paper${saved.entries.length === 1 ? '' : 's'}.`,
      });

      if (targetStatus === 'confirmed') {
        setStatusNotice('Datesheet confirmed and synced across your Dashboard countdowns.');
        setMode('view');
      } else {
        setStatusNotice('Draft saved to your account.');
      }
    } catch (err: unknown) {
      setPageError(
        err instanceof Error ? err.message : 'Unable to save datesheet changes.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !user?.uid) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteExamDatesheet(user.uid, deleteTarget.id);
      await logExamActivity({
        datesheetId: deleteTarget.id,
        action: 'deleted',
        title: `Deleted ${deleteTarget.title}`,
        detail: 'Removed datesheet from student workspace.',
      }).catch(() => {});

      const remaining = savedDatesheets.filter((d) => d.id !== deleteTarget.id);
      setSavedDatesheets(remaining);
      setDeleteTarget(null);

      if (remaining.length > 0) {
        const next = remaining[0];
        setSelectedId(next.id);
        hydrateDraftFromSaved(next);
        setMode(next.status === 'confirmed' ? 'view' : 'edit');
      } else {
        setSelectedId(null);
        setMode('upload');
      }
    } catch (err: unknown) {
      setPageError(
        err instanceof Error ? err.message : 'Unable to delete this datesheet right now.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Module 01 • Active
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">
            Exam Datesheet Analyzer
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Upload your official PDF or image datesheet, validate dates &amp; timings, confirm your
            schedule, and track chronological countdowns and prep gaps.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleStartNewUpload}
          icon={<Plus className="w-4 h-4" />}
        >
          Upload New Datesheet
        </Button>
      </div>

      {/* Saved Datesheets Bar */}
      {!loadingList && savedDatesheets.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Saved Datesheets ({savedDatesheets.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedDatesheets.map((ds) => {
              const isSelected = ds.id === selectedId && mode !== 'upload';
              return (
                <div
                  key={ds.id}
                  onClick={() => handleSelectSaved(ds)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectSaved(ds);
                    }
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-500/15 border-indigo-400 dark:border-indigo-500/50'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge size="sm" variant={ds.status === 'confirmed' ? 'success' : 'warning'}>
                        {ds.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                      </Badge>
                      <span className="font-mono-num text-[10px] text-slate-500 dark:text-slate-400">
                        {ds.entries.length} papers
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {ds.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {ds.metadata.board || 'Board'} • {ds.metadata.classGrade || 'Class'} • Updated{' '}
                      {formatDisplayDate(ds.updatedAt.slice(0, 10))}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(ds);
                    }}
                    aria-label={`Delete ${ds.title}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-slate-900 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {pageError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{pageError}</span>
        </div>
      )}

      {statusNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{statusNotice}</span>
        </div>
      )}

      {loadingList ? (
        <Card className="py-12 text-center">
          <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="w-4 h-4 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
            <span>Loading your exam datesheets...</span>
          </div>
        </Card>
      ) : mode === 'upload' ? (
        <DatesheetUploadPanel
          studentBoard={user?.board}
          studentClassGrade={user?.classGrade}
          onAnalysisComplete={handleAnalysisComplete}
          onCancel={
            savedDatesheets.length > 0 && activeSaved
              ? () => setMode(activeSaved.status === 'confirmed' ? 'view' : 'edit')
              : undefined
          }
        />
      ) : mode === 'edit' ? (
        <DatesheetEditorPanel
          title={draftTitle}
          onTitleChange={setDraftTitle}
          metadata={draftMetadata}
          onMetadataChange={setDraftMetadata}
          entries={draftEntries}
          onEntriesChange={setDraftEntries}
          isSaving={saving}
          onSaveDraft={() => void persistWorkingDatesheet('draft')}
          onConfirmAndSave={() => void persistWorkingDatesheet('confirmed')}
          onReupload={handleStartNewUpload}
        />
      ) : activeSaved ? (
        <div className="space-y-4">
          <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success" size="sm">
                  Confirmed Schedule
                </Badge>
                {activeSaved.metadata.board && (
                  <Badge variant="purple" size="sm">
                    {activeSaved.metadata.board}
                  </Badge>
                )}
                {activeSaved.metadata.classGrade && (
                  <Badge variant="default" size="sm">
                    {activeSaved.metadata.classGrade}
                  </Badge>
                )}
                {activeSaved.metadata.academicSession && (
                  <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                    Session {activeSaved.metadata.academicSession}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                {activeSaved.title}
              </h2>
              {activeSaved.sourceFiles && activeSaved.sourceFiles.length > 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  Source: {activeSaved.sourceFiles.map((f) => f.fileName).join(', ')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  hydrateDraftFromSaved(activeSaved);
                  setMode('edit');
                }}
                icon={<Edit3 className="w-3.5 h-3.5" />}
              >
                Edit Datesheet
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(activeSaved)}
                icon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
              >
                Delete
              </Button>
            </div>
          </Card>

          <DatesheetViewsPanel datesheet={activeSaved} />
        </div>
      ) : (
        <DatesheetUploadPanel
          studentBoard={user?.board}
          studentClassGrade={user?.classGrade}
          onAnalysisComplete={handleAnalysisComplete}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Datesheet?"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Are you sure you want to delete{' '}
            <strong className="text-slate-900 dark:text-white">{deleteTarget?.title}</strong>? This
            removes the schedule and its Dashboard countdowns permanently.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              Delete Datesheet
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
