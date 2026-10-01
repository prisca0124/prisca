import React from 'react';
import {
  FilePlus,
  BookOpen,
  Calendar,
  Clock,
  CheckCircle2,
  FolderOpen,
  ArrowRight,
  ShieldCheck,
  Award,
  Layers,
  Sparkles,
} from 'lucide-react';
import { SavedExamSession, ParsedDocument } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';

interface MainDashboardProps {
  onStartNew: () => void;
  onSelectSample: (doc: ParsedDocument) => void;
  savedSessions: SavedExamSession[];
  onOpenSession: (session: SavedExamSession) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const MainDashboard: React.FC<MainDashboardProps> = ({
  onStartNew,
  onSelectSample,
  savedSessions,
  onOpenSession,
  onDeleteSession,
}) => {
  const totalSavedQuestions = savedSessions.reduce((acc, s) => acc + s.questions.length, 0);
  const totalApprovedQuestions = savedSessions.reduce((acc, s) => acc + s.approvedCount, 0);
  const lastActiveDate = savedSessions.length > 0
    ? new Date(savedSessions[0].createdAt).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '작업 이력 없음';

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6">
      {/* Hero / Main Introduction with Korea Post Red Gradient */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden mb-8">
        <div className="bg-gradient-to-r from-slate-950 via-red-950 to-slate-950 p-8 sm:p-10 text-white border-b border-red-900/40">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-red-600/25 text-red-200 text-xs font-semibold mb-4 border border-red-500/30">
            <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
            <span>공공기관 우편직무 교육 및 역량평가 출제지원</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white mb-3 leading-snug">
            우편직무 평가문제 출제도우미
          </h1>
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl font-normal leading-relaxed">
            우편직무 자료를 바탕으로 평가문제를 빠르고 체계적으로 만들어보세요.
          </p>

          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <button
              onClick={onStartNew}
              className="inline-flex items-center space-x-2.5 px-6 py-3.5 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-base shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              <FilePlus className="w-5 h-5" />
              <span>새 문제 출제하기</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>

            <span className="text-xs text-slate-400">
              * HWP, HWPX, PDF 자료를 업로드하여 바로 출제할 수 있습니다.
            </span>
          </div>
        </div>

        {/* Operational Statistics Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/70 border-t border-slate-200">
          <div className="p-5 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">저장된 세션 수</p>
              <p className="text-xl font-bold text-slate-900">{savedSessions.length}건</p>
            </div>
          </div>

          <div className="p-5 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">누적 출제·저장 문제 수</p>
              <p className="text-xl font-bold text-slate-900">
                {totalSavedQuestions}문항
                {totalApprovedQuestions > 0 && (
                  <span className="text-xs text-emerald-600 font-normal ml-1.5">
                    (승인 {totalApprovedQuestions})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="p-5 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">최근 출제일</p>
              <p className="text-sm font-semibold text-slate-800">{lastActiveDate}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Recent Work Sessions */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-red-600" />
                  <span>최근 출제 작업 목록</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  이전에 검토·저장한 평가문제를 불러와 이어서 작업하거나 문제지를 출력할 수 있습니다.
                </p>
              </div>
            </div>

            {savedSessions.length === 0 ? (
              <div className="py-12 text-center bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                <BookOpen className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-700 mb-1">
                  아직 저장된 최근 작업이 없습니다.
                </p>
                <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                  우편직무 HWP/PDF 자료를 등록하거나 아래 준비된 추천 실무편람으로 첫 평가문제를 출제해보세요.
                </p>
                <button
                  onClick={onStartNew}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition"
                >
                  새 문제 출제 시작
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {savedSessions.map((session) => (
                  <div
                    key={session.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 p-2 rounded-lg transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm text-slate-900">
                          {session.subject}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium">
                          {session.questionCount}문항
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          승인 {session.approvedCount}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 flex items-center space-x-2">
                        <span>근거자료: {session.fileName}</span>
                        <span>•</span>
                        <span>
                          {new Date(session.createdAt).toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => onOpenSession(session)}
                        className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md border border-red-200 transition"
                      >
                        이어서 검토
                      </button>
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                        title="기록 삭제"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Instant Testing with Authentic Postal Handbooks */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
            <div className="flex items-center space-x-2 mb-2">
              <Sparkles className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-bold text-slate-900">
                샘플 직무자료로 바로 체험
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              별도의 HWP 파일이 없어도 공공기관 실제 우편업무 편람 규정을 기반으로 즉시 테스트해볼 수 있습니다.
            </p>

            <div className="space-y-3">
              {SAMPLE_DOCUMENTS.map((sample) => (
                <div
                  key={sample.id}
                  onClick={() => onSelectSample(sample)}
                  className="group cursor-pointer p-3.5 rounded-lg border border-slate-200 hover:border-red-400 hover:bg-red-50/30 transition text-left"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-800 group-hover:text-red-700">
                        {sample.fileName}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                        {sample.title}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 ml-2 whitespace-nowrap">
                      HWP
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>단원 {sample.chapters.length}개 / {sample.totalChars.toLocaleString()}자</span>
                    <span className="text-red-600 group-hover:translate-x-0.5 transition-transform flex items-center text-[11px] font-medium">
                      선택하기 <ArrowRight className="w-3 h-3 ml-0.5" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Public Institution Principles Box */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 text-xs text-slate-600 space-y-2.5">
            <p className="font-bold text-slate-800 flex items-center space-x-1.5">
              <Award className="w-4 h-4 text-red-600" />
              <span>우편직무 출제 6대 원칙</span>
            </p>
            <ul className="space-y-1.5 text-slate-600 list-disc list-inside">
              <li>업로드된 자료에 철저히 근거한 사실만 출제</li>
              <li>4지선다 중 오직 1개만의 명확한 정답 보장</li>
              <li>단순 암기 탈피 및 실무상황·규정적용형 문항</li>
              <li>정답 번호(①~④)의 균등한 통계적 배분</li>
              <li>출제단원 및 근거 조항 구체적 명시</li>
              <li>출제자 중심의 수정·재생성·승인 검토 프로세스</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
