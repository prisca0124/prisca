import React from 'react';
import { Mail, BookOpen, RotateCcw, FileText, CheckCircle2 } from 'lucide-react';

interface HeaderProps {
  currentStep: number;
  onGoHome: () => void;
  savedCount: number;
  approvedCount: number;
  totalQuestions: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep,
  onGoHome,
  savedCount,
  approvedCount,
  totalQuestions,
}) => {
  return (
    <header className="bg-slate-950 text-white border-b border-red-950 sticky top-0 z-30 shadow-sm print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Service Title */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={onGoHome}>
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-md">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">우편직무 평가문제 출제도우미</span>
                <span className="text-xs bg-red-900/80 text-red-200 px-2 py-0.5 rounded font-medium border border-red-800">
                  우정직무평가 시스템
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                우편직무 교육·업무자료(HWP) 기반 객관식 4지선다 출제 지원
              </p>
            </div>
          </div>

          {/* Status & Quick Stats */}
          <div className="flex items-center space-x-4">
            {totalQuestions > 0 && currentStep >= 3 && (
              <div className="hidden md:flex items-center space-x-3 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
                <div className="flex items-center space-x-1.5 text-slate-300">
                  <FileText className="w-4 h-4 text-red-400" />
                  <span>전체 문항: <strong className="text-white">{totalQuestions}</strong></span>
                </div>
                <span className="text-slate-700">|</span>
                <div className="flex items-center space-x-1.5 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>승인 완료: <strong className="text-emerald-300">{approvedCount}</strong>/{totalQuestions}</span>
                </div>
              </div>
            )}

            <button
              onClick={onGoHome}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-md border border-slate-800 transition"
              title="메인 홈으로 이동"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>처음으로</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
