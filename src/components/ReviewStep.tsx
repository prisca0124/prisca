import React, { useState } from 'react';
import {
  CheckCircle2,
  Edit,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Check,
  Printer,
  Save,
  BarChart3,
  Layers,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ShieldCheck,
  FileCheck,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { PostalQuestion } from '../types';
import { sanitizeQuestionStem, sanitizeOptionText } from '../utils/sanitizeQuestion';
import { EditQuestionModal } from './EditQuestionModal';
import { RegenerateModal } from './RegenerateModal';

interface ReviewStepProps {
  questions: PostalQuestion[];
  subject: string;
  fileName: string;
  onApproveQuestion: (id: string) => void;
  onApproveAll: () => void;
  onUpdateQuestion: (question: PostalQuestion) => void;
  onDeleteQuestion: (id: string) => void;
  onRegenerateQuestion: (
    question: PostalQuestion,
    directives: string[],
    customPrompt: string
  ) => Promise<void>;
  onGoToPrint: () => void;
  onSaveToBank: () => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  questions,
  subject,
  fileName,
  onApproveQuestion,
  onApproveAll,
  onUpdateQuestion,
  onDeleteQuestion,
  onRegenerateQuestion,
  onGoToPrint,
  onSaveToBank,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'warning'>('all');
  const [editingQuestion, setEditingQuestion] = useState<PostalQuestion | null>(null);
  const [regeneratingQuestion, setRegeneratingQuestion] = useState<PostalQuestion | null>(null);
  const [isProcessingRegen, setIsProcessingRegen] = useState(false);

  // Statistics
  const total = questions.length;
  const approved = questions.filter((q) => q.status === '승인').length;
  const pending = questions.filter((q) => q.status === '검토중' || q.status === '수정됨').length;
  const warnings = questions.filter(
    (q) => q.status === '근거확인필요' || (q.qualityCheck.alerts && q.qualityCheck.alerts.length > 0)
  ).length;

  // Answer distribution
  const answerCounts = [1, 2, 3, 4].map(
    (num) => questions.filter((q) => q.answer === num).length
  );

  const filteredQuestions = questions.filter((q) => {
    if (filter === 'approved') return q.status === '승인';
    if (filter === 'pending') return q.status === '검토중' || q.status === '수정됨';
    if (filter === 'warning') {
      return (
        q.status === '근거확인필요' ||
        (q.qualityCheck.alerts && q.qualityCheck.alerts.length > 0)
      );
    }
    return true;
  });

  const handleRegenSubmit = async (
    q: PostalQuestion,
    directives: string[],
    customPrompt: string
  ) => {
    setIsProcessingRegen(true);
    try {
      await onRegenerateQuestion(q, directives, customPrompt);
      setRegeneratingQuestion(null);
    } finally {
      setIsProcessingRegen(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4 mb-6">
        <div>
          <div className="flex items-center space-x-2 text-red-700 font-semibold text-xs tracking-wider uppercase mb-1">
            <span>단계 3</span>
            <span>•</span>
            <span>생성문제 검토</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            ③ 생성문제 검토
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            근거자료: <strong className="text-slate-700">{fileName}</strong> • 과목:{' '}
            <strong className="text-slate-700">{subject}</strong>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onApproveAll}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-300 transition"
          >
            <Check className="w-4 h-4" />
            <span>전체 일괄 승인</span>
          </button>

          <button
            onClick={onSaveToBank}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-lg border border-slate-300 transition shadow-xs"
          >
            <Save className="w-4 h-4 text-red-600" />
            <span>문제은행 저장</span>
          </button>

          <button
            onClick={onGoToPrint}
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg shadow-xs transition"
          >
            <Printer className="w-4 h-4" />
            <span>문제지 보기 / 출력</span>
            <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>
      </div>

      {/* Overview & Distribution Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Approved Count */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] text-slate-500 font-medium">승인 완료 문항</p>
            <p className="text-lg font-bold text-slate-900">
              {approved} / {total}문항
            </p>
          </div>
        </div>

        {/* Pending Count */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <Edit className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] text-slate-500 font-medium">검토 대기 문항</p>
            <p className="text-lg font-bold text-slate-900">{pending}문항</p>
          </div>
        </div>

        {/* Alerts Count */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] text-slate-500 font-medium">근거·모호성 주의</p>
            <p className="text-lg font-bold text-slate-900">{warnings}문항</p>
          </div>
        </div>

        {/* Answer Position Distribution Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-slate-500 font-semibold flex items-center space-x-1">
              <BarChart3 className="w-3.5 h-3.5 text-red-600" />
              <span>정답 위치 자동 분산</span>
            </p>
            <span className="text-[10px] text-slate-400">균등 배분 원칙</span>
          </div>

          <div className="grid grid-cols-4 gap-1 text-center">
            {['①', '②', '③', '④'].map((label, idx) => (
              <div key={idx} className="bg-slate-50 p-1 rounded border border-slate-100">
                <span className="text-[10px] text-slate-500 block font-semibold">{label}</span>
                <span className="text-xs font-bold text-slate-800">{answerCounts[idx]}개</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between pb-3 mb-4 text-xs">
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md font-semibold transition ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            전체 ({total})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1.5 rounded-md font-semibold transition ${
              filter === 'pending'
                ? 'bg-white text-red-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            검토중 ({pending})
          </button>
          <button
            onClick={() => setFilter('approved')}
            className={`px-3 py-1.5 rounded-md font-semibold transition ${
              filter === 'approved'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            승인완료 ({approved})
          </button>
          {warnings > 0 && (
            <button
              onClick={() => setFilter('warning')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                filter === 'warning'
                  ? 'bg-white text-amber-800 shadow-xs'
                  : 'text-amber-700 hover:text-amber-900'
              }`}
            >
              확인필요 ({warnings})
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-500 hidden sm:block">
          출제자가 각 문제를 검토한 후 승인하거나 수정·재생성할 수 있습니다.
        </p>
      </div>

      {/* Question Cards List */}
      <div className="space-y-5">
        {filteredQuestions.map((q) => {
          const isApproved = q.status === '승인';
          const hasWarning =
            q.status === '근거확인필요' ||
            (q.qualityCheck.alerts && q.qualityCheck.alerts.length > 0);

          return (
            <div
              key={q.id}
              className={`bg-white rounded-xl border transition-all ${
                isApproved
                  ? 'border-emerald-300 ring-1 ring-emerald-200'
                  : hasWarning
                  ? 'border-amber-300'
                  : 'border-slate-200 hover:border-slate-300'
              } shadow-xs overflow-hidden`}
            >
              {/* Card Header Bar */}
              <div className="bg-slate-50/80 px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
                    {q.number}
                  </span>

                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                    {q.category}
                  </span>

                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                      q.difficulty === '쉬움'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : q.difficulty === '어려움'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    난이도: {q.difficulty}
                  </span>

                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      isApproved
                        ? 'bg-emerald-100 text-emerald-800'
                        : q.status === '수정됨'
                        ? 'bg-purple-100 text-purple-800'
                        : hasWarning
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {q.status}
                  </span>
                </div>

                {/* Card Action Buttons */}
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => onApproveQuestion(q.id)}
                    className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                      isApproved
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-300'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isApproved ? '승인됨' : '승인'}</span>
                  </button>

                  <button
                    onClick={() => setEditingQuestion(q)}
                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition"
                  >
                    <Edit className="w-3.5 h-3.5 text-slate-500" />
                    <span>수정</span>
                  </button>

                  <button
                    onClick={() => setRegeneratingQuestion(q)}
                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-md transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-red-600" />
                    <span>재생성</span>
                  </button>

                  <button
                    onClick={() => onDeleteQuestion(q.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                    title="문제 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 space-y-4">
                {/* Question Stem */}
                <div className="text-sm font-bold text-slate-900 leading-relaxed">
                  {q.number}. {sanitizeQuestionStem(q.question)}
                </div>

                {/* 4 Options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {q.options.map((opt, optIdx) => {
                    const isCorrect = q.answer === optIdx + 1;
                    const optSymbol = ['①', '②', '③', '④'][optIdx];

                    return (
                      <div
                        key={optIdx}
                        className={`p-2.5 rounded-lg border transition flex items-start space-x-2 ${
                          isCorrect
                            ? 'bg-emerald-50/70 border-emerald-400 text-emerald-950 font-medium'
                            : 'bg-slate-50/50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <span className="font-bold text-xs shrink-0 text-slate-800">
                          {optSymbol}
                        </span>
                        <span className="flex-1 leading-normal">{sanitizeOptionText(opt)}</span>
                        {isCorrect && (
                          <span className="text-[10px] font-bold bg-emerald-600 text-white px-1.5 py-0.2 rounded shrink-0">
                            정답
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Explanation */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="font-bold text-slate-800">
                      [정답: {['①', '②', '③', '④'][q.answer - 1]}]
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-500 font-semibold">해설:</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{q.explanation}</p>
                </div>

                {/* Source Citation & Quality Check Bar */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2 border-t border-slate-100">
                  <div className="flex items-center space-x-1.5 text-slate-600">
                    <span className="font-bold text-slate-700 shrink-0">출제근거:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] ${
                        q.source.includes('확인 필요')
                          ? 'bg-amber-100 text-amber-900 font-bold'
                          : 'bg-red-50 text-red-900'
                      }`}
                    >
                      {q.source}
                    </span>
                  </div>

                  <div className="flex items-center flex-wrap gap-1.5">
                    {q.qualityCheck.sourceSupported ? (
                      <span className="inline-flex items-center space-x-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>근거 확인</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-semibold">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>근거 재확인 요망</span>
                      </span>
                    )}

                    {q.qualityCheck.singleAnswer && (
                      <span className="inline-flex items-center space-x-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>단일 정답</span>
                      </span>
                    )}

                    <span className="inline-flex items-center space-x-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      <span>4지선다 형식</span>
                    </span>

                    {q.qualityCheck.alerts &&
                      q.qualityCheck.alerts.map((alert, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center space-x-1 text-[11px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded font-semibold"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>{alert}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredQuestions.length === 0 && (
          <div className="py-12 text-center bg-white rounded-xl border border-slate-200">
            <p className="text-sm font-semibold text-slate-700">해당 필터에 문항이 없습니다.</p>
            <button
              onClick={() => setFilter('all')}
              className="mt-2 text-xs text-red-600 underline font-medium"
            >
              전체 문항 보기
            </button>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="mt-8 p-4 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-slate-600">
          전체 <strong>{total}문항</strong> 중 <strong>{approved}문항</strong> 승인 완료
          {pending > 0 && <span className="text-red-600 ml-1">({pending}문항 검토 대기)</span>}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onSaveToBank}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-lg border border-slate-300 transition"
          >
            문제은행 저장
          </button>
          <button
            onClick={onGoToPrint}
            className="inline-flex items-center space-x-1.5 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg shadow-xs transition"
          >
            <Printer className="w-4 h-4" />
            <span>최종 문제지 및 정답해설 출력</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Modals */}
      {editingQuestion && (
        <EditQuestionModal
          question={editingQuestion}
          onSave={(updated) => {
            onUpdateQuestion(updated);
            setEditingQuestion(null);
          }}
          onClose={() => setEditingQuestion(null)}
        />
      )}

      {regeneratingQuestion && (
        <RegenerateModal
          question={regeneratingQuestion}
          onRegenerate={handleRegenSubmit}
          onClose={() => setRegeneratingQuestion(null)}
          isProcessing={isProcessingRegen}
        />
      )}
    </div>
  );
};
