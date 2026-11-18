import React from 'react';
import { Sparkles, Shield, Heart } from 'lucide-react';
import { Link } from '../../router/Router';
import { FEATURE_FLAGS } from '../../config/featureFlags';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 py-12 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Info */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-base text-white tracking-tight">EDUVERSE AI</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              India’s next-generation intelligent learning ecosystem designed for CBSE, ICSE, and State Board scholars from Class 6 to 12.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <Shield className="w-3.5 h-3.5" />
              <span>Zero data harvesting • Student privacy safe</span>
            </div>
          </div>

          {/* Curricula Covered */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-3">
              Curricula & Boards
            </h4>
            <ul className="space-y-2 text-xs">
              <li>CBSE / NCERT Syllabus (Class 6 - 12)</li>
              <li>CISCE / ICSE / ISC Board</li>
              <li>Maharashtra State Board (MSBSHSE)</li>
              <li>UP Board (UPMSP) & Bihar Board</li>
              <li>Karnataka, Tamil Nadu & Bengal Boards</li>
            </ul>
          </div>

          {/* Intelligent Modules */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-3">
              Core Ecosystem
            </h4>
            <ul className="space-y-2 text-xs">
              <li><Link to="/ai-teacher" className="hover:text-white transition-colors">Socratic AI Teacher (24/7)</Link></li>
              <li><Link to="/doubt-solver" className="hover:text-white transition-colors">Instant Doubt Solver</Link></li>
              {FEATURE_FLAGS.visualLearningEnabled && (
                <li><Link to="/visual-lab" className="hover:text-white transition-colors">Interactive Visual Lab</Link></li>
              )}
              <li><Link to="/practice" className="hover:text-white transition-colors">Adaptive Question Bank</Link></li>
              <li><Link to="/exam-simulator" className="hover:text-white transition-colors">3-Hour Mock Exam Simulator</Link></li>
            </ul>
          </div>

          {/* Languages & Access */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-3">
              Languages & Accessibility
            </h4>
            <ul className="space-y-2 text-xs">
              <li>English Medium Guidance</li>
              <li>हिन्दी माध्यम (Hindi Medium Support)</li>
              <li>Hinglish Conversational Explanations</li>
              <li>Voice-Enabled Handsfree Viva</li>
              <li>NCERT Citation Grounding</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800/80 pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <p>© {new Date().getFullYear()} EDUVERSE AI. Built with Google Gemini & Firebase Architecture.</p>
          <div className="flex items-center gap-1 text-[11px]">
            <span>Empowering school education across India</span>
            <Heart className="w-3 h-3 text-rose-500 fill-rose-500 inline mx-1" />
          </div>
        </div>
      </div>
    </footer>
  );
};
