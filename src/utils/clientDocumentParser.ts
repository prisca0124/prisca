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
 * 2-Tier Hierarchical Detection: 1단계 '제X장' & 2단계 '제X절'
 */
export function detectChaptersByJangAndJeol(
  content: string,
  fileName: string
): DocumentChapter[] {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const chapterList: DocumentChapter[] = [];

  // Regex for 1단계 '제X장' / '第X章'
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
        preview: preview || `${cur.fullTitle} 관련 세부 실무 규정 및 기준`,
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
        preview: preview || `${normalizedChapterName} 관련 우편업무 기준 및 처리 요령`,
        charCount: chapterText.length || 600,
        sections,
      });
    }

    return chapterList.slice(0, 10);
  }

  // Fallback: partition into 3~5 logical '제X장' with '제X절'
  const totalLen = content.length;
  const numChunks = Math.min(5, Math.max(3, Math.round(totalLen / 3500)));
  const chunkSize = Math.floor(totalLen / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = i === numChunks - 1 ? totalLen : (i + 1) * chunkSize;
    const slice = content.slice(start, end).trim();
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

function detectKeyTopics(content: string): string[] {
  const topics = [
    '통상우편', '소포우편', '우편요금', '다량우편감액', '내용증명', '등기취급',
    '손해배상', '우편금지물품', '특약소포', '국제우편(EMS)', '우편물류', '배달증명',
    '당일특급', '익일특급', '리튬배터리', '개피요구권', '우편수수료'
  ];

  const found = topics.filter((t) => content.includes(t));
  return found.length >= 3 ? found.slice(0, 8) : ['우편직무', '규격기준', '요금체계'];
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
