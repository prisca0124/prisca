import React, { useState } from 'react';
import {
  Printer,
  FileText,
  CheckCircle,
  Copy,
  Download,
  ArrowLeft,
  Check,
  Award,
  Layers,
} from 'lucide-react';
import { PostalQuestion, ExamConfig } from '../types';
import { sanitizeQuestionStem, sanitizeOptionText } from '../utils/sanitizeQuestion';

interface ExamPaperViewProps {
  questions: PostalQuestion[];
  subject: string;
  config: ExamConfig;
  onBackToReview: () => void;
}

export const ExamPaperView: React.FC<ExamPaperViewProps> = ({
  questions,
  subject,
  config,
  onBackToReview,
}) => {
  const [viewMode, setViewMode] = useState<'questions-only' | 'with-answers' | 'answers-only'>(
    'questions-only'
  );
  const [copied, setCopied] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    let text = `[ ${subject} - 평가문제지 ]\n\n`;

    questions.forEach((q, idx) => {
      text += `${idx + 1}. ${sanitizeQuestionStem(q.question)}\n`;
      text += `  ① ${sanitizeOptionText(q.options[0])}\n`;
      text += `  ② ${sanitizeOptionText(q.options[1])}\n`;
      text += `  ③ ${sanitizeOptionText(q.options[2])}\n`;
      text += `  ④ ${sanitizeOptionText(q.options[3])}\n\n`;
    });

    text += `\n[ 정답 및 해설 ]\n\n`;
    questions.forEach((q, idx) => {
      text += `${idx + 1}번: 정답 ${['①', '②', '③', '④'][q.answer - 1]}\n`;
      text += `  - 해설: ${q.explanation}\n`;
      text += `  - 출제근거: ${q.source}\n\n`;
    });

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    const data = {
      subject,
      totalQuestions: questions.length,
      createdAt: new Date().toISOString(),
      config,
      questions,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${subject}_우편직무평가문제.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Control Navigation Bar (Hidden during print) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-6 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <button
              onClick={onBackToReview}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-md border border-slate-300 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>검토 화면으로</span>
            </button>
            <span className="text-xs text-slate-500">
              총 <strong className="text-slate-800">{questions.length}문항</strong> 확정
            </span>
          </div>

          {/* View Mode Tabs */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setViewMode('questions-only')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                viewMode === 'questions-only'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              문제지 보기 (수험자용)
            </button>
            <button
              onClick={() => setViewMode('with-answers')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                viewMode === 'with-answers'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              문제 + 정답해설 함께 보기
            </button>
            <button
              onClick={() => setViewMode('answers-only')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                viewMode === 'answers-only'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              정답 및 해설지만 보기
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyText}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition"
              title="한글(HWP)/워드에 붙여넣기 위한 텍스트 복사"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">복사 완료</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>텍스트 복사</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadJson}
              className="p-1.5 text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition"
              title="JSON 다운로드"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={handlePrint}
              className="inline-flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-md shadow-xs transition"
            >
              <Printer className="w-4 h-4" />
              <span>인쇄하기 (PDF 저장)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Official Exam Sheet Container (Print Friendly Layout) */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-sm p-8 sm:p-12 print:border-none print:shadow-none print:p-0">
        {/* Exam Official Header */}
        <div className="border-b-2 border-slate-900 pb-5 mb-8 text-center">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2 border-b border-slate-200 pb-2">
            <span>우편직무 역량평가</span>
            <span>4지선다형 객관식 ({questions.length}문항)</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-wide font-serif py-1">
            {subject}
          </h1>

          <div className="mt-4 flex items-center justify-between text-xs border border-slate-300 p-2.5 rounded bg-slate-50/50">
            <div className="flex items-center space-x-4">
              <span>수험번호: ____________________</span>
              <span>성명: ____________________</span>
            </div>
            <div className="text-slate-500 font-medium">
              * 문제지에 수험번호와 성명을 정확히 기재하십시오.
            </div>
          </div>
        </div>

        {/* MODE 1 & 2: Questions Section */}
        {viewMode !== 'answers-only' && (
          <div className="space-y-8">
            {questions.map((q, idx) => {
              const showAnswer = viewMode === 'with-answers';

              return (
                <div key={q.id} className="break-inside-avoid text-slate-900 text-sm">
                  {/* Question Stem */}
                  <div className="font-semibold text-base mb-2.5 flex items-start">
                    <span className="w-6 shrink-0">{idx + 1}.</span>
                    <span className="leading-snug">{sanitizeQuestionStem(q.question)}</span>
                  </div>

                  {/* 4 Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 pl-6 text-sm">
                    {q.options.map((opt, optIdx) => {
                      const isCorrect = q.answer === optIdx + 1;
                      const symbol = ['①', '②', '③', '④'][optIdx];

                      return (
                        <div
                          key={optIdx}
                          className={`flex items-start space-x-1.5 ${
                            showAnswer && isCorrect
                              ? 'font-bold text-red-900 bg-red-50/80 px-2 py-0.5 rounded'
                              : 'text-slate-800'
                          }`}
                        >
                          <span className="shrink-0">{symbol}</span>
                          <span className="leading-normal">{sanitizeOptionText(opt)}</span>
                          {showAnswer && isCorrect && (
                            <span className="text-[11px] text-red-600 ml-1 font-semibold">
                              (정답)
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Answer and Explanation Box */}
                  {showAnswer && (
                    <div className="mt-3 ml-6 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700">
                      <div className="flex items-center space-x-2 font-bold mb-1">
                        <span className="text-red-700">
                          [정답: {['①', '②', '③', '④'][q.answer - 1]}]
                        </span>
                        <span className="text-slate-400">|</span>
                        <span>출제근거: {q.source}</span>
                      </div>
                      <p className="leading-relaxed">{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* MODE 2 & 3: Answer & Explanation Table */}
        {(viewMode === 'answers-only' || viewMode === 'with-answers') && (
          <div className={`mt-12 pt-8 ${viewMode === 'with-answers' ? 'border-t-2 border-slate-900' : ''}`}>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-slate-900 font-serif">
                [ 정답 및 해설표 ]
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                과목명: {subject} • 총 {questions.length}문항
              </p>
            </div>

            {/* Answer Grid Table */}
            <div className="overflow-x-auto mb-8">
              <table className="w-full text-center border-collapse border border-slate-300 text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-bold">
                    <th className="border border-slate-300 py-1.5 px-2">문항</th>
                    {questions.map((_, i) => (
                      <th key={i} className="border border-slate-300 py-1.5 px-2">
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="font-bold text-red-800">
                    <td className="border border-slate-300 py-2 bg-slate-50">정답</td>
                    {questions.map((q, i) => (
                      <td key={i} className="border border-slate-300 py-2 text-sm">
                        {['①', '②', '③', '④'][q.answer - 1]}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Detailed Explanations & Sources */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                문항별 상세 해설 및 출제 근거
              </h3>

              {questions.map((q, idx) => (
                <div key={q.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div className="flex items-center space-x-2 font-bold mb-1 text-slate-800">
                    <span>
                      {idx + 1}번 [정답: {['①', '②', '③', '④'][q.answer - 1]}]
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-red-700">출제단원: {q.category}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-emerald-700">출제근거: {q.source}</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{q.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clean Official Footer */}
        <div className="mt-12 pt-4 border-t border-slate-300 text-center text-xs text-slate-500 flex items-center justify-between">
          <span>우편직무 평가문제 출제도우미</span>
          <span>- {subject} -</span>
          <span>우정직무평가</span>
        </div>
      </div>
    </div>
  );
};
