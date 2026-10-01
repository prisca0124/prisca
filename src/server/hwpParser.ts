import zlib from 'zlib';
import JSZip from 'jszip';
import * as CFB from 'cfb';
import iconv from 'iconv-lite';

/**
 * Extracts readable Korean text from HWP (HWP 5.0 OLE, HWPX Zip, and HWP 3.0)
 */
export async function extractHwpText(buffer: Buffer): Promise<string> {
  // 1. Check if it's HWPX (ZIP archive starting with PK\x03\x04 or 50 4B 03 04)
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    try {
      const hwpxText = await extractHwpx(buffer);
      if (hwpxText && hwpxText.trim().length > 30) {
        return hwpxText;
      }
    } catch (err) {
      console.warn('HWPX extract attempt failed, continuing to HWP 5.0:', err);
    }
  }

  // 2. Check if it's HWP 3.0
  const headerStr = buffer.slice(0, 30).toString('binary');
  if (headerStr.startsWith('HWP Document File V3.00')) {
    try {
      const hwp3Text = extractHwp3(buffer);
      if (hwp3Text && hwp3Text.trim().length > 30) {
        return hwp3Text;
      }
    } catch (err) {
      console.warn('HWP 3.0 extraction failed:', err);
    }
  }

  // 3. HWP 5.0 (OLE Compound File) - Standard modern HWP format
  try {
    const hwp5Text = extractHwp5(buffer);
    if (hwp5Text && hwp5Text.trim().length > 30) {
      return hwp5Text;
    }
  } catch (err) {
    console.warn('HWP 5.0 extraction via CFB failed:', err);
  }

  // 4. Fallback: Scan buffer for Deflate streams and strings
  const fallback = scanBufferForKoreanText(buffer);
  if (fallback && fallback.trim().length > 30) {
    return fallback;
  }

  throw new Error('HWP 문서 본문을 추출할 수 없습니다. 파일이 손상되었거나 암호화되어 있는지 확인해주세요.');
}

/**
 * HWPX Parser (Zip archive of XML documents)
 */
export async function extractHwpx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const textParts: string[] = [];

  // Match Contents/section*.xml or any section*.xml
  const sectionFiles = Object.keys(zip.files)
    .filter((f) => f.includes('section') && f.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

  if (sectionFiles.length === 0) {
    for (const [name, file] of Object.entries(zip.files)) {
      if (name.endsWith('.xml') && !name.includes('manifest') && !name.includes('container') && !file.dir) {
        sectionFiles.push(name);
      }
    }
  }

  for (const fileKey of sectionFiles) {
    const xmlContent = await zip.files[fileKey].async('string');

    // Clean XML into readable text preserving paragraphs and tables
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
 * HWP 5.0 Parser using CFB (Compound File Binary)
 */
function extractHwp5(buffer: Buffer): string {
  const cfb = CFB.read(buffer, { type: 'buffer' });

  // 1. Check FileHeader to see if compressed
  let isCompressed = true; // default true for HWP 5.0
  const fileHeaderEntry = cfb.FileIndex.find((e) => e.name === 'FileHeader') ||
    CFB.find(cfb, '/FileHeader') ||
    CFB.find(cfb, 'FileHeader');

  if (fileHeaderEntry && fileHeaderEntry.content) {
    const headerBuf = Buffer.from(fileHeaderEntry.content as any);
    if (headerBuf.length >= 40) {
      // Byte 36: bit 0 is compression flag
      isCompressed = (headerBuf[36] & 0x01) !== 0;
    }
  }

  const paragraphs: string[] = [];

  // 2. Find all Section streams: e.g. BodyText/Section0, Section1, etc.
  // Sort numerically so Section10 comes after Section9, not Section1
  const sectionEntries = cfb.FileIndex
    .filter((entry) => entry.type === 2 && /Section\d+/i.test(entry.name))
    .sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.name.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

  for (const entry of sectionEntries) {
    if (!entry.content || (entry.content as any).length === 0) continue;

    const rawBuf = Buffer.from(entry.content as any);
    let sectionData: Buffer;

    if (isCompressed) {
      try {
        // HWP 5.0 uses raw deflate (no zlib 2-byte header)
        sectionData = zlib.inflateRawSync(rawBuf);
      } catch {
        try {
          // fallback to standard zlib
          sectionData = zlib.inflateSync(rawBuf);
        } catch {
          sectionData = rawBuf;
        }
      }
    } else {
      sectionData = rawBuf;
    }

    // Parse HWP 5.0 records in this section
    const sectionText = parseHwpRecords(sectionData);
    if (sectionText.length > 0) {
      paragraphs.push(sectionText);
    }
  }

  // 3. Check PrvText (Preview Text stream)
  const prvTextEntry = cfb.FileIndex.find((e) => e.name === 'PrvText') ||
    CFB.find(cfb, '/PrvText') ||
    CFB.find(cfb, 'PrvText');

  let prvText = '';
  if (prvTextEntry && prvTextEntry.content) {
    const prvBuf = Buffer.from(prvTextEntry.content as any);
    prvText = prvBuf.toString('utf16le').trim();
  }

  const combinedSections = paragraphs.join('\n\n').trim();

  // If section parsing yielded good text, return it
  if (combinedSections.length > 50) {
    return combinedSections;
  }

  // If PrvText has more content, use PrvText
  if (prvText.length > combinedSections.length) {
    return prvText;
  }

  return combinedSections || prvText;
}

/**
 * Parses HWP 5.0 records from a decompressed section stream
 */
function parseHwpRecords(buf: Buffer): string {
  const result: string[] = [];
  let offset = 0;

  // Tag 67 is HWPTAG_PARA_TEXT (본문 문단 텍스트)
  const HWPTAG_PARA_TEXT = 67;

  while (offset + 4 <= buf.length) {
    const header = buf.readUInt32LE(offset);
    const tagId = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    offset += 4;

    if (size === 0xfff) {
      if (offset + 4 > buf.length) break;
      size = buf.readUInt32LE(offset);
      offset += 4;
    }

    if (offset + size > buf.length) {
      size = buf.length - offset;
    }

    if (tagId === HWPTAG_PARA_TEXT && size > 0) {
      const recordBuf = buf.slice(offset, offset + size);
      const text = decodeHwpParaText(recordBuf);
      if (text.trim().length > 0) {
        result.push(text.trim());
      }
    }

    offset += size;
  }

  return result.join('\n');
}

/**
 * Decodes UTF-16LE character stream in HWPTAG_PARA_TEXT,
 * filtering out HWP inline control tokens while preserving newlines and spaces
 */
function decodeHwpParaText(recordBuf: Buffer): string {
  let text = '';
  for (let i = 0; i + 2 <= recordBuf.length; i += 2) {
    const code = recordBuf.readUInt16LE(i);

    if (code === 0x000a || code === 0x000d) {
      // Line feed / carriage return
      text += '\n';
    } else if (code === 0x0009) {
      // Tab
      text += '  ';
    } else if (code === 0x001e || code === 0x0020) {
      // Non-breaking space or standard space
      text += ' ';
    } else if (code === 0x001f || code === 0x0018) {
      // Hyphen
      text += '-';
    } else if (code >= 0x0020) {
      // Standard printable characters (Korean, alphanumeric, symbols)
      text += String.fromCharCode(code);
    }
  }

  return text;
}

/**
 * HWP 3.0 Parser (legacy CP949 KS X 1001 text)
 */
function extractHwp3(buffer: Buffer): string {
  const data = buffer.slice(128);
  let text = '';
  try {
    text = iconv.decode(data, 'cp949');
  } catch {
    text = data.toString('utf-8');
  }
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\r\n/g, '\n');
}

/**
 * Fallback scanner: searches binary buffer for Deflate streams or UTF-16LE/CP949 Korean chunks
 */
function scanBufferForKoreanText(buffer: Buffer): string {
  const parts: string[] = [];

  // 1. Try UTF-16LE scan
  try {
    const utf16 = buffer.toString('utf16le');
    const lines = utf16.split(/[\r\n\x00]+/);
    for (const line of lines) {
      const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
      if (clean.length > 5 && /[가-힣]/.test(clean)) {
        parts.push(clean);
      }
    }
  } catch {
    // continue
  }

  // 2. Try CP949 scan
  if (parts.length < 5) {
    try {
      const cp949 = iconv.decode(buffer, 'cp949');
      const lines = cp949.split(/[\r\n]+/);
      for (const line of lines) {
        const clean = line.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,·~%()/\-[\]:;""'']/g, ' ').trim();
        if (clean.length > 5 && /[가-힣]/.test(clean)) {
          parts.push(clean);
        }
      }
    } catch {
      // continue
    }
  }

  return parts.join('\n');
}
