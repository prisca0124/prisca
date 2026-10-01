import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { StepProgress } from './components/StepProgress';
import { MainDashboard } from './components/MainDashboard';
import { FileUploadStep } from './components/FileUploadStep';
import { ConfigStep } from './components/ConfigStep';
import { ReviewStep } from './components/ReviewStep';
import { ExamPaperView } from './components/ExamPaperView';
import { GeneratingOverlay } from './components/GeneratingOverlay';
import { ParsedDocument, ExamConfig, PostalQuestion, SavedExamSession } from './types';
import { SAMPLE_DOCUMENTS } from './data/sampleDocuments';
import { AlertTriangle, RefreshCw, X, ShieldAlert } from 'lucide-react';

const STORAGE_KEY = 'postal_exam_saved_sessions_v1';

export default function App() {
  const [currentStep, setCurrentStep] = useState<number>(0); // 0: MainDashboard, 1: Upload, 2: Config, 3: Review, 4: Print
  const [document, setDocument] = useState<ParsedDocument | null>(null);
  const [config, setConfig] = useState<ExamConfig>({
    subject: '우편물 접수 및 요금 실무평가',
    questionCount: 10,
    questionType: '4지선다 객관식',
    difficultyRatio: { easy: 20, medium: 60, hard: 20 },
    orientations: ['핵심내용 중심', '업무상황 중심', '규정·기준 적용형'],
    selectedChapters: [],
  });
  const [questions, setQuestions] = useState<PostalQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedExamSession[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<{
    title: string;
    message: string;
    is503: boolean;
    onRetry: () => void;
  } | null>(null);

  // Load saved sessions from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedSessions(parsed);
        }
      } else {
        const initialSample = SAMPLE_DOCUMENTS[0];
        const sampleSession: SavedExamSession = {
          id: 'initial-session-1',
          title: '우편물 접수 및 요금 기본평가',
          subject: '우편물 접수 및 요금 실무평가',
          fileName: initialSample.fileName,
          createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
          questionCount: 4,
          approvedCount: 4,
          questions: [
            {
              id: 'q-init-1',
              number: 1,
              question: '우편법령상 통상 규격우편물의 허용 중량 기준으로 가장 옳은 것은?',
              options: [
                '최소 3g 이상, 최대 50g 이하',
                '최소 5g 이상, 최대 100g 이하',
                '최소 10g 이상, 최대 50g 이하',
                '중량 제한 없이 크기 규격만 충족하면 됨',
              ],
              answer: 1,
              explanation: '규격우편물의 허용 중량은 최소 3g 이상, 최대 50g 이하입니다. 50g을 초과하면 규격외 우편물 요금이 적용됩니다.',
              difficulty: '쉬움',
              category: '제1장 통상우편물 규격요건 및 접수기준',
              source: '우편물 접수 및 요금 실무편람 제1장 3조 (중량 기준)',
              status: '승인',
              qualityCheck: {
                singleAnswer: true,
                sourceSupported: true,
                ambiguity: false,
              },
              createdAt: new Date().toISOString(),
            },
            {
              id: 'q-init-2',
              number: 2,
              question: '다음 중 소포우편물의 최대 규격 제한(무게 및 크기)으로 옳은 것은?',
              options: [
                '최대 중량 20kg 이하, 세 변의 합 140cm 이하',
                '최대 중량 30kg 이하, 세 변의 합 160cm 이하 (한 변 최대 100cm)',
                '최대 중량 30kg 이하, 세 변의 합 180cm 이하 (한 변 최대 120cm)',
                '최대 중량 40kg 이하, 세 변의 합 200cm 이하',
              ],
              answer: 2,
              explanation: '국내 소포우편물의 최대 중량은 30kg 이하이며, 가로·세로·높이 세 변의 합은 최대 160cm 이하, 어느 한 변의 길이도 100cm를 초과할 수 없습니다.',
              difficulty: '보통',
              category: '제3장 소포우편물 취급 및 중량·크기 제한',
              source: '우편물 접수 및 요금 실무편람 제3장 2조 (크기 및 중량 제한)',
              status: '승인',
              qualityCheck: {
                singleAnswer: true,
                sourceSupported: true,
                ambiguity: false,
              },
              createdAt: new Date().toISOString(),
            },
            {
              id: 'q-init-3',
              number: 3,
              question: '내용증명 우편물의 동본 제출 부수와 우체국에서의 보관 기간으로 바르게 짝지어진 것은?',
              options: [
                '동본 2통 - 보관 1년',
                '동본 2통 - 보관 3년',
                '동본 3통 - 보관 3년',
                '동본 3통 - 보관 5년',
              ],
              answer: 3,
              explanation: '내용증명 우편물은 원본 1통, 수취인 송부용 1통, 우체국 보관용 1통 총 3통(동본)을 작성하여 제출해야 하며, 우체국 보관 기간은 접수 다음 날부터 기산하여 3년입니다.',
              difficulty: '보통',
              category: '제4장 부가우편서비스 (등기, 내용증명, 배달증명)',
              source: '우편물 접수 및 요금 실무편람 제4장 2조 (내용증명 제도)',
              status: '승인',
              qualityCheck: {
                singleAnswer: true,
                sourceSupported: true,
                ambiguity: false,
              },
              createdAt: new Date().toISOString(),
            },
            {
              id: 'q-init-4',
              number: 4,
              question: '우체국 창구에서 다량우편물 요금 감액을 신청하려는 고객에 대한 설명 중 틀린 것은?',
              options: [
                '1회 2,000통 이상의 규격우편물에 대하여 사전 구분 제출 시 감액 대상이 된다.',
                '우편물 주소DB 및 바코드를 전산 연계 제출하면 추가 전자감액이 가능하다.',
                '수취인 주소의 우편번호는 5자리 숫자가 정확한 위치에 기재되어야 한다.',
                '규격외 우편물인 경우에도 수량만 2,000통 이상이면 통상 규격감액률과 동일하게 무조건 감액된다.',
              ],
              answer: 4,
              explanation: '규격우편물 기준 감액은 규격요건(치수, 중량 50g 이하)을 충족해야 적용되며, 규격외 우편물에 규격감액률을 무조건 동일 적용하지 않습니다.',
              difficulty: '어려움',
              category: '제2장 국내우편 요금체계 및 다량우편 감액요건',
              source: '우편물 접수 및 요금 실무편람 제2장 3조 (우편요금 감액 제도)',
              status: '승인',
              qualityCheck: {
                singleAnswer: true,
                sourceSupported: true,
                ambiguity: false,
              },
              createdAt: new Date().toISOString(),
            },
          ],
          config: {
            subject: '우편물 접수 및 요금 실무평가',
            questionCount: 4,
            questionType: '4지선다 객관식',
            difficultyRatio: { easy: 25, medium: 50, hard: 25 },
            orientations: ['핵심내용 중심', '규정·기준 적용형'],
            selectedChapters: initialSample.chapters.map((c) => c.name),
          },
        };
        setSavedSessions([sampleSession]);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([sampleSession]));
      }
    } catch (e) {
      console.error('Failed to load saved sessions:', e);
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Actions
  const handleStartNew = () => {
    setDocument(null);
    setQuestions([]);
    setCurrentStep(1); // Go to File Upload
  };

  const handleSelectSample = (sample: ParsedDocument) => {
    setDocument(sample);
    setConfig((prev) => ({
      ...prev,
      subject: sample.title,
      selectedChapters: sample.chapters.map((c) => c.name),
    }));
    setCurrentStep(2); // Go directly to Config
  };

  const handleDocumentLoaded = (doc: ParsedDocument) => {
    setDocument(doc);
    setConfig((prev) => ({
      ...prev,
      subject: doc.title,
      selectedChapters: doc.chapters.map((c) => c.name),
    }));
  };

  const handleClearDocument = () => {
    setDocument(null);
    setQuestions([]);
  };

  const handleOpenSession = (session: SavedExamSession) => {
    setConfig(session.config);
    setQuestions(session.questions);
    const foundDoc = SAMPLE_DOCUMENTS.find((d) => d.fileName === session.fileName);
    if (foundDoc) {
      setDocument(foundDoc);
    } else {
      setDocument({
        id: `doc-${Date.now()}`,
        fileName: session.fileName,
        fileType: 'hwp',
        fileSize: 450000,
        uploadedAt: session.createdAt,
        title: session.subject,
        totalChars: 8000,
        content: '',
        chapters: session.config.selectedChapters.map((c, i) => ({
          id: `chap-${i}`,
          name: c,
          preview: '',
          charCount: 2000,
        })),
        keyTopics: [],
      });
    }
    setCurrentStep(3); // Go to Review
    showToast(`'${session.subject}' 세션을 불러왔습니다.`);
  };

  const handleDeleteSession = (sessionId: string) => {
    const updated = savedSessions.filter((s) => s.id !== sessionId);
    setSavedSessions(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    showToast('저장된 세션이 삭제되었습니다.');
  };

  // Generate Questions via API with resilient error handling
  const handleGenerateQuestions = async () => {
    if (!document) return;

    setIsGenerating(true);
    setErrorDialog(null);

    try {
      const response = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: document.content,
          selectedChapters: config.selectedChapters,
          config,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorText = data.error || '문항 생성에 실패했습니다.';
        const is503 =
          data.isOverloaded ||
          errorText.includes('503') ||
          errorText.includes('high demand') ||
          errorText.includes('UNAVAILABLE');

        if (is503) {
          setErrorDialog({
            title: '구글 AI 모델 일시적 사용량 급증 (503 High Demand 안내)',
            message:
              '구글 Gemini AI 모델에 일시적으로 많은 요청이 집중되어 응답이 지연되었습니다.\n\n현재 설정하신 출제 조건(과목명, 문항 수, 난이도 등)과 업로드된 자료는 모두 안전하게 보존되어 있습니다.\n\n아래 [지금 다시 시도] 버튼을 누르면 대체 고속 모델 클러스터로 연결되어 즉시 문제 생성이 재개됩니다.',
            is503: true,
            onRetry: () => {
              setErrorDialog(null);
              handleGenerateQuestions();
            },
          });
          return;
        }

        throw new Error(errorText);
      }

      setQuestions(data.questions);
      setCurrentStep(3); // Move to Review
      showToast(`${data.questions.length}개의 4지선다형 평가문제가 생성되었습니다.`);
    } catch (err: any) {
      console.error('Generation error:', err);
      const raw = err?.message || String(err);
      const is503 = raw.includes('503') || raw.includes('high demand') || raw.includes('UNAVAILABLE');

      if (is503) {
        setErrorDialog({
          title: '구글 AI 모델 일시적 사용량 급증 (503 안내)',
          message:
            '현재 구글 AI 모델 서버가 일시적인 접속 폭주 상태입니다. 잠시 후 [지금 다시 시도] 버튼을 눌러주세요.',
          is503: true,
          onRetry: () => {
            setErrorDialog(null);
            handleGenerateQuestions();
          },
        });
      } else {
        showToast(raw || '문제 생성 중 오류가 발생했습니다.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Regenerate Single Question via API
  const handleRegenerateQuestion = async (
    targetQuestion: PostalQuestion,
    directives: string[],
    customPrompt: string
  ) => {
    if (!document) return;

    try {
      const response = await fetch('/api/regenerate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: targetQuestion,
          content: document.content,
          directives,
          customPrompt,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorText = data.error || '문제 재생성에 실패했습니다.';
        throw new Error(errorText);
      }

      setQuestions((prev) =>
        prev.map((q) => (q.id === targetQuestion.id ? data.question : q))
      );
      showToast(`${targetQuestion.number}번 문제가 새로 생성되었습니다.`);
    } catch (err: any) {
      console.error('Regenerate error:', err);
      const raw = err?.message || String(err);
      const is503 = raw.includes('503') || raw.includes('high demand') || raw.includes('UNAVAILABLE');

      if (is503) {
        setErrorDialog({
          title: '문제 재생성 지연 안내 (503)',
          message:
            'AI 모델의 일시적 트래픽으로 재생성이 지연되었습니다. [지금 다시 시도]를 누르면 즉시 다시 생성합니다.',
          is503: true,
          onRetry: () => {
            setErrorDialog(null);
            handleRegenerateQuestion(targetQuestion, directives, customPrompt);
          },
        });
      } else {
        showToast(raw);
      }
    }
  };

  // Question manipulation
  const handleApproveQuestion = (id: string) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, status: q.status === '승인' ? '검토중' : '승인' } : q
      )
    );
  };

  const handleApproveAll = () => {
    setQuestions((prev) => prev.map((q) => ({ ...q, status: '승인' })));
    showToast('모든 문항이 승인 처리되었습니다.');
  };

  const handleUpdateQuestion = (updated: PostalQuestion) => {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    showToast(`${updated.number}번 문제가 수정되었습니다.`);
  };

  const handleDeleteQuestion = (id: string) => {
    const updated = questions
      .filter((q) => q.id !== id)
      .map((q, idx) => ({ ...q, number: idx + 1 }));
    setQuestions(updated);
    showToast('문제가 삭제되었습니다.');
  };

  // Save Session to Bank
  const handleSaveToBank = () => {
    if (questions.length === 0) return;

    const approvedCount = questions.filter((q) => q.status === '승인').length;
    const newSession: SavedExamSession = {
      id: `session-${Date.now()}`,
      title: config.subject,
      subject: config.subject,
      fileName: document?.fileName || '우편직무자료.hwp',
      createdAt: new Date().toISOString(),
      questionCount: questions.length,
      approvedCount,
      questions,
      config,
    };

    const updated = [newSession, ...savedSessions.filter((s) => s.subject !== config.subject)];
    setSavedSessions(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    showToast('문제은행 및 최근 출제 작업에 안전하게 저장되었습니다.');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-lg shadow-xl border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Global Header */}
      <Header
        currentStep={currentStep}
        onGoHome={() => setCurrentStep(0)}
        savedCount={savedSessions.length}
        approvedCount={questions.filter((q) => q.status === '승인').length}
        totalQuestions={questions.length}
      />

      {/* Step Progress Bar (Shown when active on steps 1 ~ 4) */}
      {currentStep >= 1 && (
        <StepProgress
          currentStep={currentStep}
          onStepClick={(s) => setCurrentStep(s)}
          canNavigateToStep={(s) => {
            if (s === 1) return true;
            if (s === 2) return !!document;
            if (s === 3) return questions.length > 0;
            if (s === 4) return questions.length > 0;
            if (s === 5) return questions.length > 0;
            return false;
          }}
        />
      )}

      {/* Main View Router */}
      <main className="flex-1">
        {currentStep === 0 && (
          <MainDashboard
            onStartNew={handleStartNew}
            onSelectSample={handleSelectSample}
            savedSessions={savedSessions}
            onOpenSession={handleOpenSession}
            onDeleteSession={handleDeleteSession}
          />
        )}

        {currentStep === 1 && (
          <FileUploadStep
            currentDocument={document}
            onDocumentLoaded={handleDocumentLoaded}
            onClearDocument={handleClearDocument}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && document && (
          <ConfigStep
            document={document}
            config={config}
            onChangeConfig={setConfig}
            onPrev={() => setCurrentStep(1)}
            onGenerate={handleGenerateQuestions}
            isGenerating={isGenerating}
          />
        )}

        {currentStep === 3 && (
          <ReviewStep
            questions={questions}
            subject={config.subject}
            fileName={document?.fileName || '우편직무자료.hwp'}
            onApproveQuestion={handleApproveQuestion}
            onApproveAll={handleApproveAll}
            onUpdateQuestion={handleUpdateQuestion}
            onDeleteQuestion={handleDeleteQuestion}
            onRegenerateQuestion={handleRegenerateQuestion}
            onGoToPrint={() => setCurrentStep(4)}
            onSaveToBank={handleSaveToBank}
          />
        )}

        {currentStep === 4 && (
          <ExamPaperView
            questions={questions}
            subject={config.subject}
            config={config}
            onBackToReview={() => setCurrentStep(3)}
          />
        )}
      </main>

      {/* Generating Overlay */}
      {isGenerating && (
        <GeneratingOverlay
          questionCount={config.questionCount}
          subject={config.subject}
        />
      )}

      {/* Friendly Error & 503 Overload Dialog */}
      {errorDialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {errorDialog.title}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    일시적 AI 서버 트래픽 안내
                  </p>
                </div>
              </div>
              <button
                onClick={() => setErrorDialog(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 text-xs text-slate-600 space-y-2 whitespace-pre-line leading-relaxed">
              {errorDialog.message}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setErrorDialog(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={errorDialog.onRetry}
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-md shadow-xs transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>지금 다시 시도</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
