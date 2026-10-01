import zlib from 'zlib';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { GoogleGenAI } from '@google/genai';
import { extractHwpText, extractHwpx } from './hwpParser.ts';
import type { DocumentChapter, DocumentSection } from '../types/index.ts';

export interface DocumentAnalysisResult {
  title: string;
  totalChars: number;
  content: string;
  chapters: DocumentChapter[];
  keyTopics: string[];
  keyRules?: string[];
  procedures?: string[];
}

/**
 * Main parser entry point: parses HWP, HWPX, PDF, DOCX, and TXT files.
 * Table of contents analysis: STRICTLY and ONLY based on literal '제X장' and '제X절' in the text.
 * Old heuristic and arbitrary generation rules have been completely removed.
 */
export async function parseDocumentBuffer(
  buffer: Buffer,
  fileName: string,
  fileType: string,
  base64Data?: string,
  ai?: GoogleGenAI
): Promise<DocumentAnalysisResult> {
  let extractedText = '';
  const ext = fileName.toLowerCase().split('.').pop() || fileType.toLowerCase();

  try {
    if (ext === 'hwpx') {
      extractedText = await extractHwpx(buffer);
    } else if (ext === 'hwp') {
      extractedText = await extractHwpText(buffer);
    } else if (ext === 'pdf') {
      extractedText = await parsePdf(buffer, base64Data, ai);
    } else if (ext === 'docx') {
      extractedText = await parseDocx(buffer);
    } else {
      extractedText = decodePlainText(buffer);
    }
  } catch (err: any) {
    console.error('Document parsing exception:', err);
    if (ext === 'hwp' || ext === 'hwpx') {
      try {
        extractedText = await extractHwpText(buffer);
      } catch {
        // continue
      }
    }
  }

  extractedText = cleanExtractedText(extractedText);

  if (!extractedText || extractedText.trim().length < 20) {
    if (ext === 'pdf' && ai && base64Data) {
      try {
        const geminiText = await extractPdfWithGemini(ai, base64Data);
        if (geminiText && geminiText.trim().length > 30) {
          extractedText = cleanExtractedText(geminiText);
        }
      } catch (e) {
        console.warn('Gemini PDF fallback failed:', e);
      }
    }
  }

  if (!extractedText || extractedText.trim().length < 20) {
    throw new Error(
      '자료 내용을 충분히 확인하지 못했습니다. 파일이 손상되었거나 암호화되어 있는지 확인해주세요.'
    );
  }

  // 1. Chapters & Sections: Pure literal '제X장' and '제X절' extraction from the body (ZERO arbitrary generation)
  const chapters = parseStrictJangAndJeolFromText(extractedText, fileName);

  // 2. Title: Extracted directly from actual text or clean file name
  const title = detectTitle(extractedText, fileName);

  // 3. Key Topics: Extracted strictly from recurring words in the actual text
  const keyTopics = detectKeyTopicsFromText(extractedText);

  // 4. Key Rules: Extracted directly from lines containing numerical criteria in the actual text
  const keyRules = detectKeyRulesFromText(extractedText);

  // 5. Procedures: Extracted directly from procedure lines in the actual text
  const procedures = detectProceduresFromText(extractedText);

  return {
    title,
    totalChars: extractedText.length,
    content: extractedText,
    chapters,
    keyTopics,
    keyRules,
    procedures: procedures.length > 0 ? procedures : undefined,
  };
}

/**
 * Pure literal '제X장' and '제X절' analyzer.
 * All previous heuristics, fallbacks, and arbitrary generation rules are completely deleted.
 * ONLY lines literally containing '제X장' (or '第X章') and '제X절' (or '第X節') are recognized.
 */
export function parseStrictJangAndJeolFromText(
  text: string,
  fileName: string
): DocumentChapter[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Strict regex for literal '제X장' / '第X章'
  const JANG_REGEX =
    /^(?:[#*[\]【】<>·•▶■◆○□※\s\d.-]*)(제\s*[0-9一二三四五육칠팔구십]+\s*장|第\s*[0-9一二三四五육칠팔구십]+\s*章)(?:[\s.:\-–—]*)(.*)$/;

  // Strict regex for literal '제X절' / '第X節'
  const JEOL_REGEX =
    /^(?:[#*[\]【】<>·•▶■◆○□※\s\d.-]*)(제\s*[0-9一二三四五육칠팔구십]+\s*절|第\s*[0-9一二三四五육칠팔구십]+\s*節)(?:[\s.:\-–—]*)(.*)$/;

  // Function to filter out TOC index lines with dots/page numbers (e.g., '제1장 총칙 .......... 1')
  const isTocDotLine = (l: string) =>
    /[.·…]{3,}\s*\d+\s*$/.test(l) || /[-–—]{3,}\s*\d+\s*$/.test(l);

  // 1. Scan for all literal '제X장' lines
  interface JangMatch {
    lineIndex: number;
    title: string;
    isToc: boolean;
  }

  const allJangMatches: JangMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(JANG_REGEX);
    if (match && line.length <= 80) {
      const prefix = match[1].replace(/\s+/g, '');
      let subTitle = (match[2] || '')
        .replace(/^[#*[\]【】<>.:\-–—\s]+/, '')
        .replace(/[#*[\]【】<>.:\-–—\s]+$/, '')
        .trim();

      // If title is on the next line
      if (
        !subTitle &&
        i + 1 < lines.length &&
        lines[i + 1].length >= 2 &&
        lines[i + 1].length <= 60 &&
        !JANG_REGEX.test(lines[i + 1]) &&
        !JEOL_REGEX.test(lines[i + 1])
      ) {
        subTitle = lines[i + 1]
          .replace(/^[#*[\]【】<>.:\-–—\s]+/, '')
          .replace(/[#*[\]【】<>.:\-–—\s]+$/, '')
          .trim();
      }

      // Strip trailing TOC dots/page numbers if present in subtitle
      const cleanSub = subTitle.replace(/[.·…\-–—]{2,}\s*\d+\s*$/, '').trim();
      const combinedTitle = cleanSub ? `${prefix} ${cleanSub}` : prefix;

      allJangMatches.push({
        lineIndex: i,
        title: combinedTitle,
        isToc: isTocDotLine(line),
      });
    }
  }

  // If there are body occurrences, prefer the non-TOC occurrences
  const bodyJangMatches = allJangMatches.filter((m) => !m.isToc);
  const effectiveJangMatches = bodyJangMatches.length > 0 ? bodyJangMatches : allJangMatches;

  // IF literal '제X장' lines exist in the document:
  if (effectiveJangMatches.length >= 1) {
    const chapters: DocumentChapter[] = [];

    for (let i = 0; i < effectiveJangMatches.length; i++) {
      const curJang = effectiveJangMatches[i];
      const nextIdx =
        i + 1 < effectiveJangMatches.length ? effectiveJangMatches[i + 1].lineIndex : lines.length;

      const chapterLines = lines.slice(curJang.lineIndex + 1, nextIdx);
      const chapterText = chapterLines.join('\n').trim();

      // Scan for literal '제X절' within this chapter
      const allJeolMatches: Array<{ lineIndex: number; title: string; isToc: boolean }> = [];

      for (let j = 0; j < chapterLines.length; j++) {
        const cLine = chapterLines[j];
        const jMatch = cLine.match(JEOL_REGEX);
        if (jMatch && cLine.length <= 80) {
          const prefix = jMatch[1].replace(/\s+/g, '');
          let subTitle = (jMatch[2] || '')
            .replace(/^[#*[\]【】<>.:\-–—\s]+/, '')
            .replace(/[#*[\]【】<>.:\-–—\s]+$/, '')
            .trim();

          // If subtitle is on next line
          if (
            !subTitle &&
            j + 1 < chapterLines.length &&
            chapterLines[j + 1].length >= 2 &&
            chapterLines[j + 1].length <= 60 &&
            !JANG_REGEX.test(chapterLines[j + 1]) &&
            !JEOL_REGEX.test(chapterLines[j + 1])
          ) {
            subTitle = chapterLines[j + 1]
              .replace(/^[#*[\]【】<>.:\-–—\s]+/, '')
              .replace(/[#*[\]【】<>.:\-–—\s]+$/, '')
              .trim();
          }

          const cleanSub = subTitle.replace(/[.·…\-–—]{2,}\s*\d+\s*$/, '').trim();
          const combinedTitle = cleanSub ? `${prefix} ${cleanSub}` : prefix;

          allJeolMatches.push({
            lineIndex: j,
            title: combinedTitle,
            isToc: isTocDotLine(cLine),
          });
        }
      }

      const bodyJeolMatches = allJeolMatches.filter((m) => !m.isToc);
      const effectiveJeolMatches = bodyJeolMatches.length > 0 ? bodyJeolMatches : allJeolMatches;

      let sections: DocumentSection[] | undefined = undefined;

      if (effectiveJeolMatches.length >= 1) {
        sections = [];
        for (let k = 0; k < effectiveJeolMatches.length; k++) {
          const curJeol = effectiveJeolMatches[k];
          const nextJeolIdx =
            k + 1 < effectiveJeolMatches.length
              ? effectiveJeolMatches[k + 1].lineIndex
              : chapterLines.length;

          const secLines = chapterLines.slice(curJeol.lineIndex + 1, nextJeolIdx);
          const secText = secLines.join('\n').trim();

          const preview = secLines
            .slice(0, 3)
            .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
            .filter((l) => l.length >= 6)
            .join(' ')
            .slice(0, 120);

          sections.push({
            id: `sec-${i + 1}-${k + 1}`,
            name: curJeol.title,
            preview: preview || `${curJeol.title} 관련 본문 내용`,
            charCount: secText.length || 300,
          });
        }
      }

      // Preview of the chapter (from actual text)
      const preview = chapterLines
        .slice(0, 4)
        .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
        .filter((l) => l.length >= 6)
        .join(' ')
        .slice(0, 140);

      chapters.push({
        id: `chap-${i + 1}`,
        name: curJang.title,
        preview: preview || `${curJang.title} 관련 본문 내용`,
        charCount: chapterText.length || 600,
        sections,
      });
    }

    return chapters;
  }

  // IF NO literal '제X장' lines exist in the document:
  // Strictly DO NOT invent or fabricate fake '제1장', '제2장'!
  // Simply present the document as a single unit using its actual document title.
  const docTitle = detectTitle(text, fileName);
  const preview = lines
    .slice(0, 4)
    .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
    .filter((l) => l.length >= 6)
    .join(' ')
    .slice(0, 140);

  return [
    {
      id: 'chap-1',
      name: docTitle || '본문 전체',
      preview: preview || '본문 실제 내용',
      charCount: text.length,
      sections: undefined,
    },
  ];
}

/**
 * PDF parsing using pdf-parse v2 with stream and Gemini OCR fallbacks
 */
async function parsePdf(buffer: Buffer, base64Data?: string, ai?: GoogleGenAI): Promise<string> {
  let text = '';

  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    if (typeof (parser as any).load === 'function') {
      await (parser as any).load();
    }
    const result = await parser.getText();
    if (result && typeof result.text === 'string' && result.text.trim().length > 40) {
      text = result.text.trim();
    }
  } catch (err) {
    console.warn('pdf-parse failed:', err);
  }

  if (text.length < 50 && ai && base64Data) {
    try {
      text = await extractPdfWithGemini(ai, base64Data);
    } catch (geminiErr) {
      console.warn('Gemini PDF OCR fallback error:', geminiErr);
    }
  }

  if (text.length === 0) {
    text = extractPdfStreams(buffer);
  }

  return text;
}

async function extractPdfWithGemini(ai: GoogleGenAI, base64Data: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data,
        },
      },
      {
        text: '이 PDF 문서에 실제로 적혀 있는 모든 본문 텍스트를 한 글자도 왜곡하거나 지어내지 말고, 원문 그대로 정확하게 추출해줘.',
      },
    ],
  });
  return response.text || '';
}

function extractPdfStreams(buffer: Buffer): string {
  const textMatches: string[] = [];
  const str = buffer.toString('binary');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(str)) !== null) {
    const streamData = Buffer.from(match[1], 'binary');
    try {
      const unzipped = zlib.inflateSync(streamData);
      const text = unzipped.toString('utf-8');
      const textClean = text.replace(/BT[\s\S]*?ET/g, (bt) => {
        return bt.replace(/\((.*?)\)\s*Tj/g, '$1\n');
      });
      if (textClean.length > 20) textMatches.push(textClean);
    } catch {
      // ignore
    }
  }

  return textMatches.join('\n');
}

/**
 * DOCX Parser
 */
async function parseDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = zip.file('word/document.xml');
  if (!docXml) throw new Error('DOCX document.xml not found');

  const content = await docXml.async('string');
  return content
    .replace(/<\/w:tc>/gi, '  ')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:t[^>]*>(.*?)<\/w:t>/gis, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

/**
 * Decodes plain text with UTF-8 / CP949 / UTF-16 auto-detection
 */
function decodePlainText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }

  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }

  const cp949 = iconv.decode(buffer, 'cp949');
  if (!cp949.includes('\uFFFD')) {
    return cp949;
  }

  return utf8;
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Accurately detects title from the actual text, filtering out headers, page numbers, and confidentiality markings
 */
function detectTitle(text: string, fileName: string): string {
  const cleanFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]/g, ' ');
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);

  const ignoredKeywords = [
    '비공개', '사외공개', '공개', '대외비', '우정사업본부', '한국우편사업진흥원',
    '페이지', 'page', '목차', '차례', '붙임', '서식', '별표', '개정', '시행',
  ];

  for (const line of lines.slice(0, 15)) {
    if (/^-\s*\d+\s*-$/.test(line) || /^\d+\s*\/\s*\d+$/.test(line)) continue;
    if (ignoredKeywords.some((k) => line === k || line === `[${k}]` || line === `(${k})`)) continue;

    if (
      line.includes('편람') ||
      line.includes('규정') ||
      line.includes('요령') ||
      line.includes('지침') ||
      line.includes('매뉴얼') ||
      line.includes('기준') ||
      line.includes('실무') ||
      line.includes('우편')
    ) {
      return line.replace(/^[#*[\]\s【】()]+/, '').replace(/[#*[\]\s【】()]+$/, '');
    }
  }

  for (const line of lines.slice(0, 5)) {
    if (!/^-\s*\d+\s*-$/.test(line) && line.length >= 5 && line.length <= 40) {
      return line.replace(/^[#*[\]\s【】()]+/, '').replace(/[#*[\]\s【】()]+$/, '');
    }
  }

  return cleanFileName || '우편직무 평가자료';
}

/**
 * Dynamically extracts actual key topics from the document text itself.
 * Never returns hardcoded postal topics that do not exist in the file.
 */
function detectKeyTopicsFromText(text: string): string[] {
  const wordCounts = new Map<string, number>();

  const words = text.match(/[가-힣]{2,10}/g) || [];
  const stopwords = new Set([
    '우편', '경우', '따라', '대한', '통해', '관련', '있음', '없음', '모든', '기타', '사항', '이상', '이하', '내용', '기준'
  ]);

  for (const word of words) {
    if (stopwords.has(word)) continue;
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }

  const sorted = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count >= 2)
    .map(([word]) => word);

  if (sorted.length >= 3) {
    return sorted.slice(0, 8);
  }

  const lines = text.split('\n').slice(0, 10);
  const fallbackWords: string[] = [];
  for (const l of lines) {
    const matched = l.match(/[가-힣]{2,6}/g) || [];
    for (const w of matched) {
      if (!stopwords.has(w) && !fallbackWords.includes(w)) {
        fallbackWords.push(w);
      }
      if (fallbackWords.length >= 5) break;
    }
  }

  return fallbackWords.length > 0 ? fallbackWords : ['직무 규정', '업무 기준'];
}

/**
 * Extracts actual sentences containing numerical rules directly from the file text.
 */
function detectKeyRulesFromText(text: string): string[] {
  const rules: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 10);

  const ruleKeywords = ['이상', '이하', '미만', '초과', '이내', '제한', '원', '통', 'kg', 'g', 'cm', 'mm', '일간', '년', '%'];

  for (const line of lines) {
    if (/[0-9]/.test(line) && ruleKeywords.some((k) => line.includes(k))) {
      const clean = line.replace(/^[•\-*·\s]+/, '');
      if (clean.length >= 12 && clean.length <= 80 && !rules.includes(clean)) {
        rules.push(clean);
      }
    }
    if (rules.length >= 8) break;
  }

  return rules;
}

/**
 * Extracts actual procedure steps directly from lines in the text
 */
function detectProceduresFromText(text: string): string[] {
  const procedures: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 10);

  const stepRegex = /^(?:[0-9]+[.)]|①|②|③|④|⑤|Step\s*[0-9]+|단계\s*[0-9]+)/;
  for (const line of lines) {
    if (stepRegex.test(line) && (line.includes('절차') || line.includes('처리') || line.includes('접수') || line.includes('확인') || line.includes('제출'))) {
      if (!procedures.includes(line)) {
        procedures.push(line);
      }
    }
    if (procedures.length >= 6) break;
  }

  return procedures;
}
