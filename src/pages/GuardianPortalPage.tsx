import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Flame,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Target,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchGuardianLinks,
  fetchGuardianStudentSummary,
  generateStudentGuardianCode,
  requestGuardianLink,
  updateGuardianLink,
} from '../api/client';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import {
  GuardianInviteCodeRecord,
  GuardianLinkRecord,
  GuardianPermissions,
  GuardianStudentSummary,
} from '../types/phase8';

const PERMISSION_LABELS: Array<{ key: keyof GuardianPermissions; label: string; desc: string }> = [
  {
    key: 'canViewProgress',
    label: 'Learning Progress & Streaks',
    desc: 'Daily study streak, verified XP cap progress, and topic mastery counts.',
  },
  {
    key: 'canViewGoals',
    label: 'Learning Goals Overview',
    desc: 'Personal academic targets and daily goal completion bars.',
  },
  {
    key: 'canViewAssessments',
    label: 'Exam Simulator Summaries',
    desc: 'Recent mock exam scores and subject percentages.',
  },
  {
    key: 'canReceiveAlerts',
    label: 'Safety & Milestone Alerts',
    desc: 'High-level milestone alerts without exposing private chat logs.',
  },
];

export const GuardianPortalPage: React.FC = () => {
  const { user } = useAuth();
  const isGuardianRole = user?.role === 'guardian';
  const isAdminRole = user?.role === 'admin';

  // Admin can toggle previewing student vs guardian side cleanly
  const [viewMode, setViewMode] = useState<'student' | 'guardian'>(
    isGuardianRole ? 'guardian' : 'student'
  );

  useEffect(() => {
    setViewMode(isGuardianRole ? 'guardian' : 'student');
  }, [isGuardianRole]);

  useEffect(() => {
    setActiveInvite(null);
    setNotice(null);
    setError(null);
    setInviteCodeInput('');
    setSelectedStudentUid(null);
    setStudentSummary(null);
    setSummaryError(null);
  }, [user?.uid]);

  const [asStudentLinks, setAsStudentLinks] = useState<GuardianLinkRecord[]>([]);
  const [asGuardianLinks, setAsGuardianLinks] = useState<GuardianLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Student invite code state
  const [activeInvite, setActiveInvite] = useState<GuardianInviteCodeRecord | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Guardian redeem & summary state
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [relationship, setRelationship] = useState<'parent' | 'guardian' | 'mentor'>('parent');
  const [selectedStudentUid, setSelectedStudentUid] = useState<string | null>(null);
  const [studentSummary, setStudentSummary] = useState<GuardianStudentSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGuardianLinks();
      setAsStudentLinks(data.asStudent);
      const guardianList = data.asGuardian.length > 0 ? data.asGuardian : data.allAdmin || [];
      setAsGuardianLinks(guardianList);
      if (guardianList.length > 0) {
        setSelectedStudentUid((prev) => prev || guardianList[0].studentUid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guardian relationships.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const loadStudentSummary = useCallback(async (studentUid: string) => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const summary = await fetchGuardianStudentSummary(studentUid);
      setStudentSummary(summary);
    } catch (err) {
      setStudentSummary(null);
      setSummaryError(err instanceof Error ? err.message : 'Unable to load student summary.');
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'guardian' && selectedStudentUid) {
      const selectedLink = asGuardianLinks.find((l) => l.studentUid === selectedStudentUid);
      if (selectedLink && selectedLink.status === 'verified') {
        loadStudentSummary(selectedStudentUid);
      } else {
        setStudentSummary(null);
        setSummaryError(null);
      }
    }
  }, [viewMode, selectedStudentUid, asGuardianLinks, loadStudentSummary]);

  const handleGenerateCode = async () => {
    setBusyKey('gen-code');
    setError(null);
    try {
      const invite = await generateStudentGuardianCode();
      setActiveInvite(invite);
      setNotice('Generated a single-use 48-hour verification code.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate invite code.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopyCode = async () => {
    if (!activeInvite) return;
    try {
      await navigator.clipboard.writeText(activeInvite.code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleStudentLinkAction = async (
    linkId: string,
    updates: { status?: 'verified' | 'revoked'; permissions?: Partial<GuardianPermissions> }
  ) => {
    setBusyKey(`link-${linkId}`);
    setError(null);
    try {
      const updated = await updateGuardianLink(linkId, updates);
      setAsStudentLinks((prev) => prev.map((l) => (l.id === linkId ? updated : l)));
      setNotice(
        updates.status
          ? `Guardian link for ${updated.guardianName} updated to ${updated.status}.`
          : `Privacy permissions updated for ${updated.guardianName}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update guardian permissions.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRedeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim()) return;
    setBusyKey('redeem-code');
    setError(null);
    try {
      const link = await requestGuardianLink({
        code: inviteCodeInput.trim().toUpperCase(),
        relationship,
      });
      setAsGuardianLinks((prev) => [link, ...prev.filter((l) => l.id !== link.id)]);
      setSelectedStudentUid(link.studentUid);
      setInviteCodeInput('');
      setNotice(
        `Link request sent for ${link.studentDisplayName}. The student must approve the link from their portal before summaries become visible.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to link student account.');
    } finally {
      setBusyKey(null);
    }
  };

  const selectedGuardianLink = asGuardianLinks.find((l) => l.studentUid === selectedStudentUid) || null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-400">
            Family Privacy Controls · Zero Private Chat Exposure
          </p>
          <h1 className="text-2xl font-extrabold text-white mt-0.5">
            Guardian &amp; Privacy Portal
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isAdminRole && (
            <div className="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-1">
              <button
                type="button"
                onClick={() => setViewMode('student')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  viewMode === 'student' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Student Controls
              </button>
              <button
                type="button"
                onClick={() => setViewMode('guardian')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  viewMode === 'guardian' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Guardian View
              </button>
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={loadLinks}
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Notices */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Privacy Boundary Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <p className="font-bold text-white">Strict Student Privacy Boundary</p>
          <p className="text-slate-400 leading-relaxed">
            Guardian access is strictly read-only, opt-in, and student-approved. Private AI Teacher dialogues, uploaded Smart Doubt images, Voice classroom transcripts, and Peer Study Pod notes are blocked at both server endpoints and Cloud Firestore rules.
          </p>
        </div>
      </div>

      {/* ================================ */}
      {/* STUDENT CONTROLS VIEW            */}
      {/* ================================ */}
      {viewMode === 'student' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Generate Verification Code */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                Generate Guardian Invite Code
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Share a single-use code with your parent or guardian. Linking remains pending until you explicitly approve it.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              loading={busyKey === 'gen-code'}
              onClick={handleGenerateCode}
              icon={<KeyRound className="w-4 h-4" />}
            >
              Generate 48-Hour Verification Code
            </Button>

            {activeInvite && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Active One-Time Code
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-testid="guardian-invite-code"
                    className="text-lg font-mono font-bold tracking-widest text-emerald-300 tabular-nums"
                  >
                    {activeInvite.code}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyCode}
                    icon={copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                  >
                    {copiedCode ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  Expires {new Date(activeInvite.expiresAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Connected Guardians & Permission Toggles */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white">
                Linked Guardians &amp; Privacy Controls ({asStudentLinks.length})
              </h2>
            </div>

            {asStudentLinks.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                No guardian accounts are linked to your profile yet.
              </p>
            ) : (
              <div className="space-y-4">
                {asStudentLinks.map((link) => {
                  const isBusy = busyKey === `link-${link.id}`;
                  return (
                    <div
                      key={link.id}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{link.guardianName}</span>
                            <Badge
                              variant={
                                link.status === 'verified'
                                  ? 'success'
                                  : link.status === 'pending'
                                  ? 'warning'
                                  : 'rose'
                              }
                              size="sm"
                            >
                              {link.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-400">
                            {link.relationship} · {link.guardianEmailMasked}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {link.status !== 'verified' && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={isBusy}
                              onClick={() => handleStudentLinkAction(link.id, { status: 'verified' })}
                              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            >
                              Approve Link
                            </Button>
                          )}
                          {link.status !== 'revoked' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => handleStudentLinkAction(link.id, { status: 'revoked' })}
                              icon={<XCircle className="w-3.5 h-3.5 text-rose-400" />}
                            >
                              Revoke Access
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Granular Permission Controls */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-800/80">
                        {PERMISSION_LABELS.map((perm) => {
                          const enabled = Boolean(link.permissions[perm.key]);
                          return (
                            <label
                              key={perm.key}
                              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-start justify-between gap-3 cursor-pointer"
                            >
                              <div>
                                <span className="text-xs font-semibold text-white block">
                                  {perm.label}
                                </span>
                                <span className="text-[11px] text-slate-400 block mt-0.5">
                                  {perm.desc}
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={isBusy}
                                aria-label={`${perm.label} for ${link.guardianName}`}
                                onChange={(e) =>
                                  handleStudentLinkAction(link.id, {
                                    permissions: { [perm.key]: e.target.checked },
                                  })
                                }
                                className="mt-0.5 h-4 w-4 accent-indigo-500 cursor-pointer"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================ */}
      {/* GUARDIAN READ-ONLY PORTAL VIEW   */}
      {/* ================================ */}
      {viewMode === 'guardian' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Link New Student + Selector */}
          <div className="space-y-5">
            <form
              onSubmit={handleRedeemInvite}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3"
            >
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                Link a Student Account
              </h2>
              <p className="text-xs text-slate-400">
                Enter the verification code generated by the student. Access activates once they approve your request.
              </p>
              <input
                type="text"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                placeholder="Enter code (e.g. GDN-A3F91C)"
                aria-label="Student verification code"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono tracking-wider"
                required
              />
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value as 'parent' | 'guardian' | 'mentor')}
                aria-label="Guardian relationship"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              >
                <option value="parent">Parent</option>
                <option value="guardian">Legal Guardian</option>
                <option value="mentor">Academic Mentor</option>
              </select>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-full"
                loading={busyKey === 'redeem-code'}
              >
                Submit Link Request
              </Button>
            </form>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
              <h2 className="text-sm font-bold text-white">Linked Students</h2>
              {asGuardianLinks.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No linked students yet. Submit a verification code above.
                </p>
              ) : (
                <div className="space-y-2">
                  {asGuardianLinks.map((link) => {
                    const selected = selectedStudentUid === link.studentUid;
                    return (
                      <button
                        key={link.id}
                        type="button"
                        onClick={() => setSelectedStudentUid(link.studentUid)}
                        className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-indigo-600/15 border-indigo-500/40'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">
                            {link.studentDisplayName}
                          </span>
                          <Badge
                            variant={
                              link.status === 'verified'
                                ? 'success'
                                : link.status === 'pending'
                                ? 'warning'
                                : 'rose'
                            }
                            size="sm"
                          >
                            {link.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {link.studentBoard} · {link.studentClassGrade} · {link.relationship}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Redacted Student Summary */}
          <div className="lg:col-span-2 space-y-5">
            {!selectedGuardianLink ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
                <p className="text-xs text-slate-400">
                  Select a linked student on the left to view permitted learning summaries.
                </p>
              </div>
            ) : selectedGuardianLink.status === 'pending' ? (
              <div className="rounded-2xl border border-amber-500/30 bg-slate-900 p-6 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                  <Lock className="w-4 h-4" />
                  <span>Pending Student Approval</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedGuardianLink.studentDisplayName} must approve this link inside their Guardian &amp; Privacy Portal before any learning summaries can be accessed.
                </p>
              </div>
            ) : selectedGuardianLink.status === 'revoked' ? (
              <div className="rounded-2xl border border-rose-500/30 bg-slate-900 p-6 space-y-2">
                <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                  <Lock className="w-4 h-4" />
                  <span>Access Revoked</span>
                </div>
                <p className="text-xs text-slate-300">
                  This guardian link has been revoked. Generate and verify a new invite code to reconnect.
                </p>
              </div>
            ) : loadingSummary ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
                <div className="h-4 w-48 bg-slate-800 rounded" />
                <div className="h-24 bg-slate-800 rounded" />
              </div>
            ) : summaryError ? (
              <div className="rounded-2xl border border-rose-500/30 bg-slate-900 p-6 text-xs text-rose-300">
                {summaryError}
              </div>
            ) : studentSummary ? (
              <div className="space-y-5">
                {/* Summary Header */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">{studentSummary.studentDisplayName}</h2>
                    <p className="text-xs text-slate-400">
                      {studentSummary.board} · {studentSummary.classGrade} · Preferred Language:{' '}
                      {studentSummary.language}
                    </p>
                  </div>
                  <Badge variant="success" size="sm">
                    Verified Link
                  </Badge>
                </div>

                {/* Section 1: Progress Summary */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-400" />
                      Learning Progress Summary
                    </h3>
                  </div>

                  {!studentSummary.progressSummary ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                      <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Restricted by Student Privacy Controls</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="text-[11px] text-slate-400 block">Active Streak</span>
                          <span className="text-lg font-bold text-amber-300 tabular-nums">
                            {studentSummary.progressSummary.streakDays} days
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="text-[11px] text-slate-400 block">Verified XP</span>
                          <span className="text-lg font-bold text-white tabular-nums">
                            {studentSummary.progressSummary.totalVerifiedXp.toLocaleString()}
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="text-[11px] text-slate-400 block">Today Healthy Pace</span>
                          <span className="text-lg font-bold text-emerald-300 tabular-nums">
                            {studentSummary.progressSummary.todayXpEarned}/
                            {studentSummary.progressSummary.todayXpCap} XP
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="text-[11px] text-slate-400 block">Mastered Topics</span>
                          <span className="text-lg font-bold text-indigo-300 tabular-nums">
                            {studentSummary.progressSummary.masteredTopicsCount}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                          <p className="font-semibold text-emerald-300">Strong Topics</p>
                          <p className="text-slate-300">
                            {studentSummary.progressSummary.strongTopics.join(', ') || 'Building mastery'}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                          <p className="font-semibold text-amber-300">Recommended Revision</p>
                          <p className="text-slate-300">
                            {studentSummary.progressSummary.needsRevisionTopics.join(', ') || 'On track'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 2: Learning Goals Overview */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Target className="w-4 h-4 text-indigo-400" />
                      Learning Goals Overview
                    </h3>
                  </div>

                  {!studentSummary.goalsOverview ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                      <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Restricted by Student Privacy Controls</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        {studentSummary.goalsOverview.learningGoals.map((g, i) => (
                          <div
                            key={i}
                            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 flex items-center gap-2"
                          >
                            <Award className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>{g}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2 pt-1">
                        {studentSummary.goalsOverview.dailyGoals.map((dg, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                          >
                            <span className="text-white font-medium">{dg.title}</span>
                            <span className="font-mono tabular-nums text-slate-300">
                              {dg.current}/{dg.target} {dg.completed ? '· Done' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 3: Assessments Summary */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      Assessments Summary
                    </h3>
                  </div>

                  {!studentSummary.assessmentsSummary ? (
                    <div
                      data-testid="assessments-restricted-notice"
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-center gap-2"
                    >
                      <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Restricted by Student Privacy Controls</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-300 tabular-nums">
                        Average Score:{' '}
                        <strong className="text-white">
                          {studentSummary.assessmentsSummary.averagePercentage}%
                        </strong>{' '}
                        across {studentSummary.assessmentsSummary.recentExamsCount} recent mocks
                      </p>
                      <div className="space-y-2">
                        {studentSummary.assessmentsSummary.recentExams.map((exam, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-semibold text-white">{exam.title}</p>
                              <p className="text-[11px] text-slate-400">
                                {exam.subject} · {new Date(exam.submittedAt).toLocaleDateString()}
                              </p>
                            </div>
                            <span className="font-mono font-bold text-indigo-300 tabular-nums">
                              {exam.percentage}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-400">{studentSummary.safetyNotice}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
