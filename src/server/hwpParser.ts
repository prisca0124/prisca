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
    .sort();

  if (sectionFiles.length === 0) {
    // try any xml inside Contents/
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

    textParts.push(cleaned.trim());
  }

  return textParts.join('\n\n');
}

/**
 * HWP 5.0 Parser using CFB (Compound File Binary)
 */
function extractHwp5(buffer: Buffer): string {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const allPaths = cfb.FullPaths || [];

  // 1. Check FileHeader to see if compressed
  let isCompressed = true; // default true for HWP 5.0
  const fileHeaderEntry = CFB.find(cfb, '/FileHeader') || CFB.find(cfb, 'FileHeader');
  if (fileHeaderEntry && fileHeaderEntry.content) {
    const headerBuf = Buffer.from(fileHeaderEntry.content as any);
    if (headerBuf.length >= 40) {
      // Byte 36: bit 0 is compression flag
      isCompressed = (headerBuf[36] & 0x01) !== 0;
    }
  }

  const paragraphs: string[] = [];

  // 2. Find all Section streams: e.g. BodyText/Section0, Section1, etc.
  const sectionPaths = allPaths.filter((p) => {
    const lower = p.toLowerCase();
    return lower.includes('bodytext') && lower.includes('section');
  }).sort();

  for (const path of sectionPaths) {
    const entry = CFB.find(cfb, path);
    if (!entry || !entry.content) continue;

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

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  // 3. If sections didn't return text, check for PrvText (Preview Text stream)
  const prvTextEntry = CFB.find(cfb, '/PrvText') || CFB.find(cfb, 'PrvText');
  if (prvTextEntry && prvTextEntry.content) {
    const prvBuf = Buffer.from(prvTextEntry.content as any);
    const prvText = prvBuf.toString('utf16le');
    if (prvText && prvText.trim().length > 30) {
      return prvText.trim();
    }
  }

  return '';
}

/**
 * Parses HWP 5.0 records from a decompressed section stream
 */
function parseHwpRecords(buf: Buffer): string {
  const result: string[] = [];
  let offset = 0;

  // Tag 67 is HWPTAG_PARA_TEXT (본문 문단 텍스트)
  // Tag 66 is HWPTAG_PARA_HEADER (문단 헤더)
  const HWPTAG_PARA_TEXT = 67;

  while (offset + 4 <= buf.length) {
    const header = buf.readUInt32LE(offset);
    const tagId = header & 0x3ff;
    const level = (header >> 10) & 0x3ff;
    let size = (header >> 20) & 0xfff;
    offset += 4;

    if (size === 0xfff) {
      if (offset + 4 > buf.length) break;
      size = buf.readUInt32LE(offset);
      offset += 4;
    }

    if (offset + size > buf.length) break;

    if (tagId === HWPTAG_PARA_TEXT) {
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
    } else if (code === 0x001f) {
      // Hyphen
      text += '-';
    } else if (code >= 0x0020) {
      // Standard printable characters (Korean, alphanumeric, symbols)
      text += String.fromCharCode(code);
    }
    // Ignore codes 0x0000 - 0x001D (inline object anchors like tables, pictures, fields)
  }

  return text;
}

/**
 * HWP 3.0 Parser (legacy CP949 KS X 1001 text)
 */
function extractHwp3(buffer: Buffer): string {
  // Skip 128-byte header
  const data = buffer.slice(128);
  const text = iconv.decode(data, 'cp949');
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\r\n/g, '\n');
}

/**
 * Fallback scanner: searches binary buffer for Deflate streams or UTF-16LE/CP949 Korean chunks
 */
function scanBufferForKoreanText(buffer: Buffer): string {
  const parts: string[] = [];

  // Try raw inflate on slices where deflate might start
  for (let i = 0; i < buffer.length - 32; i += 4) {
    // Check possible zlib headers (0x78 0x9C, 0x78 0x01, 0x78 0xDA)
    if (buffer[i] === 0x78 && (buffer[i + 1] === 0x9c || buffer[i + 1] === 0x01 || buffer[i + 1] === 0xda)) {
      try {
        const slice = buffer.slice(i, Math.min(i + 2097152, buffer.length));
        const unzipped = zlib.inflateSync(slice);
        if (unzipped.length > 50) {
          const utf16 = unzipped.toString('utf16le');
          const clean = cleanKoreanString(utf16);
          if (clean.length > 50) {
            parts.push(clean);
            i += slice.length / 2;
          }
        }
      } catch {
        // continue
      }
    }
  }

  if (parts.length > 0) {
    return parts.join('\n\n');
  }

  // Scan for UTF-16LE Korean text strings
  const utf16Text = buffer.toString('utf16le');
  const koreanMatches = utf16Text.match(/[가-힣0-9a-zA-Z\s.,·~()\[\]{}""'':;%+-/]{10,}/g);
  if (koreanMatches && koreanMatches.length > 3) {
    return koreanMatches.map((s) => s.trim()).filter((s) => s.length > 5).join('\n');
  }

  // Scan for CP949 text
  const cp949Text = iconv.decode(buffer, 'cp949');
  const cp949Matches = cp949Text.match(/[가-힣0-9a-zA-Z\s.,·~()\[\]{}""'':;%+-/]{15,}/g);
  if (cp949Matches && cp949Matches.length > 3) {
    return cp949Matches.map((s) => s.trim()).filter((s) => s.length > 5).join('\n');
  }

  return '';
}

function cleanKoreanString(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
