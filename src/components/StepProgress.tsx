import React from 'react';
import { UploadCloud, Sliders, Sparkles, CheckSquare, Printer } from 'lucide-react';

interface StepProgressProps {
  currentStep: number; // 1: 자료등록, 2: 출제조건, 3: 문제생성, 4: 문제검토, 5: 시험지출력
  onStepClick?: (step: number) => void;
  canNavigateToStep?: (step: number) => boolean;
}

const steps = [
  { id: 1, title: '자료 등록', icon: UploadCloud, desc: 'HWP/자료 업로드' },
  { id: 2, title: '출제조건', icon: Sliders, desc: '문항수·난이도·범위' },
  { id: 3, title: '문제 생성', icon: Sparkles, desc: '자료근거 AI 초안' },
  { id: 4, title: '문제 검토', icon: CheckSquare, desc: '승인·수정·재생성' },
  { id: 5, title: '문제지 출력', icon: Printer, desc: '시험지·정답해설' },
];

export const StepProgress: React.FC<StepProgressProps> = ({
  currentStep,
  onStepClick,
  canNavigateToStep,
}) => {
  return (
    <div className="bg-white border-b border-slate-200 py-3 shadow-xs print:hidden">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <nav aria-label="Progress">
          <ol className="flex items-center justify-between">
            {steps.map((step, idx) => {
              const isCurrent = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              const isClickable = canNavigateToStep ? canNavigateToStep(step.id) : isCompleted;
              const Icon = step.icon;

              return (
                <li
                  key={step.id}
                  className={`relative flex-1 ${idx !== steps.length - 1 ? 'pr-4 sm:pr-8' : ''}`}
                >
                  <div className="flex items-center">
                    {/* Step Bubble */}
                    <button
                      type="button"
                      disabled={!isClickable && !isCurrent}
                      onClick={() => isClickable && onStepClick && onStepClick(step.id)}
                      className={`group flex items-center text-left ${
                        isClickable ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span
                        className={`w-9 h-9 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${
                          isCurrent
                            ? 'bg-red-600 text-white ring-4 ring-red-100 shadow-xs'
                            : isCompleted
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'bg-slate-100 text-slate-500 border border-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="ml-3 hidden md:block">
                        <span
                          className={`text-xs block font-semibold ${
                            isCurrent
                              ? 'text-red-700'
                              : isCompleted
                              ? 'text-slate-800'
                              : 'text-slate-500'
                          }`}
                        >
                          {step.title}
                        </span>
                        <span className="text-[11px] text-slate-400 block leading-tight">
                          {step.desc}
                        </span>
                      </span>
                    </button>

                    {/* Connecting Line */}
                    {idx !== steps.length - 1 && (
                      <div className="hidden sm:block flex-1 ml-4 mr-2">
                        <div
                          className={`h-0.5 w-full ${
                            isCompleted ? 'bg-slate-800' : 'bg-slate-200'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
};
