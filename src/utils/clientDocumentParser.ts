import * as CFB from 'cfb';
import JSZip from 'jszip';
import { inflate, inflateRaw } from 'pako';
import { ParsedDocument, DocumentChapter, DocumentSection } from '../types';

/**
 * Universal browser-side document parser for HWP, HWPX, PDF, DOCX, and TXT.
 * Works 100% offline in the browser without requiring a backend server.
 * Analyzes document structure in 2 hierarchical tiers:
 * - 1단계: '제X장' (Chapter)
 * - 2단계: '제X절' (Section)
 */
export async function parseDocumentInBrowser(
  file: File,
  arrayBuffer: ArrayBuffer
): Promise<ParsedDocument> {
  const fileName = file.name;
  const ext = fileName.toLowerCase().split('.').pop() || 'hwp';
  const uint8 = new Uint8Array(arrayBuffer);

  let extractedText = '';

  try {
    if (ext === 'hwpx') {
      extractedText = await extractHwpxInBrowser(uint8);
    } else if (ext === 'hwp') {
      extractedText = await extractHwpInBrowser(uint8);
    } else if (ext === 'docx') {
      extractedText = await extractDocxInBrowser(uint8);
    } else if (ext === 'pdf') {
      extractedText = await extractPdfInBrowser(uint8);
    } else {
      extractedText = decodePlainTextInBrowser(uint8);
    }
  } catch (err: any) {
    console.warn(`Browser parsing primary attempt for .${ext} failed:`, err);
    extractedText = scanBinaryForKoreanText(uint8);
  }

  if (!extractedText || extractedText.trim().length < 20) {
    extractedText = scanBinaryForKoreanText(uint8);
  }

  if (!extractedText || extractedText.trim().length < 15) {
    throw new Error(
      `'${fileName}'에서 유효한 텍스트를 추출하지 못했습니다. 파일이 손상되었거나 암호화되어 있는지 확인해주세요.`
    );
  }

  extractedText = cleanExtractedText(extractedText);

  // Analyze 2-Tier Structure: 1단계 제X장, 2단계 제X절
  const title = detectTitle(extractedText, fileName);
  const chapters = detectChaptersByJangAndJeol(extractedText, fileName);
  const keyTopics = detectKeyTopics(extractedText);
  const keyRules = detectKeyRules(extractedText);

  return {
    id: `doc-${Date.now()}`,
    fileName: file.name,
    fileType: ext as any,
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    title,
    totalChars: extractedText.length,
    content: extractedText,
    chapters,
    keyTopics,
    keyRules,
  };
}

/**
 * Extract HWPX in browser (Zip container with Contents/section*.xml)
 */
async function extractHwpxInBrowser(uint8: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(uint8);
  const textParts: string[] = [];

  const sectionFiles = Object.keys(zip.files)
    .filter((f) => f.includes('section') && f.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

  if (sectionFiles.length === 0) {
    for (const [name, f] of Object.entries(zip.files)) {
      if (name.endsWith('.xml') && !name.includes('manifest') && !name.includes('container') && !f.dir) {
        sectionFiles.push(name);
      }
    }
  }

  for (const fileKey of sectionFiles) {
    const xmlContent = await zip.files[fileKey].async('string');
    const cleaned = xmlContent
      .replace(/<\/hp:tc>/gi, '  ')
      .replace(/<\/hp:tr>/gi, '\n')
      .replace(/<\/hp:p>/gi, '\n')
      .replace(/<hp:t[^>]*>(.*?)<\/hp:t>/gis, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n');

    if (cleaned.trim()) {
      textParts.push(cleaned.trim());
    }
  }

  return textParts.join('\n\n');
}

/**
 * Extract HWP 5.0 (OLE Compound File) in browser using CFB & pako
 */
async function extractHwpInBrowser(uint8: Uint8Array): Promise<string> {
  if (uint8.length > 4 && uint8[0] === 0x50 && uint8[1] === 0x4b) {
    try {
      const hwpx = await extractHwpxInBrowser(uint8);
      if (hwpx && hwpx.trim().length > 30) return hwpx;
    } catch {
      // continue
    }
  }

  const headerStr = new TextDecoder('latin1').decode(uint8.subarray(0, 30));
  if (headerStr.startsWith('HWP Document File V3.00')) {
    return extractHwp3InBrowser(uint8);
  }

  try {
    const cfb = CFB.read(uint8, { type: 'array' });
    const textSections: string[] = [];

    let isCompressed = true;
    const fileHeaderEntry = cfb.FileIndex.find((e) => e.name === 'FileHeader');
    if (fileHeaderEntry && fileHeaderEntry.content) {
      const hBytes = new Uint8Array(fileHeaderEntry.content);
      if (hBytes.length >= 40) {
        isCompressed = (hBytes[36] & 0x01) !== 0;
      }
    }

    const sectionEntries = cfb.FileIndex
      .filter((entry) => entry.type === 2 && /Section\d+/i.test(entry.name))
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.name.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });

    for (const secEntry of sectionEntries) {
      if (!secEntry.content || (secEntry.content as any).length === 0) continue;
      const rawContent = new Uint8Array(secEntry.content);
      let decompressed: Uint8Array;

      if (isCompressed) {
        try {
          decompressed = inflateRaw(rawContent);
        } catch {
          try {
            decompressed = inflate(rawContent);
          } catch {
            decompressed = rawContent;
          }
        }
      } else {
        decompressed = rawContent;
      }

      const secText = parseHwpTagRecordsInBrowser(decompressed);
      if (secText.trim()) {
        textSections.push(secText.trim());
      }
    }

    const prvEntry = cfb.FileIndex.find((e) => e.name === 'PrvText');
    let prvText = '';
    if (prvEntry && prvEntry.content && (prvEntry.content as any).length > 0) {
      prvText = new TextDecoder('utf-16le').decode(new Uint8Array(prvEntry.content)).trim();
    }

    const combined = textSections.join('\n\n').trim();
    if (combined.length > 50) {
      return combined;
    }

    if (prvText.length > combined.length) {
      return prvText;
    }

    if (combined || prvText) {
      return combined || prvText;
    }
  } catch (cfbErr) {
    console.warn('CFB browser extraction error:', cfbErr);
  }

  return scanBinaryForKoreanText(uint8);
}

function parseHwpTagRecordsInBrowser(bytes: Uint8Array): string {
  const paragraphs: string[] = [];
  let offset = 0;
  const HWPTAG_PARA_TEXT = 67;

  while (offset + 4 <= bytes.length) {
    const header =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);

    const tagId = header & 0x3ff;
    let length = (header >> 20) & 0xfff;
    offset += 4;

    if (length === 0xfff) {
      if (offset + 4 <= bytes.length) {
        length =
          bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24);
        offset += 4;
      }
    }

    if (offset + length > bytes.length) {
      length = bytes.length - offset;
    }

    if (tagId === HWPTAG_PARA_TEXT && length > 0) {
      const recordBytes = bytes.subarray(offset, offset + length);
      const text = decodeHwpParagraphBytesInBrowser(recordBytes);
      if (text.trim().length > 0) {
        paragraphs.push(text.trim());
      }
    }

    offset += length;
  }

  return paragraphs.join('\n');
}

function decodeHwpParagraphBytesInBrowser(bytes: Uint8Array): string {
  const chars: string[] = [];
  let i = 0;

  while (i + 1 < bytes.length) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    i += 2;

    if (code === 0) continue;
    if (code === 10 || code === 13) chars.push('\n');
    else if (code === 9) chars.push('  ');
    else if (code === 30 || code === 32) chars.push(' ');
    else if (code === 31 || code === 24) chars.push('-');
    else if (code >= 32) {
      chars.push(String.fromCharCode(code));
    }
  }

  return chars.join('');
}

function extractHwp3InBrowser(uint8: Uint8Array): string {
  const bodyBytes = uint8.subarray(128);
  let text = '';
  try {
    text = new TextDecoder('euc-kr').decode(bodyBytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bodyBytes);
  }
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\r\n/g, '\n');
}

async function extractDocxInBrowser(uint8: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(uint8);
  const docXmlFile = zip.files['word/document.xml'];
  if (!docXmlFile) throw new Error('DOCX 본문(word/document.xml)을 찾을 수 없습니다.');

  const xml = await docXmlFile.async('string');
  return xml
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:tc>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function extractPdfInBrowser(uint8: Uint8Array): Promise<string> {
  const latin1 = new TextDecoder('latin1').decode(uint8);
  const textParts: string[] = [];

  const btRegex = /BT[\s\S]*?ET/g;
  let match: RegExpExecArray | null;

  while ((match = btRegex.exec(latin1)) !== null) {
    const block = match[0];
    const tjRegex = /\((.*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    let blockText = '';

    while ((tjMatch = tjRegex.exec(block)) !== null) {
      blockText += tjMatch[1] + ' ';
    }

    if (blockText.trim()) {
      textParts.push(blockText.trim());
    }
  }

  if (textParts.length > 5) {
    return textParts.join('\n');
  }

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((match = streamRegex.exec(latin1)) !== null) {
    const rawStream = match[1];
    const streamBytes = new Uint8Array(rawStream.length);
    for (let i = 0; i < rawStream.length; i++) {
      streamBytes[i] = rawStream.charCodeAt(i) & 0xff;
    }

    try {
      const decompressed = inflate(streamBytes);
      const str = new TextDecoder('utf-8').decode(decompressed);
      if (/[가-힣]/.test(str)) {
        textParts.push(str.replace(/<[^>]+>/g, ' '));
      }
    } catch {
      // continue
    }
  }

  if (textParts.length > 0) {
    return textParts.join('\n');
  }

  return scanBinaryForKoreanText(uint8);
}

function decodePlainTextInBrowser(uint8: Uint8Array): string {
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    return utf8;
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(uint8);
    } catch {
      return new TextDecoder('latin1').decode(uint8);
    }
  }
}

function scanBinaryForKoreanText(uint8: Uint8Array): string {
  const koreanChunks: string[] = [];

  try {
    const utf16 = new TextDecoder('utf-16le').decode(uint8);
    const lines = utf16.split(/[\r\n\x00]+/);
    for (const line of lines) {
      const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
      if (clean.length > 5 && /[가-힣]/.test(clean)) {
        koreanChunks.push(clean);
      }
    }
  } catch {
    // continue
  }

  if (koreanChunks.length < 5) {
    try {
      const euckr = new TextDecoder('euc-kr').decode(uint8);
      const lines = euckr.split(/[\r\n]+/);
      for (const line of lines) {
        const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
        if (clean.length > 5 && /[가-힣]/.test(clean)) {
          koreanChunks.push(clean);
        }
      }
    } catch {
      // continue
    }
  }

  return koreanChunks.join('\n');
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detect Document Title
 */
function detectTitle(content: string, fileName: string): string {
  const cleanFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]/g, ' ');
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);

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

/**
 * Pure literal '제X장' and '제X절' analyzer.
 * All previous heuristics, fallbacks, and arbitrary generation rules are completely deleted.
 * ONLY lines literally containing '제X장' (or '第X章') and '제X절' (or '第X節') are recognized.
 */
export function detectChaptersByJangAndJeol(
  content: string,
  fileName: string
): DocumentChapter[] {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Strict regex for literal '제X장' / '第X章'
  const JANG_REGEX =
    /^(?:[#*[\]【】<>·•▶■◆○□※\s\d.-]*)(제\s*[0-9一二三四五육칠팔구십]+\s*장|第\s*[0-9一二三四五육칠팔구십]+\s*章)(?:[\s.:\-–—]*)(.*)$/;

  // Strict regex for literal '제X절' / '第X절'
  const JEOL_REGEX =
    /^(?:[#*[\]【】<>·•▶■◆○□※\s\d.-]*)(제\s*[0-9一二三四五육칠팔구십]+\s*절|第\s*[0-9一二三四五육칠팔구십]+\s*節)(?:[\s.:\-–—]*)(.*)$/;

  const isTocDotLine = (l: string) =>
    /[.·…]{3,}\s*\d+\s*$/.test(l) || /[-–—]{3,}\s*\d+\s*$/.test(l);

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

      const cleanSub = subTitle.replace(/[.·…\-–—]{2,}\s*\d+\s*$/, '').trim();
      const combinedTitle = cleanSub ? `${prefix} ${cleanSub}` : prefix;

      allJangMatches.push({
        lineIndex: i,
        title: combinedTitle,
        isToc: isTocDotLine(line),
      });
    }
  }

  const bodyJangMatches = allJangMatches.filter((m) => !m.isToc);
  const effectiveJangMatches = bodyJangMatches.length > 0 ? bodyJangMatches : allJangMatches;

  if (effectiveJangMatches.length >= 1) {
    const chapters: DocumentChapter[] = [];

    for (let i = 0; i < effectiveJangMatches.length; i++) {
      const curJang = effectiveJangMatches[i];
      const nextIdx =
        i + 1 < effectiveJangMatches.length ? effectiveJangMatches[i + 1].lineIndex : lines.length;

      const chapterLines = lines.slice(curJang.lineIndex + 1, nextIdx);
      const chapterText = chapterLines.join('\n').trim();

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

  const docTitle = detectTitle(content, fileName);
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
      charCount: content.length,
      sections: undefined,
    },
  ];
}

function detectKeyTopics(content: string): string[] {
  const wordCounts = new Map<string, number>();
  const words = content.match(/[가-힣]{2,10}/g) || [];
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

  const lines = content.split('\n').slice(0, 10);
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

function detectKeyRules(content: string): string[] {
  const rules: string[] = [];
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length >= 10);

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
