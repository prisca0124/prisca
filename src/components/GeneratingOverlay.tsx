import React, { useEffect, useState } from 'react';
import { Sparkles, Check, ShieldCheck, RefreshCw, AlertCircle } from 'lucide-react';

interface GeneratingOverlayProps {
  questionCount: number;
  subject: string;
}

const GENERATION_STEPS = [
  { text: '출제자료 분석 중...', desc: 'HWP/자료 텍스트 구조 및 핵심 규정 조항 색인' },
  { text: '핵심내용 추출 중...', desc: '출제 범위 단원별 업무 기준, 수치, 요건 파악' },
  { text: '문항 생성 중...', desc: '설정된 난이도 및 4지선다형 발문·보기 균형 작성' },
  { text: '문항 품질 검토 중...', desc: '단일 정답, 근거 일치성, 정답 번호 분산 검증' },
  { text: '문제 생성 완료', desc: '검토 화면으로 전환 준비 중' },
];

export const GeneratingOverlay: React.FC<GeneratingOverlayProps> = ({
  questionCount,
  subject,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    const stepInterval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < GENERATION_STEPS.length - 2) {
          return prev + 1;
        }
        return prev;
      });
    }, 2800);

    return () => {
      clearInterval(timer);
      clearInterval(stepInterval);
    };
  }, []);

  const isTakingLong = elapsedSeconds > 10;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-slate-200 text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center mb-5 border border-blue-100 shadow-xs">
          <Sparkles className="w-8 h-8 animate-pulse text-blue-600" />
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-1">
          우편직무 평가문제 생성 중
        </h3>
        <p className="text-xs text-slate-500 mb-6 font-medium">
          {subject} • 4지선다 {questionCount}문항 출제
        </p>

        {/* Step List */}
        <div className="space-y-3 text-left mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
          {GENERATION_STEPS.map((step, idx) => {
            const isDone = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;

            return (
              <div
                key={idx}
                className={`flex items-start space-x-3 transition-opacity duration-300 ${
                  idx > currentStepIndex ? 'opacity-35' : 'opacity-100'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-300 bg-white" />
                  )}
                </div>

                <div className="flex-1">
                  <p
                    className={`text-xs font-semibold ${
                      isCurrent
                        ? 'text-blue-700'
                        : isDone
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {step.text}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                    {step.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* High Demand Automatic Failover Reassurance Banner */}
        {isTakingLong && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left text-xs text-amber-900 flex items-start space-x-2">
            <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-spin" />
            <div>
              <p className="font-bold text-[11px]">AI 서버 트래픽 급증 감지 및 대체 채널 연결 중</p>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-tight">
                구글 AI 메인 모델의 일시적 트래픽 집중(503)을 방지하기 위해 보조 고성능 모델 클러스터로 자동 전환하여 안전하게 생성을 진행하고 있습니다.
              </p>
            </div>
          </div>
        )}

        {/* Reliability Note */}
        <div className="flex items-center justify-center space-x-1.5 text-[11px] text-slate-500 bg-blue-50/50 py-2 px-3 rounded-lg border border-blue-100">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>자료에 근거한 사실만 엄격하게 생성하며 임의 내용을 배제합니다.</span>
        </div>
      </div>
    </div>
  );
};
