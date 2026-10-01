import React, { useState } from 'react';
import { X, RefreshCw, Sparkles, CheckSquare, Square, AlertCircle } from 'lucide-react';
import { PostalQuestion } from '../types';

interface RegenerateModalProps {
  question: PostalQuestion;
  onRegenerate: (question: PostalQuestion, directives: string[], customPrompt: string) => Promise<void>;
  onClose: () => void;
  isProcessing: boolean;
}

const REGEN_OPTIONS = [
  '난이도를 높여주세요.',
  '난이도를 낮춰주세요.',
  '단순 암기형이 아닌 업무상황형으로 변경',
  '사례 판단형으로 변경',
  '보기의 난이도를 높여주세요.',
  '문제 표현을 명확하게 변경',
  '동일한 출제근거를 활용하여 새로운 문제 생성',
];

export const RegenerateModal: React.FC<RegenerateModalProps> = ({
  question,
  onRegenerate,
  onClose,
  isProcessing,
}) => {
  const [selectedDirectives, setSelectedDirectives] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (opt: string) => {
    if (selectedDirectives.includes(opt)) {
      setSelectedDirectives(selectedDirectives.filter((d) => d !== opt));
    } else {
      setSelectedDirectives([...selectedDirectives, opt]);
    }
  };

  const handleAction = async () => {
    setError(null);
    try {
      await onRegenerate(question, selectedDirectives, customPrompt);
      onClose();
    } catch (err: any) {
      setError(err.message || '문제 재생성 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                문제 {question.number}번 AI 다시 출제 (재생성)
              </h3>
              <p className="text-[11px] text-slate-500">
                업로드된 원본 자료의 근거 범위 내에서 개선 방향을 반영합니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-50 text-red-700 text-xs rounded-lg flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Existing Question Summary */}
        <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
          <p className="text-[11px] font-semibold text-slate-500 mb-0.5">
            기존 발문:
          </p>
          <p className="text-slate-800 font-medium line-clamp-2">
            {question.question}
          </p>
          <p className="text-[11px] text-red-700 mt-1">
            출제근거: {question.source}
          </p>
        </div>

        {/* Direction Options */}
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-slate-800">
            어떤 방향으로 다시 만들까요? (복수 선택 가능)
          </p>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {REGEN_OPTIONS.map((opt) => {
              const isChecked = selectedDirectives.includes(opt);
              return (
                <div
                  key={opt}
                  onClick={() => handleToggle(opt)}
                  className={`p-2.5 rounded-lg border cursor-pointer text-xs transition flex items-center space-x-2.5 ${
                    isChecked
                      ? 'border-red-500 bg-red-50/50 text-red-900 font-semibold'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="text-red-600 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 fill-red-600 text-white" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </span>
                  <span>{opt}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom Prompt Input */}
        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-700 mb-1">
            출제자 추가 요청사항 (선택사항)
          </label>
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="예: 실제 우체국 창구에서 발생할 수 있는 상황으로 바꿔주세요."
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleAction}
            className="inline-flex items-center space-x-1.5 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:bg-slate-400 rounded-md shadow-xs transition"
          >
            {isProcessing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>재생성 중...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>재생성</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
