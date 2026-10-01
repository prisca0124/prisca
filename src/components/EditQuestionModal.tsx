import React, { useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { PostalQuestion, DifficultyLevel } from '../types';

interface EditQuestionModalProps {
  question: PostalQuestion;
  onSave: (updatedQuestion: PostalQuestion) => void;
  onClose: () => void;
}

export const EditQuestionModal: React.FC<EditQuestionModalProps> = ({
  question,
  onSave,
  onClose,
}) => {
  const [questionText, setQuestionText] = useState(question.question);
  const [option1, setOption1] = useState(question.options[0]);
  const [option2, setOption2] = useState(question.options[1]);
  const [option3, setOption3] = useState(question.options[2]);
  const [option4, setOption4] = useState(question.options[3]);
  const [answer, setAnswer] = useState<1 | 2 | 3 | 4>(question.answer);
  const [explanation, setExplanation] = useState(question.explanation);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(question.difficulty);
  const [category, setCategory] = useState(question.category);
  const [source, setSource] = useState(question.source);

  const handleSave = () => {
    const updated: PostalQuestion = {
      ...question,
      question: questionText.trim(),
      options: [option1.trim(), option2.trim(), option3.trim(), option4.trim()],
      answer,
      explanation: explanation.trim(),
      difficulty,
      category: category.trim(),
      source: source.trim(),
      status: '수정됨',
      updatedAt: new Date().toISOString(),
    };
    onSave(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <span className="w-7 h-7 rounded-md bg-red-600 text-white flex items-center justify-center text-xs font-bold">
              {question.number}
            </span>
            <h3 className="text-base font-bold text-slate-900">
              문제 직접 수정
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Category & Difficulty Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                출제 단원 / 영역
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                난이도
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
              >
                <option value="쉬움">쉬움</option>
                <option value="보통">보통</option>
                <option value="어려움">어려움</option>
              </select>
            </div>
          </div>

          {/* Question Text */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              문제 발문
            </label>
            <textarea
              rows={3}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Options & Answer Selection */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700">
              보기 4개 및 정답 지정 (라디오 버튼으로 정답 선택)
            </label>

            {[
              { num: 1, val: option1, set: setOption1, label: '①' },
              { num: 2, val: option2, set: setOption2, label: '②' },
              { num: 3, val: option3, set: setOption3, label: '③' },
              { num: 4, val: option4, set: setOption4, label: '④' },
            ].map((opt) => (
              <div
                key={opt.num}
                className={`flex items-center space-x-2 p-2 rounded-lg border transition ${
                  answer === opt.num
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <label className="flex items-center space-x-1.5 cursor-pointer pl-1">
                  <input
                    type="radio"
                    name="correct-answer"
                    checked={answer === opt.num}
                    onChange={() => setAnswer(opt.num as any)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-bold text-slate-700 w-5">
                    {opt.label}
                  </span>
                </label>

                <input
                  type="text"
                  value={opt.val}
                  onChange={(e) => opt.set(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                />

                {answer === opt.num && (
                  <span className="text-[11px] font-bold text-emerald-700 px-2 py-0.5 rounded bg-emerald-100 whitespace-nowrap">
                    정답
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Explanation */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              정답 및 상세 해설
            </label>
            <textarea
              rows={3}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Source Basis */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              출제 근거 (자료 내 단원, 페이지 또는 규정 조항)
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="예: 우편물 접수 및 요금 실무편람 제1장 3조 (p.15)"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-xs transition"
          >
            수정 저장
          </button>
        </div>
      </div>
    </div>
  );
};
