import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  BookOpen,
  Sparkles,
  Layers,
  FileCheck,
  Edit3,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  ShieldCheck,
  Save,
} from 'lucide-react';
import { ParsedDocument } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { parseDocumentInBrowser } from '../utils/clientDocumentParser';

interface FileUploadStepProps {
  currentDocument: ParsedDocument | null;
  onDocumentLoaded: (doc: ParsedDocument) => void;
  onClearDocument: () => void;
  onNext: () => void;
}

export const FileUploadStep: React.FC<FileUploadStepProps> = ({
  currentDocument,
  onDocumentLoaded,
  onClearDocument,
  onNext,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState('자료 분석 준비 중...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'sample' | 'manual'>('upload');
  const [manualText, setManualText] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [editedText, setEditedText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supportedExtensions = ['.hwp', '.hwpx', '.pdf', '.docx', '.txt'];

  const validateAndProcessFile = async (file: File) => {
    setErrorMessage(null);
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    const isSupported = supportedExtensions.some((ext) => lowerName.endsWith(ext));

    if (!isSupported) {
      setErrorMessage(
        '현재 지원하지 않는 파일 형식입니다. HWP, HWPX, PDF, DOCX, TXT 파일만 업로드할 수 있습니다.'
      );
      return;
    }

    setIsLoading(true);
    setLoadingPhase('HWP/PDF 문서 구조 분석 및 텍스트 추출 중...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileExt = fileName.split('.').pop() || 'hwp';
      let parsedDoc: ParsedDocument | null = null;

      // 1. First, attempt backend API parsing if server is available
      try {
        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            resolve(res.split(',')[1] || res);
          };
          reader.readAsDataURL(file);
        });

        const response = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName,
            fileType: fileExt,
            base64Data,
          }),
        });

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const result = await response.json();
          if (result && result.success && result.document) {
            parsedDoc = {
              id: `doc-${Date.now()}`,
              fileName: file.name,
              fileType: fileExt as any,
              fileSize: file.size,
              uploadedAt: new Date().toISOString(),
              title: result.document.title || file.name.replace(/\.[^/.]+$/, ''),
              totalChars: result.document.totalChars || 0,
              content: result.document.content || '',
              chapters: result.document.chapters || [],
              keyTopics: result.document.keyTopics || [],
              keyRules: result.document.keyRules,
              procedures: result.document.procedures,
            };
          }
        }
      } catch (apiErr) {
        console.warn('Backend API unavailable (e.g. GitHub Pages static deployment), activating browser-direct parser:', apiErr);
      }

      // 2. Client-side browser direct parser (guaranteed to work on GitHub Pages, offline, and static hosts)
      if (!parsedDoc) {
        setLoadingPhase('브라우저 직접 분석 엔진(GitHub 호환)으로 HWP/PDF 분석 중...');
        parsedDoc = await parseDocumentInBrowser(file, arrayBuffer);
      }

      setEditedText(parsedDoc.content);
      onDocumentLoaded(parsedDoc);
    } catch (err: any) {
      console.error('File parsing failure:', err);
      setErrorMessage(
        err.message ||
          '자료 내용을 충분히 확인하지 못했습니다. 다른 파일 형식으로 다시 업로드하거나 [텍스트 직접 입력/붙여넣기] 탭을 이용해주세요.'
      );
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualText || manualText.trim().length < 30) {
      setErrorMessage('직접 입력할 자료 내용을 최소 30자 이상 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setLoadingPhase('입력된 자료 분석 및 단원 분류 중...');
    setErrorMessage(null);

    try {
      let parsedDoc: ParsedDocument | null = null;

      try {
        const response = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: (manualTitle || '우편직무_입력자료') + '.txt',
            plainText: manualText,
          }),
        });

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const result = await response.json();
          if (result && result.success && result.document) {
            parsedDoc = {
              id: `doc-manual-${Date.now()}`,
              fileName: (manualTitle || '우편직무_입력자료') + '.txt',
              fileType: 'txt',
              fileSize: new Blob([manualText]).size,
              uploadedAt: new Date().toISOString(),
              title: manualTitle || result.document.title,
              totalChars: result.document.totalChars,
              content: result.document.content,
              chapters: result.document.chapters,
              keyTopics: result.document.keyTopics,
              keyRules: result.document.keyRules,
              procedures: result.document.procedures,
            };
          }
        }
      } catch (apiErr) {
        console.warn('Backend unavailable, using browser text parsing:', apiErr);
      }

      if (!parsedDoc) {
        // Fallback in-browser parsing for manual text
        const textBlob = new Blob([manualText], { type: 'text/plain;charset=utf-8' });
        const mockFile = new File([textBlob], (manualTitle || '우편직무_입력자료') + '.txt', { type: 'text/plain' });
        const buffer = await textBlob.arrayBuffer();
        parsedDoc = await parseDocumentInBrowser(mockFile, buffer);
      }

      setEditedText(parsedDoc.content);
      onDocumentLoaded(parsedDoc);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyEditedText = () => {
    if (!currentDocument || !editedText.trim()) return;

    const updated: ParsedDocument = {
      ...currentDocument,
      content: editedText,
      totalChars: editedText.length,
    };
    onDocumentLoaded(updated);
    setShowTextEditor(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Title & Description */}
      <div className="mb-6">
        <div className="flex items-center space-x-2 text-red-700 font-semibold text-xs tracking-wider uppercase mb-1">
          <span>단계 1</span>
          <span>•</span>
          <span>출제자료 등록</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
          ① 출제자료 등록
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          평가문제의 근거가 되는 자료를 업로드하세요. 업로드된 자료를 분석하여 단원 및 출제 범위를 자동으로 파악합니다.
        </p>
      </div>

      {/* Tabs with Red Active Border */}
      <div className="flex space-x-2 border-b border-slate-200 mb-6 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('upload')}
          className={`py-2.5 px-4 border-b-2 flex items-center space-x-2 transition ${
            activeTab === 'upload'
              ? 'border-red-600 text-red-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>HWP / PDF 파일 업로드</span>
        </button>

        <button
          onClick={() => setActiveTab('sample')}
          className={`py-2.5 px-4 border-b-2 flex items-center space-x-2 transition ${
            activeTab === 'sample'
              ? 'border-red-600 text-red-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4 text-red-600" />
          <span>우편업무 추천 편람 선택</span>
        </button>

        <button
          onClick={() => setActiveTab('manual')}
          className={`py-2.5 px-4 border-b-2 flex items-center space-x-2 transition ${
            activeTab === 'manual'
              ? 'border-red-600 text-red-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Edit3 className="w-4 h-4" />
          <span>텍스트 직접 입력/붙여넣기</span>
        </button>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3 text-red-800 text-sm">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">자료 확인 안내</p>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{errorMessage}</p>
            <div className="mt-2.5 flex items-center space-x-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                className="underline font-bold text-red-800 hover:text-red-950"
              >
                텍스트 직접 복사·붙여넣기로 등록하기 →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: File Upload */}
      {activeTab === 'upload' && !currentDocument && (
        <div className="space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isLoading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-red-500 bg-red-50/70 scale-[1.01]'
                : 'border-slate-300 hover:border-red-400 bg-white hover:bg-slate-50/60'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".hwp,.hwpx,.pdf,.docx,.txt"
              className="hidden"
            />

            <div className="w-16 h-16 rounded-full bg-red-50 text-red-600 mx-auto flex items-center justify-center mb-4 border border-red-100">
              <UploadCloud className="w-8 h-8" />
            </div>

            <p className="text-base font-semibold text-slate-800 mb-1">
              파일을 여기에 끌어다 놓거나 클릭하여 업로드
            </p>
            <p className="text-xs text-slate-500 mb-4">
              지원 형식: <strong>HWP (한글 5.0 / 3.0), HWPX, PDF, DOCX, TXT</strong>
            </p>

            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
              <ShieldCheck className="w-4 h-4 text-red-600" />
              <span>GitHub Pages 배포 및 브라우저 직접 분석 100% 지원</span>
            </div>
          </div>

          {isLoading && (
            <div className="p-4 bg-red-50/90 border border-red-200 rounded-lg flex items-center space-x-3 text-red-900 text-xs shadow-xs animate-pulse">
              <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>{loadingPhase}</span>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Sample Documents */}
      {activeTab === 'sample' && !currentDocument && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            실제 우체국 창구 및 물류 실무에서 사용하는 최신 기준 편람을 선택하여 즉시 출제해볼 수 있습니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SAMPLE_DOCUMENTS.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  setEditedText(doc.content);
                  onDocumentLoaded(doc);
                }}
                className="bg-white p-4 rounded-xl border border-slate-200 hover:border-red-500 hover:shadow-sm cursor-pointer transition group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                      공식 편람
                    </span>
                    <span className="text-xs text-slate-400 font-mono">HWP</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-red-700 mb-1.5 leading-snug">
                    {doc.fileName}
                  </h4>
                  <p className="text-[11px] text-slate-500 line-clamp-3 mb-3">
                    {doc.title}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{doc.chapters.length}개 단원</span>
                  <span className="text-red-600 font-semibold group-hover:translate-x-0.5 transition-transform flex items-center">
                    이 자료로 출제 <ArrowRight className="w-3 h-3 ml-0.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Manual Text Input */}
      {activeTab === 'manual' && !currentDocument && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              자료명 또는 규정명
            </label>
            <input
              type="text"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="예: 우편물 접수 및 요금 산정 지침"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              자료 본문 내용 (단원, 규정, 조항, 수치 등)
            </label>
            <textarea
              rows={8}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="한글(HWP)이나 PDF에서 복사한 본문 텍스트를 여기에 직접 붙여넣으세요. 단원 및 핵심 규정을 자동으로 분석합니다."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
            />
          </div>

          <button
            type="button"
            disabled={isLoading || !manualText.trim()}
            onClick={handleManualSubmit}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-md transition"
          >
            {isLoading ? '자료 분석 중...' : '입력한 내용으로 출제자료 등록'}
          </button>
        </div>
      )}

      {/* Uploaded File Presentation Card */}
      {currentDocument && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-start justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-lg bg-red-50 text-red-600 flex items-center justify-center border border-red-200">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold text-slate-900">{currentDocument.fileName}</h3>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                    {currentDocument.fileType}
                  </span>
                  <span className="inline-flex items-center space-x-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>분석 완료</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 flex items-center space-x-3">
                  <span>크기: {formatFileSize(currentDocument.fileSize)}</span>
                  <span>•</span>
                  <span>분석 글자 수: {currentDocument.totalChars.toLocaleString()}자</span>
                  <span>•</span>
                  <span>감지 단원: {currentDocument.chapters.length}개</span>
                </p>
              </div>
            </div>

            <button
              onClick={onClearDocument}
              className="inline-flex items-center space-x-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md border border-slate-200 transition"
              title="파일 삭제 및 다시 선택"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>자료 삭제</span>
            </button>
          </div>

          {/* Extracted Document Structure & Chapters Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                <Layers className="w-4 h-4 text-red-600" />
                <span>파악된 주요 단원 및 목차 ({currentDocument.chapters.length}개)</span>
              </h4>
              <span className="text-[11px] text-slate-400">
                다음 단계에서 출제 범위를 선택할 수 있습니다.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentDocument.chapters.map((chap) => (
                <div
                  key={chap.id}
                  className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                >
                  <p className="font-semibold text-slate-800 text-xs mb-1 line-clamp-1">
                    {chap.name}
                  </p>
                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {chap.preview}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Key Regulations & Criteria */}
          {currentDocument.keyRules && currentDocument.keyRules.length > 0 && (
            <div className="p-3.5 bg-red-50/40 rounded-lg border border-red-100 text-xs">
              <p className="font-bold text-red-900 mb-1.5 flex items-center space-x-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-red-600" />
                <span>파악된 핵심 기준 및 요건 수치</span>
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-700 list-disc list-inside">
                {currentDocument.keyRules.map((rule, idx) => (
                  <li key={idx} className="line-clamp-1">
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key Topics */}
          {currentDocument.keyTopics.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-semibold text-slate-600 mb-1.5">
                핵심 키워드 & 직무 분야:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {currentDocument.keyTopics.map((topic, i) => (
                  <span
                    key={i}
                    className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium border border-slate-200"
                  >
                    #{topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Extracted Text Viewer / Editor */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTextEditor(!showTextEditor)}
              className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 transition"
            >
              <span className="flex items-center space-x-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>추출된 본문 텍스트 확인 및 직접 수정 (원문 미리보기)</span>
              </span>
              {showTextEditor ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showTextEditor && (
              <div className="p-4 bg-white space-y-3">
                <p className="text-[11px] text-slate-500">
                  추출된 텍스트 중 오탈자가 있거나 누락된 규정을 직접 수정할 수 있습니다. 수정한 내용은 AI 문제 출제의 기초 자료로 반영됩니다.
                </p>
                <textarea
                  rows={10}
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full p-3 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleApplyEditedText}
                    className="inline-flex items-center space-x-1 px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-md shadow-xs transition"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>수정된 본문 반영하기</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              자료가 정상적으로 등록되었습니다. 출제조건을 설정하세요.
            </span>

            <button
              onClick={onNext}
              className="inline-flex items-center space-x-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-xs rounded-lg shadow-xs transition"
            >
              <span>다음 단계 (출제조건 설정)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
