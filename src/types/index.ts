export type DifficultyLevel = '쉬움' | '보통' | '어려움';

export type QuestionStatus = '승인' | '검토중' | '근거확인필요' | '수정됨';

export interface QualityCheck {
  singleAnswer: boolean;
  sourceSupported: boolean;
  ambiguity: boolean;
  alerts?: string[];
  notes?: string;
}

export interface PostalQuestion {
  id: string;
  number: number;
  question: string;
  options: [string, string, string, string];
  answer: 1 | 2 | 3 | 4;
  explanation: string;
  difficulty: DifficultyLevel;
  category: string;
  source: string;
  status: QuestionStatus;
  qualityCheck: QualityCheck;
  createdAt: string;
  updatedAt?: string;
}

export interface DifficultyRatio {
  easy: number;
  medium: number;
  hard: number;
}

export interface ExamConfig {
  subject: string;
  questionCount: number;
  questionType: string;
  difficultyRatio: DifficultyRatio;
  orientations: string[];
  selectedChapters: string[];
  selectedSections?: string[];
}

export interface DocumentSection {
  id: string;
  name: string; // 2단계: "제X절 [절 제목]"
  preview: string;
  charCount?: number;
}

export interface DocumentChapter {
  id: string;
  name: string; // 1단계: "제X장 [장 제목]"
  preview: string;
  charCount: number;
  sections?: DocumentSection[]; // 2단계: "제X절" 목록
}

export interface ParsedDocument {
  id: string;
  fileName: string;
  fileType: 'hwp' | 'hwpx' | 'pdf' | 'docx' | 'txt';
  fileSize: number;
  uploadedAt: string;
  title: string;
  totalChars: number;
  content: string;
  chapters: DocumentChapter[];
  keyTopics: string[];
  keyRules?: string[];
  procedures?: string[];
}

export interface SavedExamSession {
  id: string;
  title: string;
  subject: string;
  fileName: string;
  createdAt: string;
  questionCount: number;
  approvedCount: number;
  questions: PostalQuestion[];
  config: ExamConfig;
}

export const __TYPES_MODULE__ = true;
