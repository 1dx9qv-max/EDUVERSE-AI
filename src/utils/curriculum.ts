import type { ClassGrade, IndianBoard, UserRole } from '../types/auth.ts';
import type { BoardRecord, ChapterNode, SubjectCurriculum } from '../types/curriculum.ts';

export const INDIAN_BOARDS: { id: IndianBoard; label: string; full: string; type: 'national' | 'state' | 'other' }[] = [
  { id: 'CBSE', label: 'CBSE', full: 'Central Board of Secondary Education (All India & Overseas)', type: 'national' },
  { id: 'CISCE', label: 'CISCE', full: 'Council for the Indian School Certificate Examinations', type: 'national' },
  { id: 'ICSE', label: 'ICSE (Class 9-10)', full: 'Indian Certificate of Secondary Education', type: 'national' },
  { id: 'ISC', label: 'ISC (Class 11-12)', full: 'Indian School Certificate', type: 'national' },
  { id: 'StateBoard', label: 'State Boards', full: 'All Indian State Boards (Maharashtra, UP, Bihar, Karnataka, etc.)', type: 'state' },
  { id: 'Other', label: 'Other / Foundation', full: 'Other Curricula / International Baccalaureate / Cambridge', type: 'other' },
];

export const INDIAN_STATES: string[] = [
  'Delhi (NCT)',
  'Maharashtra',
  'Uttar Pradesh',
  'Karnataka',
  'Tamil Nadu',
  'Telangana',
  'Andhra Pradesh',
  'West Bengal',
  'Gujarat',
  'Rajasthan',
  'Madhya Pradesh',
  'Bihar',
  'Punjab',
  'Haryana',
  'Kerala',
  'Odisha',
  'Assam',
  'Jharkhand',
  'Chhattisgarh',
  'Uttarakhand',
  'Himachal Pradesh',
  'Jammu & Kashmir',
  'Goa',
  'Tripura',
  'Meghalaya',
  'Manipur',
  'Nagaland',
  'Chandigarh',
  'Other / Overseas Indian'
];

export const CLASS_GRADES: ClassGrade[] = [
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

export const AVAILABLE_SUBJECTS_BY_GRADE: Record<string, string[]> = {
  'Class 6': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'],
  'Class 7': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'],
  'Class 8': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi', 'Computer Studies'],
  'Class 9': ['Mathematics', 'Science', 'Social Science', 'English Language & Literature', 'Hindi Course A/B', 'Information Technology'],
  'Class 10': ['Mathematics (Standard/Basic)', 'Science', 'Social Science', 'English Language & Literature', 'Hindi Course A/B', 'Artificial Intelligence'],
  'Class 11': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science', 'English Core', 'Accountancy', 'Economics', 'Business Studies'],
  'Class 12': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science', 'English Core', 'Accountancy', 'Economics', 'Business Studies']
};

export const POPULAR_LEARNING_GOALS: string[] = [
  'Target 95%+ in Board Examinations',
  'Master NCERT Concepts without Rote Learning',
  'Build Strong Foundation for JEE / NEET',
  'Clear Complex Math & Science Doubts Instantly',
  'Maintain Daily 45-Minute Study Streak',
  'Speed & Accuracy in MCQ / Assertion-Reason Papers',
  'Consistent Chapter Revision with Active Recall'
];

export function calculateXpGain(basePoints: number, accuracyRate: number, streakMultiplier: number = 1): number {
  if (basePoints <= 0) return 0;
  const clampedAccuracy = Math.max(0, Math.min(1, accuracyRate));
  const accuracyBonus = Math.round(basePoints * clampedAccuracy * 0.5);
  const total = Math.round((basePoints + accuracyBonus) * Math.max(1, streakMultiplier));
  return total;
}

export function updateStreak(lastActiveDateStr: string | null, currentDate: Date = new Date()): { newStreak: number; maintained: boolean } {
  if (!lastActiveDateStr) {
    return { newStreak: 1, maintained: true };
  }
  const lastActive = new Date(lastActiveDateStr);
  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);
  const last = new Date(lastActive);
  last.setHours(0, 0, 0, 0);

  const diffDays = Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { newStreak: 1, maintained: true }; // same day
  } else if (diffDays === 1) {
    return { newStreak: 2, maintained: true }; // continued
  } else {
    return { newStreak: 1, maintained: false }; // broken
  }
}

export function hasRoleAccess(userRole: UserRole, allowedRoles?: UserRole[]): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  if (userRole === 'admin') return true; // Admins have superset access
  return allowedRoles.includes(userRole);
}

// Hierarchical syllabus sample generator that clearly labels official verification status
export function getSampleCurriculum(board: IndianBoard, grade: ClassGrade): SubjectCurriculum[] {
  const isHighSchool = grade === 'Class 11' || grade === 'Class 12';
  
  if (isHighSchool) {
    return [
      {
        id: 'physics',
        name: 'Physics',
        hindiName: 'भौतिक विज्ञान',
        icon: 'Atom',
        color: 'from-blue-500 to-indigo-600',
        chapters: [
          { id: 'ph-1', number: 1, title: 'Electrostatics & Electric Charges', conceptCount: 14, keyTopics: ['Coulombs Law', 'Electric Field', 'Gauss Theorem'], estimatedHours: 8 },
          { id: 'ph-2', number: 2, title: 'Current Electricity', conceptCount: 12, keyTopics: ['Ohms Law', 'Kirchhoffs Laws', 'Wheatstone Bridge'], estimatedHours: 6 },
          { id: 'ph-3', number: 3, title: 'Magnetic Effects of Current', conceptCount: 16, keyTopics: ['Biot-Savart Law', 'Ampere Circuital Law'], estimatedHours: 9 },
        ]
      },
      {
        id: 'chemistry',
        name: 'Chemistry',
        hindiName: 'रसायन विज्ञान',
        icon: 'FlaskConical',
        color: 'from-amber-500 to-rose-600',
        chapters: [
          { id: 'ch-1', number: 1, title: 'Solutions & Colligative Properties', conceptCount: 11, keyTopics: ['Raoults Law', 'Osmotic Pressure', 'Van’t Hoff Factor'], estimatedHours: 7 },
          { id: 'ch-2', number: 2, title: 'Electrochemistry', conceptCount: 15, keyTopics: ['Nernst Equation', 'Faraday Laws', 'Electrochemical Cells'], estimatedHours: 8 },
          { id: 'ch-3', number: 3, title: 'Chemical Kinetics', conceptCount: 10, keyTopics: ['Rate Law', 'Arrhenius Equation', 'Order of Reaction'], estimatedHours: 6 },
        ]
      },
      {
        id: 'mathematics',
        name: 'Mathematics',
        hindiName: 'गणित',
        icon: 'Calculator',
        color: 'from-emerald-500 to-teal-700',
        chapters: [
          { id: 'ma-1', number: 1, title: 'Relations & Functions', conceptCount: 8, keyTopics: ['Equivalence Relations', 'Bijective Functions', 'Composition'], estimatedHours: 5 },
          { id: 'ma-2', number: 2, title: 'Matrices & Determinants', conceptCount: 14, keyTopics: ['Matrix Operations', 'Inverse Matrix', 'Cramers Rule'], estimatedHours: 7 },
          { id: 'ma-3', number: 3, title: 'Calculus: Continuity & Differentiability', conceptCount: 18, keyTopics: ['Chain Rule', 'Derivatives', 'Mean Value Theorem'], estimatedHours: 10 },
        ]
      },
      {
        id: 'biology',
        name: 'Biology',
        hindiName: 'जीव विज्ञान',
        icon: 'Dna',
        color: 'from-emerald-400 to-green-600',
        chapters: [
          { id: 'bi-1', number: 1, title: 'Genetics & Molecular Basis of Inheritance', conceptCount: 15, keyTopics: ['Mendelian Genetics', 'DNA Replication', 'Transcription'], estimatedHours: 8 },
          { id: 'bi-2', number: 2, title: 'Human Reproduction & Reproductive Health', conceptCount: 12, keyTopics: ['Gametogenesis', 'Menstrual Cycle', 'Embryo Development'], estimatedHours: 6 },
        ]
      }
    ];
  }

  // Class 6 to 10
  return [
    {
      id: 'mathematics',
      name: 'Mathematics',
      hindiName: 'गणित',
      icon: 'Calculator',
      color: 'from-blue-500 to-indigo-600',
      chapters: [
        { id: 'm-1', number: 1, title: 'Real Numbers & Number Systems', conceptCount: 10, keyTopics: ['Euclids Lemma', 'Fundamental Theorem of Arithmetic', 'Irrationality Proofs'], estimatedHours: 5 },
        { id: 'm-2', number: 2, title: 'Polynomials & Algebraic Expressions', conceptCount: 12, keyTopics: ['Zeroes of Polynomials', 'Relationship between Zeroes and Coefficients'], estimatedHours: 6 },
        { id: 'm-3', number: 3, title: 'Linear Equations in Two Variables', conceptCount: 11, keyTopics: ['Graphical Method', 'Substitution', 'Elimination'], estimatedHours: 6 },
        { id: 'm-4', number: 4, title: 'Triangles & Geometry', conceptCount: 14, keyTopics: ['Similar Triangles', 'Pythagoras Theorem', 'Criteria for Similarity'], estimatedHours: 8 },
      ]
    },
    {
      id: 'science',
      name: 'Science',
      hindiName: 'विज्ञान',
      icon: 'Atom',
      color: 'from-purple-500 to-pink-600',
      chapters: [
        { id: 's-1', number: 1, title: 'Chemical Reactions and Equations', conceptCount: 12, keyTopics: ['Types of Reactions', 'Oxidation & Reduction', 'Corrosion & Rancidity'], estimatedHours: 6 },
        { id: 's-2', number: 2, title: 'Acids, Bases and Salts', conceptCount: 14, keyTopics: ['pH Scale', 'Indicators', 'Salts Preparation'], estimatedHours: 7 },
        { id: 's-3', number: 3, title: 'Life Processes (Nutrition & Respiration)', conceptCount: 16, keyTopics: ['Photosynthesis', 'Human Digestive System', 'Cellular Respiration'], estimatedHours: 9 },
        { id: 's-4', number: 4, title: 'Light - Reflection and Refraction', conceptCount: 15, keyTopics: ['Mirror Formula', 'Snells Law', 'Lens Formula & Power'], estimatedHours: 8 },
      ]
    },
    {
      id: 'social-science',
      name: 'Social Science',
      hindiName: 'सामाजिक विज्ञान',
      icon: 'Globe',
      color: 'from-amber-500 to-orange-600',
      chapters: [
        { id: 'ss-1', number: 1, title: 'India and the Contemporary World: Nationalism in India', conceptCount: 10, keyTopics: ['Non-Cooperation Movement', 'Civil Disobedience', 'Salt Satyagraha'], estimatedHours: 5 },
        { id: 'ss-2', number: 2, title: 'Resources and Development', conceptCount: 8, keyTopics: ['Land Utilization', 'Soil Conservation', 'Sustainable Resource Planning'], estimatedHours: 4 },
      ]
    },
    {
      id: 'english',
      name: 'English Language & Literature',
      hindiName: 'अंग्रेज़ी',
      icon: 'BookOpen',
      color: 'from-cyan-500 to-blue-600',
      chapters: [
        { id: 'en-1', number: 1, title: 'Reading Comprehension & Critical Analysis', conceptCount: 8, keyTopics: ['Inference', 'Vocabulary in Context', 'Author Tone'], estimatedHours: 4 },
        { id: 'en-2', number: 2, title: 'Formal Writing & Grammar Skills', conceptCount: 10, keyTopics: ['Letter Writing', 'Analytical Paragraph', 'Tenses & Modals'], estimatedHours: 5 },
      ]
    }
  ];
}

const EXTRA_SUBJECT_CURRICULA: Record<string, SubjectCurriculum> = {
  hindi: {
    id: 'hindi',
    name: 'Hindi',
    hindiName: 'हिन्दी',
    icon: 'BookOpen',
    color: 'from-orange-500 to-amber-600',
    chapters: [
      { id: 'hi-1', number: 1, title: 'गद्य एवं पद्य व्याख्या (Prose & Poetry)', conceptCount: 8, keyTopics: ['संदर्भ सहित व्याख्या', 'काव्य सौंदर्य', 'प्रमुख अलंकार'], estimatedHours: 4 },
      { id: 'hi-2', number: 2, title: 'व्यावहारिक व्याकरण एवं रचना', conceptCount: 10, keyTopics: ['रचना के आधार पर वाक्य भेद', 'समास एवं पद परिचय', 'औपचारिक पत्र लेखन'], estimatedHours: 5 },
    ],
  },
  'computer-science': {
    id: 'computer-science',
    name: 'Computer Science & AI',
    hindiName: 'कंप्यूटर विज्ञान',
    icon: 'Cpu',
    color: 'from-violet-500 to-indigo-600',
    chapters: [
      { id: 'cs-1', number: 1, title: 'Computational Thinking & Python Foundations', conceptCount: 10, keyTopics: ['Functions & Recursion', 'Data Structures (Lists & Dictionaries)', 'File Handling'], estimatedHours: 6 },
      { id: 'cs-2', number: 2, title: 'Database Concepts, SQL & AI Ethics', conceptCount: 9, keyTopics: ['Relational Queries & Joins', 'Computer Networks', 'Responsible AI Foundations'], estimatedHours: 5 },
    ],
  },
  economics: {
    id: 'economics',
    name: 'Economics',
    hindiName: 'अर्थशास्त्र',
    icon: 'TrendingUp',
    color: 'from-teal-500 to-emerald-600',
    chapters: [
      { id: 'ec-1', number: 1, title: 'National Income & Macroeconomic Aggregates', conceptCount: 10, keyTopics: ['GDP & Circular Flow', 'Value Added Method', 'Money & Banking'], estimatedHours: 6 },
      { id: 'ec-2', number: 2, title: 'Indian Economic Development & Fiscal Policy', conceptCount: 9, keyTopics: ['Aggregate Demand & Multiplier', 'Government Budget', 'Balance of Payments'], estimatedHours: 5 },
    ],
  },
  accountancy: {
    id: 'accountancy',
    name: 'Accountancy',
    hindiName: 'लेखाशास्त्र',
    icon: 'Calculator',
    color: 'from-sky-500 to-blue-700',
    chapters: [
      { id: 'ac-1', number: 1, title: 'Partnership Accounting & Goodwill', conceptCount: 11, keyTopics: ['Profit & Loss Appropriation', 'Admission & Retirement of Partner', 'Dissolution of Firm'], estimatedHours: 7 },
      { id: 'ac-2', number: 2, title: 'Company Accounts & Financial Statements', conceptCount: 10, keyTopics: ['Issue of Shares & Debentures', 'Ratio Analysis', 'Cash Flow Statement'], estimatedHours: 6 },
    ],
  },
  'business-studies': {
    id: 'business-studies',
    name: 'Business Studies',
    hindiName: 'व्यवसाय अध्ययन',
    icon: 'Briefcase',
    color: 'from-fuchsia-500 to-purple-700',
    chapters: [
      { id: 'bs-1', number: 1, title: 'Principles & Functions of Management', conceptCount: 10, keyTopics: ['Fayol & Taylor Principles', 'Planning & Organizing', 'Directing & Controlling'], estimatedHours: 5 },
      { id: 'bs-2', number: 2, title: 'Financial Markets & Marketing Management', conceptCount: 9, keyTopics: ['Capital Structure', 'Marketing Mix (4Ps)', 'Consumer Protection Act'], estimatedHours: 5 },
    ],
  },
};

function canonicalSubjectKey(raw: string): string {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('math')) return 'mathematics';
  if (s.includes('physics')) return 'physics';
  if (s.includes('chem')) return 'chemistry';
  if (s.includes('bio')) return 'biology';
  if (s.includes('social')) return 'social-science';
  if (s.includes('science')) return 'science';
  if (s.includes('english')) return 'english';
  if (s.includes('hindi')) return 'hindi';
  if (s.includes('computer') || s.includes('information') || s.includes('artificial')) return 'computer-science';
  if (s.includes('econ')) return 'economics';
  if (s.includes('account')) return 'accountancy';
  if (s.includes('business')) return 'business-studies';
  return s.replace(/[^a-z0-9]+/g, '-');
}

export function getCurriculumForStudent(
  board: IndianBoard,
  grade: ClassGrade,
  enrolledSubjects?: string[],
  verifiedNodes?: ChapterNode[]
): SubjectCurriculum[] {
  const baseList = getSampleCurriculum(board, grade);
  const byKey = new Map<string, SubjectCurriculum>();

  for (const subj of baseList) {
    byKey.set(canonicalSubjectKey(subj.name), {
      ...subj,
      chapters: subj.chapters.map((c) => ({ ...c, keyTopics: [...c.keyTopics] })),
    });
  }

  // Merge extra enrolled subjects if the student selected them (e.g., Hindi, CS, Commerce, Physics in Class 9-10)
  const targetSubjects =
    enrolledSubjects && enrolledSubjects.length > 0 ? enrolledSubjects : [];

  for (const rawName of targetSubjects) {
    const key = canonicalSubjectKey(rawName);
    if (!byKey.has(key)) {
      if (EXTRA_SUBJECT_CURRICULA[key]) {
        const extra = EXTRA_SUBJECT_CURRICULA[key];
        byKey.set(key, {
          ...extra,
          name: rawName,
          chapters: extra.chapters.map((c) => ({ ...c, keyTopics: [...c.keyTopics] })),
        });
      } else if (key === 'physics' || key === 'chemistry' || key === 'biology') {
        const hs = getSampleCurriculum(board, 'Class 11').find(
          (s) => canonicalSubjectKey(s.name) === key
        );
        if (hs) {
          byKey.set(key, {
            ...hs,
            name: rawName,
            chapters: hs.chapters.map((c) => ({ ...c, keyTopics: [...c.keyTopics] })),
          });
        }
      }
    }
  }

  // Merge verified admin syllabus nodes matching board/grade if provided
  if (verifiedNodes && verifiedNodes.length > 0) {
    for (const node of verifiedNodes) {
      if (node.classGrade !== grade) continue;
      if (node.boardId && node.boardId !== board && node.boardId !== 'CBSE') continue;
      const key = canonicalSubjectKey(node.subjectId);
      const existingSubj = byKey.get(key);
      if (existingSubj) {
        const dupIdx = existingSubj.chapters.findIndex(
          (c) => c.title.toLowerCase() === node.chapterTitle.toLowerCase()
        );
        const mappedChapter = {
          id: node.id,
          number: node.chapterNumber,
          title: node.chapterTitle,
          titleHindi: node.chapterTitleHindi,
          conceptCount: Math.max(4, node.topics.length * 3),
          keyTopics: node.topics.map((t) => t.title),
          estimatedHours: Math.max(2, node.topics.length * 2),
        };
        if (dupIdx >= 0) {
          existingSubj.chapters[dupIdx] = mappedChapter;
        } else {
          existingSubj.chapters.push(mappedChapter);
        }
      }
    }
  }

  // If enrolledSubjects was specified, prioritize & filter to those subjects when matches exist
  if (targetSubjects.length > 0) {
    const matched: SubjectCurriculum[] = [];
    const seen = new Set<string>();
    for (const rawName of targetSubjects) {
      const key = canonicalSubjectKey(rawName);
      const entry = byKey.get(key);
      if (entry && !seen.has(key)) {
        seen.add(key);
        matched.push({ ...entry, name: rawName });
      }
    }
    if (matched.length > 0) {
      return matched;
    }
  }

  return Array.from(byKey.values());
}

