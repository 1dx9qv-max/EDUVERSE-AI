export type TeachingMode =
  | 'explain'
  | 'step-by-step'
  | 'examples'
  | 'explain-mistake'
  | 'test-understanding'
  | 'summarize-chapter';

export type ExplanationLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type TutorLanguage = 'English' | 'Hindi' | 'Hinglish' | 'Bilingual';

export interface TeacherLessonSection {
  title: string;
  content: string;
}

export interface TeacherCheckingQuestion {
  question: string;
  hint: string;
  expectedConcept: string;
}

export interface TeacherExercise {
  prompt: string;
  difficulty: string;
  hint: string;
}

export interface TeacherStructuredResponse {
  lessonTitle: string;
  reply: string;
  lessonBreakdown: TeacherLessonSection[];
  realWorldExamples: string[];
  analogy: string;
  checkingQuestion: TeacherCheckingQuestion;
  followUpExercises: TeacherExercise[];
  syllabusNote: string;
  suggestedNextStep: string;
}

export interface TeacherMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: TeachingMode;
  level: ExplanationLevel;
  language: TutorLanguage;
  timestamp: string;
  structured?: TeacherStructuredResponse;
}

export interface TeacherSession {
  id: string;
  userId: string;
  title: string;
  subject: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  difficultyLevel: ExplanationLevel;
  teachingMode: TeachingMode;
  messages: TeacherMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface TeacherRequestPayload {
  subject: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  level: ExplanationLevel;
  mode: TeachingMode;
  message: string;
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export type DoubtInputMode = 'typed' | 'image' | 'handwritten' | 'pdf' | 'worksheet';

export interface DoubtAttachmentInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
}

export interface SimilarPracticeQuestion {
  question: string;
  options: string[];
  hint: string;
  answer: string;
}

export interface WorksheetQuestionSolution {
  questionNumber: number;
  understoodQuestion: string;
  identifiedTopic: string;
  stepByStepSolution: string[];
  whyItWorks: string;
  commonMisconceptions: string[];
  similarPracticeQuestion: SimilarPracticeQuestion;
  easierExplanation: string;
}

export interface SmartDoubtResponse {
  identifiedSubject: string;
  identifiedTopic: string;
  understoodQuestion: string;
  stepByStepSolution: string[];
  whyItWorks: string;
  commonMisconceptions: string[];
  similarPracticeQuestion: SimilarPracticeQuestion;
  easierExplanation: string;
  syllabusDisclaimer: string;
  isWorksheet: boolean;
  worksheetQuestions: WorksheetQuestionSolution[];
}

export interface SolveDoubtRequestPayload {
  question?: string;
  subjectHint?: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  inputMode: DoubtInputMode;
  simplerRequested?: boolean;
  isWorksheet?: boolean;
  attachment?: DoubtAttachmentInput | null;
}

export interface DoubtTicket {
  id: string;
  userId: string;
  title: string;
  subject: string;
  topic?: string;
  classGrade: string;
  board?: string;
  inputMode?: DoubtInputMode;
  attachmentLabel?: string;
  questionText: string;
  language: string;
  status: 'open' | 'answered' | 'closed';
  aiAnswer: string;
  structuredSolution?: SmartDoubtResponse;
  createdAt: string;
  updatedAt: string;
}

export interface AiApiErrorPayload {
  error: string;
  code?: string;
  retryable?: boolean;
}
