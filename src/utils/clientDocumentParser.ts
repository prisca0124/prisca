import * as CFB from 'cfb';
import JSZip from 'jszip';
import { inflate, inflateRaw } from 'pako';
import { ParsedDocument } from '../types';

/**
 * Universal browser-side document parser for HWP, HWPX, PDF, DOCX, and TXT.
 * Works 100% offline in the browser without requiring a backend server.
 * Perfect for GitHub Pages, static deployments, and client-side processing.
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
    // Fallback: scan for Korean strings in binary
    extractedText = scanBinaryForKoreanText(uint8);
  }

  // If still too short, attempt fallback scan
  if (!extractedText || extractedText.trim().length < 20) {
    extractedText = scanBinaryForKoreanText(uint8);
  }

  if (!extractedText || extractedText.trim().length < 15) {
    throw new Error(
      `'${fileName}'에서 유효한 텍스트를 추출하지 못했습니다. 파일이 손상되었거나 암호화되어 있는지 확인해주세요.`
    );
  }

  extractedText = cleanExtractedText(extractedText);

  // Analyze structure (Title, Chapters, Key Topics, Regulations)
  const title = detectTitle(extractedText, fileName);
  const chapters = detectChapters(extractedText, fileName);
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
    .sort();

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
  // Check if it's HWPX disguised as .hwp
  if (uint8.length > 4 && uint8[0] === 0x50 && uint8[1] === 0x4b) {
    try {
      const hwpx = await extractHwpxInBrowser(uint8);
      if (hwpx && hwpx.trim().length > 30) return hwpx;
    } catch {
      // continue
    }
  }

  // Check if HWP 3.0
  const headerStr = new TextDecoder('latin1').decode(uint8.subarray(0, 30));
  if (headerStr.startsWith('HWP Document File V3.00')) {
    return extractHwp3InBrowser(uint8);
  }

  // HWP 5.0 OLE Compound File
  try {
    const cfb = CFB.read(uint8, { type: 'array' });
    const textSections: string[] = [];

    // 1. Look for BodyText/Section*
    const sectionNames = cfb.FileIndex
      .map((entry) => entry.name)
      .filter((name) => /BodyText\/Section\d+/i.test(name) || /Section\d+/i.test(name))
      .sort();

    for (const secName of sectionNames) {
      const secEntry = CFB.find(cfb, secName);
      if (secEntry && secEntry.content && secEntry.content.length > 0) {
        const rawContent = new Uint8Array(secEntry.content);
        let decompressed: Uint8Array;

        try {
          decompressed = inflateRaw(rawContent);
        } catch {
          try {
            decompressed = inflate(rawContent);
          } catch {
            decompressed = rawContent;
          }
        }

        const secText = parseHwpTagRecordsInBrowser(decompressed);
        if (secText.trim()) {
          textSections.push(secText.trim());
        }
      }
    }

    if (textSections.length > 0) {
      return textSections.join('\n\n');
    }

    // 2. Look for PrvText (Preview Text UTF-16LE)
    const prvEntry = CFB.find(cfb, 'PrvText') || CFB.find(cfb, 'BodyText/PrvText');
    if (prvEntry && prvEntry.content && prvEntry.content.length > 0) {
      const utf16 = new TextDecoder('utf-16le').decode(new Uint8Array(prvEntry.content));
      if (utf16.trim().length > 30) {
        return utf16;
      }
    }
  } catch (cfbErr) {
    console.warn('CFB browser extraction error:', cfbErr);
  }

  // Fallback to binary scanner
  return scanBinaryForKoreanText(uint8);
}

/**
 * Parse HWP TAG_PARA_TEXT records from decompressed section stream
 */
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
        paragraphs.push(text);
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
    if (code >= 1 && code <= 31) {
      if (code === 10 || code === 13) chars.push('\n');
      else if (code === 9) chars.push('\t');
      else if (code === 24 || code === 25 || code === 26 || code === 27) chars.push(' ');
      continue;
    }

    chars.push(String.fromCharCode(code));
  }

  return chars.join('');
}

/**
 * Extract HWP 3.0 in browser
 */
function extractHwp3InBrowser(uint8: Uint8Array): string {
  const bodyBytes = uint8.subarray(128);
  let text = '';
  try {
    text = new TextDecoder('euc-kr').decode(bodyBytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bodyBytes);
  }
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

/**
 * Extract DOCX in browser
 */
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

/**
 * Extract PDF in browser (text streams & object patterns)
 */
async function extractPdfInBrowser(uint8: Uint8Array): Promise<string> {
  const latin1 = new TextDecoder('latin1').decode(uint8);
  const textParts: string[] = [];

  // Match BT ... ET blocks (PDF text blocks)
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

  // Decompress FlateDecode streams with pako
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

/**
 * Decode plain text (UTF-8 or EUC-KR)
 */
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

/**
 * Scan binary buffer for UTF-16LE or EUC-KR Korean strings
 */
function scanBinaryForKoreanText(uint8: Uint8Array): string {
  const koreanChunks: string[] = [];

  // Try UTF-16LE
  try {
    const utf16 = new TextDecoder('utf-16le').decode(uint8);
    const lines = utf16.split(/[\r\n\x00]+/);
    for (const line of lines) {
      const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
      if (clean.length > 4 && /[가-힣]/.test(clean)) {
        koreanChunks.push(clean);
      }
    }
  } catch {
    // continue
  }

  // Try EUC-KR
  if (koreanChunks.length < 5) {
    try {
      const euckr = new TextDecoder('euc-kr').decode(uint8);
      const lines = euckr.split(/[\r\n]+/);
      for (const line of lines) {
        const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
        if (clean.length > 4 && /[가-힣]/.test(clean)) {
          koreanChunks.push(clean);
        }
      }
    } catch {
      // continue
    }
  }

  return koreanChunks.join('\n');
}

/**
 * Clean extracted text
 */
function cleanExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detect Document Title
 */
function detectTitle(content: string, fileName: string): string {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && l.length <= 40);

  for (const line of lines.slice(0, 10)) {
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
      return line.replace(/^[#*[\]\s]+/, '').replace(/[#*[\]\s]+$/, '');
    }
  }

  return fileName.replace(/\.[^/.]+$/, '');
}

/**
 * Detect Chapters from content
 */
function detectChapters(
  content: string,
  fileName: string
): Array<{ id: string; name: string; preview: string; charCount: number }> {
  const lines = content.split('\n');
  const chapterHeaders: Array<{ index: number; title: string }> = [];

  const chapterRegex =
    /^(제\s*\d+\s*[장편절목관]|第\s*\d+\s*[章篇節]|단원\s*\d+|[0-9]{1,2}\.\s+[가-힣]{2,}|[IVXLCDM]+\.\s+[가-힣]{2,}|\[.+?\])/;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.length >= 3 && trimmed.length <= 60 && chapterRegex.test(trimmed)) {
      chapterHeaders.push({ index: idx, title: trimmed });
    }
  });

  if (chapterHeaders.length >= 2) {
    const results: Array<{ id: string; name: string; preview: string; charCount: number }> = [];

    for (let i = 0; i < chapterHeaders.length; i++) {
      const cur = chapterHeaders[i];
      const nextIndex = i + 1 < chapterHeaders.length ? chapterHeaders[i + 1].index : lines.length;
      const sectionLines = lines.slice(cur.index, nextIndex);
      const sectionText = sectionLines.join('\n').trim();

      const preview = sectionLines
        .slice(1, 5)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join(' ')
        .slice(0, 140);

      results.push({
        id: `chap-${i + 1}`,
        name: cur.title,
        preview: preview || `${cur.title} 관련 세부 업무 규정 및 기준`,
        charCount: sectionText.length,
      });
    }

    return results.slice(0, 15);
  }

  // Fallback: chunk by 2,000 characters
  const chunkSize = 2000;
  const chunks: Array<{ id: string; name: string; preview: string; charCount: number }> = [];
  const total = content.length;
  let count = 1;

  for (let i = 0; i < total; i += chunkSize) {
    const slice = content.slice(i, i + chunkSize);
    chunks.push({
      id: `chap-${count}`,
      name: `제${count}장 우편직무 실무영역 (${count}단원)`,
      preview: slice.slice(0, 120).trim() + '...',
      charCount: slice.length,
    });
    count++;
  }

  return chunks.slice(0, 8);
}

/**
 * Detect Key Topics
 */
function detectKeyTopics(content: string): string[] {
  const topics = [
    '통상우편',
    '소포우편',
    '우편요금',
    '다량우편감액',
    '내용증명',
    '등기취급',
    '손해배상',
    '우편금지물품',
    '특약소포',
    '국제우편(EMS)',
    '우편물류',
    '배달증명',
  ];

  const found = topics.filter((t) => content.includes(t));
  return found.length > 0 ? found.slice(0, 6) : ['우편직무', '규격기준', '요금체계'];
}

/**
 * Detect Key Regulations & Numeric Criteria
 */
function detectKeyRules(content: string): string[] {
  const rules: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      (trimmed.includes('mm') ||
        trimmed.includes('cm') ||
        trimmed.includes('kg') ||
        trimmed.includes('g') ||
        trimmed.includes('통') ||
        trimmed.includes('원') ||
        trimmed.includes('년') ||
        trimmed.includes('일')) &&
      trimmed.length >= 10 &&
      trimmed.length <= 80 &&
      /[0-9]/.test(trimmed)
    ) {
      if (!rules.includes(trimmed)) {
        rules.push(trimmed);
      }
    }
    if (rules.length >= 6) break;
  }

  return rules;
}
