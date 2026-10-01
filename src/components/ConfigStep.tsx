import React, { useState } from 'react';
import {
  Sliders,
  CheckSquare,
  Square,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  HelpCircle,
  Percent,
} from 'lucide-react';
import { ExamConfig, ParsedDocument } from '../types';

interface ConfigStepProps {
  document: ParsedDocument;
  config: ExamConfig;
  onChangeConfig: (newConfig: ExamConfig) => void;
  onPrev: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

const AVAILABLE_ORIENTATIONS = [
  { id: '핵심내용 중심', label: '핵심내용 중심', desc: '우편직무의 핵심 정의 및 필수 원칙 확인' },
  { id: '업무상황 중심', label: '업무상황 중심', desc: '우체국 창구 접수 및 배달 현장 실무상황 적용' },
  { id: '규정·기준 적용형', label: '규정·기준 적용형', desc: '우편법령, 수수료, 치수·중량 규정 적용력 평가' },
  { id: '사례 판단형', label: '사례 판단형', desc: '고객 분쟁, 위험물 의심, 배상 청구 등 실제 사례 해결' },
  { id: '개념 이해형', label: '개념 이해형', desc: '우편상품 및 부가서비스 개념의 정확한 이해' },
  { id: '숫자·기준 확인형', label: '숫자·기준 확인형', desc: '보관기간, 감액률, 요금 기준 등 정확한 수치 검증' },
];

export const ConfigStep: React.FC<ConfigStepProps> = ({
  document,
  config,
  onChangeConfig,
  onPrev,
  onGenerate,
  isGenerating,
}) => {
  const [subject, setSubject] = useState(config.subject || document.title || '우편직무 실무평가');
  const [questionCount, setQuestionCount] = useState<number>(config.questionCount || 10);
  const [easyRatio, setEasyRatio] = useState<number>(config.difficultyRatio.easy);
  const [mediumRatio, setMediumRatio] = useState<number>(config.difficultyRatio.medium);
  const [hardRatio, setHardRatio] = useState<number>(config.difficultyRatio.hard);
  const [orientations, setOrientations] = useState<string[]>(
    config.orientations.length > 0 ? config.orientations : ['핵심내용 중심', '업무상황 중심']
  );
  const [selectedChapters, setSelectedChapters] = useState<string[]>(
    config.selectedChapters.length > 0
      ? config.selectedChapters
      : document.chapters.map((c) => c.name)
  );

  const ratioSum = Number(easyRatio) + Number(mediumRatio) + Number(hardRatio);
  const isRatioValid = ratioSum === 100;

  const handleToggleOrientation = (item: string) => {
    let updated: string[];
    if (orientations.includes(item)) {
      updated = orientations.filter((o) => o !== item);
    } else {
      updated = [...orientations, item];
    }
    if (updated.length === 0) {
      updated = ['핵심내용 중심', '업무상황 중심'];
    }
    setOrientations(updated);
    updateGlobalConfig({ orientations: updated });
  };

  const handleToggleChapter = (chapterName: string) => {
    let updated: string[];
    if (selectedChapters.includes(chapterName)) {
      updated = selectedChapters.filter((c) => c !== chapterName);
    } else {
      updated = [...selectedChapters, chapterName];
    }
    setSelectedChapters(updated);
    updateGlobalConfig({ selectedChapters: updated });
  };

  const handleToggleAllChapters = () => {
    if (selectedChapters.length === document.chapters.length) {
      const updated = [document.chapters[0]?.name || '전체'];
      setSelectedChapters(updated);
      updateGlobalConfig({ selectedChapters: updated });
    } else {
      const updated = document.chapters.map((c) => c.name);
      setSelectedChapters(updated);
      updateGlobalConfig({ selectedChapters: updated });
    }
  };

  const updateGlobalConfig = (overrides: Partial<ExamConfig> = {}) => {
    onChangeConfig({
      subject,
      questionCount,
      questionType: '4지선다 객관식',
      difficultyRatio: {
        easy: Number(easyRatio),
        medium: Number(mediumRatio),
        hard: Number(hardRatio),
      },
      orientations,
      selectedChapters,
      ...overrides,
    });
  };

  const handleRatioChange = (type: 'easy' | 'medium' | 'hard', value: number) => {
    const val = Math.max(0, Math.min(100, isNaN(value) ? 0 : value));
    if (type === 'easy') setEasyRatio(val);
    if (type === 'medium') setMediumRatio(val);
    if (type === 'hard') setHardRatio(val);

    const newEasy = type === 'easy' ? val : easyRatio;
    const newMed = type === 'medium' ? val : mediumRatio;
    const newHard = type === 'hard' ? val : hardRatio;

    onChangeConfig({
      ...config,
      difficultyRatio: { easy: newEasy, medium: newMed, hard: newHard },
    });
  };

  const handleAutoBalance = () => {
    setEasyRatio(20);
    setMediumRatio(60);
    setHardRatio(20);
    onChangeConfig({
      ...config,
      difficultyRatio: { easy: 20, medium: 60, hard: 20 },
    });
  };

  const handleSubmit = () => {
    if (!isRatioValid) return;
    if (selectedChapters.length === 0) {
      setSelectedChapters(document.chapters.map((c) => c.name));
    }
    updateGlobalConfig({
      subject,
      questionCount,
      difficultyRatio: { easy: easyRatio, medium: mediumRatio, hard: hardRatio },
      orientations,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : document.chapters.map((c) => c.name),
    });
    onGenerate();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Title */}
      <div className="mb-6">
        <div className="flex items-center space-x-2 text-red-700 font-semibold text-xs tracking-wider uppercase mb-1">
          <span>단계 2</span>
          <span>•</span>
          <span>출제조건 설정</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
          ② 출제조건 설정
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          과목명, 문항 수, 난이도 비율, 출제 방향 및 범위를 설정하여 출제자가 의도한 조건대로 문제를 생성합니다.
        </p>
      </div>

      <div className="space-y-6">
        {/* Section 1: Basic Settings */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
          <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-red-600" />
            <span>기본 설정</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                과목명 / 평가명
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  updateGlobalConfig({ subject: e.target.value });
                }}
                placeholder="예: 우편물류 실무평가 (1급/2급)"
                className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                문제 유형
              </label>
              <input
                type="text"
                disabled
                value="4지선다 객관식"
                className="w-full px-3.5 py-2 text-xs bg-slate-100 border border-slate-300 rounded-lg text-slate-600 font-semibold cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">
              출제 문항 수
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {[5, 10, 15, 20].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setQuestionCount(num);
                    updateGlobalConfig({ questionCount: num });
                  }}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg border transition ${
                    questionCount === num
                      ? 'bg-red-600 text-white border-red-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {num}문항
                </button>
              ))}

              <div className="flex items-center ml-2 space-x-2">
                <span className="text-xs text-slate-500 font-medium">직접입력:</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={questionCount}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1));
                    setQuestionCount(val);
                    updateGlobalConfig({ questionCount: val });
                  }}
                  className="w-16 px-2.5 py-1.5 text-xs text-center border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold"
                />
                <span className="text-xs text-slate-500">문항 (최대 30문항)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Difficulty Ratios */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Percent className="w-4 h-4 text-red-600" />
                <span>난이도 비율 설정</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                쉬움·보통·어려움 비율의 합계가 반드시 100%가 되도록 설정해주세요.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAutoBalance}
              className="text-xs font-medium text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded border border-red-200 transition"
            >
              표준 비율 적용 (20:60:20)
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
              <label className="block text-xs font-bold text-emerald-800 mb-1">
                쉬움 (기본개념/단순확인)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={easyRatio}
                  onChange={(e) => handleRatioChange('easy', parseInt(e.target.value, 10))}
                  className="w-full px-3 py-1.5 text-sm font-bold text-center bg-white border border-emerald-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-xs font-bold text-emerald-800">%</span>
              </div>
              <p className="text-[11px] text-emerald-700 mt-1">
                약 {Math.round((easyRatio / 100) * questionCount)}문항
              </p>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
              <label className="block text-xs font-bold text-amber-900 mb-1">
                보통 (업무적용/복합정보)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={mediumRatio}
                  onChange={(e) => handleRatioChange('medium', parseInt(e.target.value, 10))}
                  className="w-full px-3 py-1.5 text-sm font-bold text-center bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-xs font-bold text-amber-900">%</span>
              </div>
              <p className="text-[11px] text-amber-800 mt-1">
                약 {Math.round((mediumRatio / 100) * questionCount)}문항
              </p>
            </div>

            <div className="p-3 bg-red-50/60 rounded-lg border border-red-200">
              <label className="block text-xs font-bold text-red-900 mb-1">
                어려움 (규정판단/실무사례)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={hardRatio}
                  onChange={(e) => handleRatioChange('hard', parseInt(e.target.value, 10))}
                  className="w-full px-3 py-1.5 text-sm font-bold text-center bg-white border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <span className="text-xs font-bold text-red-900">%</span>
              </div>
              <p className="text-[11px] text-red-800 mt-1">
                약 {Math.round((hardRatio / 100) * questionCount)}문항
              </p>
            </div>
          </div>

          {/* Validation Alert */}
          {!isRatioValid ? (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-amber-900 text-xs">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-semibold">
                  난이도 비율의 합계가 100%가 되어야 합니다. (현재 합계: {ratioSum}%)
                </span>
              </div>
              <button
                type="button"
                onClick={handleAutoBalance}
                className="underline font-bold hover:text-amber-950 ml-2"
              >
                100%로 자동 조정
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-xs text-emerald-700 font-semibold">
              <span>✓ 난이도 비율 합계: 100% 정상 설정되었습니다.</span>
            </div>
          )}
        </div>

        {/* Section 3: Question Orientation */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              문제 출제 방향 (복수 선택 가능)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              공공기관 직무평가 목적에 맞는 문항 성격을 선택하세요. (기본값: 핵심내용 중심 + 업무상황 중심)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AVAILABLE_ORIENTATIONS.map((item) => {
              const isSelected = orientations.includes(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => handleToggleOrientation(item.id)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start space-x-3 ${
                    isSelected
                      ? 'border-red-600 bg-red-50/50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="mt-0.5 text-red-600">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 fill-red-600 text-white" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{item.label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 4: Chapter Scope */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                출제 범위 (단원 선택)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                업로드된 자료에서 감지된 단원입니다. 선택된 단원 내에서만 문제가 생성됩니다.
              </p>
            </div>

            <button
              type="button"
              onClick={handleToggleAllChapters}
              className="text-xs font-semibold text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded transition border border-red-200"
            >
              {selectedChapters.length === document.chapters.length ? '선택 해제' : '전체 선택'}
            </button>
          </div>

          <div className="space-y-2">
            {document.chapters.map((chap) => {
              const isSelected = selectedChapters.includes(chap.name);
              return (
                <div
                  key={chap.id}
                  onClick={() => handleToggleChapter(chap.name)}
                  className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between text-xs ${
                    isSelected
                      ? 'border-red-500 bg-red-50/40 text-red-950 font-semibold'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-red-600">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 fill-red-600 text-white" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </span>
                    <span>{chap.name}</span>
                  </div>

                  <span className="text-[11px] text-slate-400 font-normal">
                    약 {chap.charCount.toLocaleString()}자
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onPrev}
            className="inline-flex items-center space-x-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-lg border border-slate-300 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>이전 (자료 수정)</span>
          </button>

          <button
            type="button"
            disabled={!isRatioValid || isGenerating}
            onClick={handleSubmit}
            className="inline-flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>AI 문제 생성하기 ({questionCount}문항)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
