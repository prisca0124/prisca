import zlib from 'zlib';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { GoogleGenAI, Type } from '@google/genai';
import { extractHwpText, extractHwpx } from './hwpParser.ts';
import { DocumentChapter, DocumentSection } from '../types/index.ts';

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
 * Main parser entry point: parses HWP, HWPX, PDF, DOCX, and TXT files,
 * extracting clean full text and analyzing document structure strictly into:
 * - 1단계: '제X장' (Chapter)
 * - 2단계: '제X절' (Section)
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
    // Try fallback extraction
    if (ext === 'hwp' || ext === 'hwpx') {
      try {
        extractedText = await extractHwpText(buffer);
      } catch {
        // continue
      }
    }
  }

  // Clean extracted text
  extractedText = cleanExtractedText(extractedText);

  if (!extractedText || extractedText.trim().length < 20) {
    // If PDF and we have AI, try Gemini multimodal PDF reading as last resort
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
      '자료 내용을 충분히 확인하지 못했습니다. 다른 파일 형식으로 다시 업로드하거나 자료를 확인해주세요.'
    );
  }

  // AI-Assisted 2-Tier Hierarchical Structure Extraction (1단계: 제X장, 2단계: 제X절)
  let analysis: {
    title?: string;
    chapters?: Array<{
      name: string;
      preview: string;
      sections?: Array<{ name: string; preview: string }>;
    }>;
    keyTopics?: string[];
    keyRules?: string[];
    procedures?: string[];
  } | null = null;

  if (ai) {
    try {
      analysis = await analyzeDocumentWithAI(ai, extractedText, fileName);
    } catch (aiErr) {
      console.warn('AI 2-tier analysis skipped/failed, falling back to rule-based:', aiErr);
    }
  }

  const title = analysis?.title || detectTitle(extractedText, fileName);
  const keyTopics =
    analysis?.keyTopics && analysis.keyTopics.length > 0
      ? analysis.keyTopics
      : detectKeyTopics(extractedText);

  let chapters: DocumentChapter[] = [];

  // Check if AI returned valid 2-tier chapters
  if (analysis?.chapters && analysis.chapters.length >= 2) {
    const totalChars = extractedText.length;
    const estPerChap = Math.round(totalChars / analysis.chapters.length);

    chapters = analysis.chapters.map((c, i) => {
      let chapName = c.name.trim();
      if (!/^제\s*\d+\s*장/i.test(chapName)) {
        chapName = `제${i + 1}장 ${chapName.replace(/^[0-9.\-\s]+/, '')}`;
      }

      // Map 2단계 '제X절'
      const sections: DocumentSection[] = (c.sections && c.sections.length > 0)
        ? c.sections.map((sec, secIdx) => {
            let secName = sec.name.trim();
            if (!/^제\s*\d+\s*절/i.test(secName)) {
              secName = `제${secIdx + 1}절 ${secName.replace(/^[0-9.\-\s]+/, '')}`;
            }
            return {
              id: `sec-${i + 1}-${secIdx + 1}`,
              name: secName,
              preview: sec.preview,
              charCount: Math.round(estPerChap / Math.max(1, c.sections!.length)),
            };
          })
        : extractDefaultSectionsForChapter(extractedText, chapName, i + 1, estPerChap);

      return {
        id: `chap-${i + 1}`,
        name: chapName,
        preview: c.preview,
        charCount: estPerChap,
        sections,
      };
    });
  } else {
    // Rule-based exact 2-tier '제X장' & '제X절' partitioning
    chapters = detectChaptersByJangAndJeol(extractedText, fileName);
  }

  const keyRules =
    analysis?.keyRules && analysis.keyRules.length > 0
      ? analysis.keyRules
      : detectKeyRules(extractedText);

  return {
    title,
    totalChars: extractedText.length,
    content: extractedText,
    chapters,
    keyTopics,
    keyRules,
    procedures: analysis?.procedures,
  };
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
        text: '이 PDF 문서의 모든 본문 텍스트를 정확하게 추출해줘. 문서의 1단계 제X장, 2단계 제X절 구분과 세부 규정 조항, 수치 요건을 누락 없이 한국어 원문 그대로 서술형으로 작성해줘.',
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
 * Uses Gemini to parse document structure strictly into 1단계 '제X장' and 2단계 '제X절'
 */
async function analyzeDocumentWithAI(
  ai: GoogleGenAI,
  text: string,
  fileName: string
): Promise<{
  title: string;
  chapters: Array<{
    name: string;
    preview: string;
    sections?: Array<{ name: string; preview: string }>;
  }>;
  keyTopics: string[];
  keyRules?: string[];
  procedures?: string[];
}> {
  const snippet =
    text.length > 25000
      ? text.slice(0, 18000) + '\n\n...[중간 본문 생략]...\n\n' + text.slice(-7000)
      : text;

  const prompt = `
당신은 대한민국 우편직무 교육·업무자료 전문 분석가입니다.
제공된 우편직무 자료의 목차와 내용을 분석하여, 시험 평가문제 출제에 필요한 정보를 [1단계 제X장]과 [2단계 제X절]의 2단계 계층 구조로 명확하게 추출하십시오.

[필수 요구사항: 2단계 계층형 목차 구조화]
1. 1단계 [제X장]: 문서의 대단원 (예: "제1장 통상우편물 규격요건 및 접수기준", "제2장 국내우편 요금체계 및 감액제도")
   - name: 반드시 "제1장 [단원명]", "제2장 [단원명]" 형태로 작성할 것.
   - preview: 해당 장 전체의 핵심 규정 요약.
2. 2단계 [제X절]: 각 장에 소속된 세부 절 목록 (2~5개)
   - name: 반드시 "제1절 [절제목]", "제2절 [절제목]" 형태로 작성할 것.
   - preview: 해당 절에서 다루는 구체적 업무 기준 수치(중량, 크기, 요금, 보관년수 등) 및 처리 지침 요약.
3. title: 문서의 실제 공식 제목이나 편람명.
4. keyTopics: 핵심 우편직무 전문 키워드 4~8개.
5. keyRules: 각 장/절에 등장하는 핵심 수치 기준 (중량 50g 이하, 30kg 이하, 3년 보관 등) 4~8개.
6. procedures: 창구 접수, 감액 승인 등 주요 실무 절차.

- 파일명: ${fileName}
- 분석할 본문 내용:
${snippet}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction: '우편직무 평가자료를 1단계 "제X장"과 2단계 "제X절"의 2단계 계층 구조로 엄격하게 분석하는 전문 분석관입니다.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          chapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: '1단계: 제1장, 제2장 등' },
                preview: { type: Type.STRING },
                sections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: '2단계: 제1절, 제2절 등' },
                      preview: { type: Type.STRING },
                    },
                    required: ['name', 'preview'],
                  },
                },
              },
              required: ['name', 'preview', 'sections'],
            },
          },
          keyTopics: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          keyRules: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          procedures: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['title', 'chapters', 'keyTopics'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  return parsed;
}

/**
 * Rule-based 2-tier chapter and section detection (1단계: 제X장, 2단계: 제X절)
 */
export function detectChaptersByJangAndJeol(
  text: string,
  fileName: string
): DocumentChapter[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const chapterList: DocumentChapter[] = [];

  // Regex for 1단계 '제X장'
  const jeJangRegex =
    /^(?:[#*[\]【\s]*)(제\s*[0-9一二三四五육칠팔구십]+\s*장|第\s*[0-9一二三四五육칠팔구십]+\s*章)\b(?:\s*[:.\-]?\s*(.*))?$/i;

  const jeJangHeaders: Array<{ index: number; fullTitle: string; chapterNumStr: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(jeJangRegex);
    if (match && line.length <= 80) {
      const chapterPrefix = match[1].replace(/\s+/g, '');
      const subTitle = (match[2] || '').replace(/[#*[\]【】]/g, '').trim();

      let combinedTitle = subTitle ? `${chapterPrefix} ${subTitle}` : chapterPrefix;
      if (!subTitle && i + 1 < lines.length && lines[i + 1].length >= 2 && lines[i + 1].length <= 50) {
        combinedTitle = `${chapterPrefix} ${lines[i + 1].replace(/[#*[\]【】]/g, '').trim()}`;
      }

      jeJangHeaders.push({
        index: i,
        fullTitle: combinedTitle,
        chapterNumStr: chapterPrefix,
      });
    }
  }

  // If 2 or more '제X장' found
  if (jeJangHeaders.length >= 2) {
    for (let i = 0; i < jeJangHeaders.length; i++) {
      const cur = jeJangHeaders[i];
      const nextIdx = i + 1 < jeJangHeaders.length ? jeJangHeaders[i + 1].index : lines.length;
      const chapterLines = lines.slice(cur.index + 1, nextIdx);
      const chapterText = chapterLines.join('\n').trim();

      // Extract 2단계 '제X절' within this chapter
      const sections = extractSectionsWithinChapter(chapterLines, i + 1);

      const preview = chapterLines
        .slice(0, 5)
        .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
        .filter((l) => l.length >= 8)
        .join(' ')
        .slice(0, 140);

      chapterList.push({
        id: `chap-${i + 1}`,
        name: cur.fullTitle,
        preview: preview || `${cur.fullTitle} 관련 주요 우편실무 규정 및 기준`,
        charCount: chapterText.length || 600,
        sections,
      });
    }

    return chapterList;
  }

  // Secondary: If document has '제X편' or '단원X' or '1.'
  const secondaryRegex =
    /^(?:[#*[\]【\s]*)(제\s*[0-9一二三四五\s]+[절편부]|단원\s*\d+|[I|V|XLCDM]+\.\s+[가-힣]{2,}|[0-9]{1,2}\.\s+[가-힣]{2,30}|【[^】]+】|\[[^\]]+\])/;

  const sectionHeaders: Array<{ index: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (secondaryRegex.test(line) && line.length >= 3 && line.length <= 60) {
      sectionHeaders.push({ index: i, title: line.replace(/^[#*[\]【】\s]+/, '').replace(/[#*[\]【】\s]+$/, '') });
    }
  }

  if (sectionHeaders.length >= 2) {
    for (let i = 0; i < sectionHeaders.length; i++) {
      const cur = sectionHeaders[i];
      const nextIdx = i + 1 < sectionHeaders.length ? sectionHeaders[i + 1].index : lines.length;
      const chapterLines = lines.slice(cur.index + 1, nextIdx);
      const chapterText = chapterLines.join('\n').trim();

      const normalizedChapterName = `제${i + 1}장 ${cur.title.replace(/^[0-9.\-\s]+/, '')}`;
      const sections = extractSectionsWithinChapter(chapterLines, i + 1);

      const preview = chapterLines
        .slice(0, 4)
        .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
        .filter((l) => l.length >= 8)
        .join(' ')
        .slice(0, 130);

      chapterList.push({
        id: `chap-${i + 1}`,
        name: normalizedChapterName,
        preview: preview || `${normalizedChapterName} 관련 규정 내용`,
        charCount: chapterText.length || 600,
        sections,
      });
    }

    return chapterList.slice(0, 10);
  }

  // Fallback: partition into 3~5 logical '제X장' with '제X절'
  const totalLen = text.length;
  const numChunks = Math.min(5, Math.max(3, Math.round(totalLen / 3500)));
  const chunkSize = Math.floor(totalLen / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = i === numChunks - 1 ? totalLen : (i + 1) * chunkSize;
    const slice = text.slice(start, end).trim();
    const chapterLines = slice.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    const firstLine =
      chapterLines.filter((l) => l.length >= 4 && l.length <= 35)[0] || `우편직무 핵심영역 (${i + 1}단원)`;

    const chapterName = `제${i + 1}장 ${firstLine.replace(/^[0-9.\-\s]+/, '')}`;
    const sections = extractSectionsWithinChapter(chapterLines, i + 1);

    chapterList.push({
      id: `chap-${i + 1}`,
      name: chapterName,
      preview: slice.slice(0, 130) + '...',
      charCount: slice.length,
      sections,
    });
  }

  return chapterList;
}

/**
 * Extracts 2단계 '제X절' within a chapter's lines
 */
function extractSectionsWithinChapter(
  chapterLines: string[],
  chapNum: number
): DocumentSection[] {
  const sections: DocumentSection[] = [];

  // Regex for 2단계 '제X절' / '第X節'
  const jeolRegex =
    /^(?:[#*[\]【\s]*)(제\s*[0-9一二三四五육칠팔구십]+\s*절|第\s*[0-9一二三四五육칠팔구십]+\s*節)\b(?:\s*[:.\-]?\s*(.*))?$/i;

  const jeolHeaders: Array<{ index: number; fullTitle: string }> = [];

  for (let j = 0; j < chapterLines.length; j++) {
    const line = chapterLines[j];
    const match = line.match(jeolRegex);
    if (match && line.length <= 80) {
      const jeolPrefix = match[1].replace(/\s+/g, '');
      const sub = (match[2] || '').replace(/[#*[\]【】]/g, '').trim();

      let combined = sub ? `${jeolPrefix} ${sub}` : jeolPrefix;
      if (!sub && j + 1 < chapterLines.length && chapterLines[j + 1].length >= 2 && chapterLines[j + 1].length <= 50) {
        combined = `${jeolPrefix} ${chapterLines[j + 1].replace(/[#*[\]【】]/g, '').trim()}`;
      }

      jeolHeaders.push({ index: j, fullTitle: combined });
    }
  }

  // If explicit '제X절' headers found
  if (jeolHeaders.length >= 2) {
    for (let k = 0; k < jeolHeaders.length; k++) {
      const curSec = jeolHeaders[k];
      const nextSecIdx = k + 1 < jeolHeaders.length ? jeolHeaders[k + 1].index : chapterLines.length;
      const secLines = chapterLines.slice(curSec.index + 1, nextSecIdx);
      const secText = secLines.join('\n').trim();

      const preview = secLines
        .slice(0, 3)
        .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
        .filter((l) => l.length >= 8)
        .join(' ')
        .slice(0, 120);

      sections.push({
        id: `sec-${chapNum}-${k + 1}`,
        name: curSec.fullTitle,
        preview: preview || `${curSec.fullTitle} 관련 세부 실무 요건`,
        charCount: secText.length || 300,
      });
    }
    return sections;
  }

  // Secondary sub-sections: look for 1. , 2. , or [소제목]
  const subRegex = /^([0-9]{1,2}\.\s+[가-힣]{2,25}|[가-힣]{2,20}\s*(요건|기준|체계|절차|취급|안내))/;
  const subHeaders: Array<{ index: number; title: string }> = [];

  for (let j = 0; j < chapterLines.length; j++) {
    const line = chapterLines[j];
    if (subRegex.test(line) && line.length >= 4 && line.length <= 45) {
      subHeaders.push({ index: j, title: line.replace(/^[0-9.\-\s]+/, '').trim() });
    }
  }

  if (subHeaders.length >= 2) {
    for (let k = 0; k < Math.min(4, subHeaders.length); k++) {
      const curSec = subHeaders[k];
      const nextSecIdx = k + 1 < subHeaders.length ? subHeaders[k + 1].index : chapterLines.length;
      const secLines = chapterLines.slice(curSec.index + 1, nextSecIdx);

      const preview = secLines
        .slice(0, 3)
        .map((l) => l.replace(/^[•\-*·0-9.\s]+/, '').trim())
        .filter((l) => l.length >= 8)
        .join(' ')
        .slice(0, 120);

      sections.push({
        id: `sec-${chapNum}-${k + 1}`,
        name: `제${k + 1}절 ${curSec.title}`,
        preview: preview || `제${k + 1}절 ${curSec.title} 관련 세부 기준`,
        charCount: secLines.join(' ').length || 300,
      });
    }
    return sections;
  }

  // Fallback: 2 standard sub-sections
  const mid = Math.floor(chapterLines.length / 2);
  const p1 = chapterLines.slice(0, mid).join(' ').slice(0, 120);
  const p2 = chapterLines.slice(mid).join(' ').slice(0, 120);

  return [
    {
      id: `sec-${chapNum}-1`,
      name: `제1절 ${chapterLines[0]?.slice(0, 20) || '기본 규정 및 요건'}`,
      preview: p1 || '제1절 관련 핵심 규정 및 기준',
      charCount: Math.round(chapterLines.join(' ').length / 2),
    },
    {
      id: `sec-${chapNum}-2`,
      name: `제2절 ${chapterLines[mid]?.slice(0, 20) || '세부 취급 및 실무 지침'}`,
      preview: p2 || '제2절 관련 실무 취급 및 예외 기준',
      charCount: Math.round(chapterLines.join(' ').length / 2),
    },
  ];
}

function extractDefaultSectionsForChapter(
  content: string,
  chapterName: string,
  chapNum: number,
  estCharCount: number
): DocumentSection[] {
  return [
    {
      id: `sec-${chapNum}-1`,
      name: `제1절 ${chapterName.replace(/^제\s*\d+\s*장\s*/, '')} 기본 요건 및 기준`,
      preview: `${chapterName}의 핵심 규정, 대상 및 기본 취급 요건`,
      charCount: Math.round(estCharCount / 2),
    },
    {
      id: `sec-${chapNum}-2`,
      name: `제2절 ${chapterName.replace(/^제\s*\d+\s*장\s*/, '')} 실무 처리 및 예외 지침`,
      preview: `${chapterName}의 세부 수치 기준, 업무 처리 절차 및 유의사항`,
      charCount: Math.round(estCharCount / 2),
    },
  ];
}

/**
 * Accurately detects title, filtering out headers, page numbers, and confidentiality markings
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
    if (!/^-\s*\d+\s*-$/.test(line) && line.length >= 6 && line.length <= 40) {
      return line.replace(/^[#*[\]\s【】()]+/, '').replace(/[#*[\]\s【】()]+$/, '');
    }
  }

  return cleanFileName || '우편직무 평가자료';
}

function detectKeyTopics(text: string): string[] {
  const candidates = [
    '통상우편', '규격우편물', '우편요금', '요금감액', '등기우편', '소포우편물',
    '내용증명', '배달증명', '당일특급', '익일특급', '손해배상', '환부불능',
    '우편금지물품', '위험물', '리튬배터리', '개피요구권', '우편법', '접수기준',
    '특약소포', '착불배달', '민원처리', '우체국창구'
  ];

  const found = candidates.filter((k) => text.includes(k));
  return found.length >= 3 ? found.slice(0, 8) : ['우편직무 기본지침', '업무 절차 및 기준', '규격 및 요금 기준'];
}

function detectKeyRules(text: string): string[] {
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
