import zlib from 'zlib';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { GoogleGenAI, Type } from '@google/genai';
import { extractHwpText, extractHwpx } from './hwpParser.ts';

export interface DocumentAnalysisResult {
  title: string;
  totalChars: number;
  content: string;
  chapters: Array<{
    id: string;
    name: string;
    preview: string;
    charCount: number;
  }>;
  keyTopics: string[];
  keyRules?: string[];
  procedures?: string[];
}

/**
 * Extracts clean readable text from HWP, HWPX, PDF, DOCX, TXT
 * and extracts structured metadata (title, chapters, key concepts)
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
      // txt or plain text
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
          extractedText = geminiText;
        }
      } catch (e) {
        console.warn('Gemini PDF fallback failed:', e);
      }
    }
  }

  if (!extractedText || extractedText.trim().length < 20) {
    throw new Error('자료 내용을 충분히 확인하지 못했습니다. 다른 파일 형식으로 다시 업로드하거나 자료를 확인해주세요.');
  }

  // AI-Assisted Document Structure & Chapter Extraction
  let analysis: {
    title?: string;
    chapters?: Array<{ name: string; preview: string }>;
    keyTopics?: string[];
    keyRules?: string[];
    procedures?: string[];
  } | null = null;

  if (ai) {
    try {
      analysis = await analyzeDocumentWithAI(ai, extractedText, fileName);
    } catch (aiErr) {
      console.warn('AI analysis skipped/failed, falling back to rule-based:', aiErr);
    }
  }

  const title = analysis?.title || detectTitle(extractedText, fileName);
  const keyTopics = analysis?.keyTopics && analysis.keyTopics.length > 0
    ? analysis.keyTopics
    : detectKeyTopics(extractedText);

  let chapters: Array<{ id: string; name: string; preview: string; charCount: number }> = [];

  if (analysis?.chapters && analysis.chapters.length > 0) {
    const totalChars = extractedText.length;
    const estPerChap = Math.round(totalChars / analysis.chapters.length);
    chapters = analysis.chapters.map((c, i) => ({
      id: `chap-${i + 1}`,
      name: c.name,
      preview: c.preview,
      charCount: estPerChap,
    }));
  } else {
    chapters = detectChapters(extractedText, fileName);
  }

  return {
    title,
    totalChars: extractedText.length,
    content: extractedText,
    chapters,
    keyTopics,
    keyRules: analysis?.keyRules,
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
    const result = await parser.getText();
    if (result && result.text && result.text.trim().length > 40) {
      text = result.text.trim();
    }
  } catch (err) {
    console.warn('pdf-parse failed:', err);
  }

  // If text is still empty or too short (scanned PDF), use Gemini Vision/PDF if available
  if (text.length < 50 && ai && base64Data) {
    try {
      text = await extractPdfWithGemini(ai, base64Data);
    } catch (geminiErr) {
      console.warn('Gemini PDF OCR fallback error:', geminiErr);
    }
  }

  if (text.length === 0) {
    // PDF stream fallback: look for FlateDecode streams
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
        text: '이 PDF 문서의 모든 본문 텍스트를 정확하게 추출해줘. 문서의 단원 구분(제1장, 제2장 등), 소제목, 세부 규정 조항, 수치 요건을 누락 없이 한국어 원문 그대로 서술형으로 작성해줘.',
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
  // Check BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }

  // Try UTF-8
  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }

  // If replacement characters found, try CP949 (Korean Windows)
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
 * Uses Gemini to parse document structure accurately into chapters, rules, and topics
 */
async function analyzeDocumentWithAI(
  ai: GoogleGenAI,
  text: string,
  fileName: string
): Promise<{
  title: string;
  chapters: Array<{ name: string; preview: string }>;
  keyTopics: string[];
  keyRules?: string[];
  procedures?: string[];
}> {
  const snippet = text.slice(0, 10000);

  const prompt = `
당신은 우편직무 교육·업무자료 전문 분석가입니다.
제공된 우편직무 자료의 본문 내용을 분석하여, 시험 평가문제 출제에 필요한 정보를 JSON으로 정확하게 추출하십시오.

- 파일명: ${fileName}
- 분석할 본문 내용 발췌:
${snippet}

[출력 요구사항]
1. title: 자료의 공식 제목 또는 핵심 주제명 (간결하게)
2. chapters: 자료에 등장하는 주요 단원 또는 목차 2~6개 (예: "제1장 통상우편물 규격요건 및 접수기준", "제2장 국내우편 요금체계 및 감액제도"). 만약 단원 번호가 명시되지 않았다면 내용별 핵심 소주제로 명확히 구분할 것.
   - 각 chapter의 preview: 해당 단원에서 다루는 주요 업무 기준 또는 핵심 내용 1~2문장 요약
3. keyTopics: 본문에서 가장 핵심이 되는 우편직무 키워드 4~8개
4. keyRules: 반드시 알아야 하는 구체적 규정 조항이나 수치 요건 (예: "통상 규격우편물 중량 50g 이하", "소포우편물 최대 중량 30kg 이하", "내용증명 보관기간 3년")
5. procedures: 창구 접수 절차, 배상 청구 절차, 위험물 확인 요령 등 주요 업무 처리 지침
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction: '우편직무 평가자료의 단원과 기준을 정확하게 분석하는 분석관입니다.',
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
                name: { type: Type.STRING },
                preview: { type: Type.STRING },
              },
              required: ['name', 'preview'],
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
 * Fallback rule-based chapter detection
 */
function detectChapters(text: string, fileName: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const chapterList: Array<{ id: string; name: string; preview: string; charCount: number }> = [];

  const chapterRegex = /^(제\s*[0-9一二三四五\s]+[장절편부목관]|\[[^\]]+\]|[0-9]{1,2}\.\s+[가-힣]|【[^】]+】|제\s*[0-9]+\s*장|[I|V|X]+\.\s+[가-힣]|[가-힣\s]{2,20}\s*(편람|규정|지침|요건|기준|체계))/;

  let currentChapterName = '';
  let currentLines: string[] = [];
  let chapIdx = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (chapterRegex.test(line) && line.length < 60) {
      if (currentChapterName && currentLines.length > 0) {
        const fullContent = currentLines.join(' ');
        chapterList.push({
          id: `chap-${chapIdx++}`,
          name: currentChapterName,
          preview: fullContent.slice(0, 120) + (fullContent.length > 120 ? '...' : ''),
          charCount: fullContent.length,
        });
        currentLines = [];
      }
      currentChapterName = line;
    } else {
      currentLines.push(line);
    }
  }

  if (currentChapterName && currentLines.length > 0) {
    const fullContent = currentLines.join(' ');
    chapterList.push({
      id: `chap-${chapIdx++}`,
      name: currentChapterName,
      preview: fullContent.slice(0, 120) + (fullContent.length > 120 ? '...' : ''),
      charCount: fullContent.length,
    });
  }

  // If no chapters detected, split into logical blocks
  if (chapterList.length === 0) {
    const totalLen = text.length;
    const chunkSize = Math.max(1500, Math.floor(totalLen / 3));
    const parts = splitIntoBlocks(text, chunkSize);

    parts.forEach((part, idx) => {
      const firstLine = part.split('\n')[0].slice(0, 35) || `우편직무 제${idx + 1}영역`;
      chapterList.push({
        id: `chap-${idx + 1}`,
        name: `제${idx + 1}영역: ${firstLine}`,
        preview: part.slice(0, 120) + '...',
        charCount: part.length,
      });
    });
  }

  return chapterList;
}

function splitIntoBlocks(text: string, targetSize: number): string[] {
  const paragraphs = text.split('\n\n');
  const blocks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > targetSize && current.length > 0) {
      blocks.push(current.trim());
      current = p;
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current.trim().length > 0) {
    blocks.push(current.trim());
  }
  return blocks.length > 0 ? blocks : [text];
}

function detectTitle(text: string, fileName: string): string {
  const cleanFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]/g, ' ');
  const firstLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  if (firstLines.length > 0 && firstLines[0].length < 50 && !firstLines[0].startsWith('http')) {
    return firstLines[0].replace(/^\[|\]$/g, '');
  }
  return cleanFileName || '우편직무 평가자료';
}

function detectKeyTopics(text: string): string[] {
  const candidates = [
    '통상우편', '규격우편물', '우편요금', '요금감액', '등기우편', '소포우편물',
    '내용증명', '배달증명', '당일특급', '익일특급', '손해배상', '환부불능',
    '우편금지물품', '위험물', '리튬배터리', '개피요구권', '우편법', '접수기준'
  ];

  const found = candidates.filter((k) => text.includes(k));
  return found.length >= 3 ? found.slice(0, 6) : ['우편직무 기본지침', '업무 절차 및 기준', '규정 적용'];
}
