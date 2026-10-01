/**
 * Sanitizes a question stem to ensure NO table of contents, chapter names (제X장),
 * section names (제X절), scope markers, or document division labels ever appear in the question stem.
 * The question stem must strictly read like a pure, professional civil service exam question.
 */
export function sanitizeQuestionStem(question: string): string {
  if (!question) return '';

  let cleaned = String(question).trim();

  // 1. Remove bracketed / parenthesized prefixes containing stages, chapters, sections, TOC, or scope:
  // Matches [...] or 【...】 or (...) where inner text contains chapter, section, stage, scope, or TOC keywords
  const bracketPrefixRegex = /^(\[[^\]]*\]|【[^】]*】|\([^\)]*\)|<[^>]*>)\s*/;
  while (true) {
    const match = cleaned.match(bracketPrefixRegex);
    if (
      match &&
      /(?:제\s*\d+\s*[장절편부관단]|단계|단원|목차|범위|출제|과목|평가)/i.test(match[1])
    ) {
      cleaned = cleaned.slice(match[0].length).trim();
    } else {
      break;
    }
  }

  // 2. Remove leading chapter/section prefixes e.g. "제1장: ", "제2장 - ", "제1절. ", "제1장 ", "1단계: 제1장 "
  cleaned = cleaned.replace(/^(?:(?:[0-9]+단계\s*:\s*)?제\s*\d+\s*[장절편부관단]\s*[:.\-–—]?\s*)+/gi, '');

  // 3. Remove in-sentence bracketed chapter/section/range markers with postpositions:
  // e.g. "[제1장 ...]에서" -> "관련 규정에서"
  cleaned = cleaned.replace(
    /(\[[^\]]*\]|【[^】]*】|\([^\)]*\))\s*에서/gi,
    (m, b) => (/(?:장|절|편|단원|목차|범위|단계)/.test(b) ? '관련 규정에서' : m)
  );
  // e.g. "[제1장 ...]에 따른" -> "관련 규정에 따른"
  cleaned = cleaned.replace(
    /(\[[^\]]*\]|【[^】]*】|\([^\)]*\))\s*에\s*(?:따른|의한|관한)/gi,
    (m, b) => (/(?:장|절|편|단원|목차|범위|단계)/.test(b) ? '관련 규정에 따른' : m)
  );
  // e.g. "[제1장 ...]" with optional "의" -> removed
  cleaned = cleaned.replace(
    /(\[[^\]]*\]|【[^】]*】|\([^\)]*\))\s*(?:의)?\s*/gi,
    (m, b) => (/(?:장|절|편|단원|목차|범위|단계)/.test(b) ? '' : m)
  );

  // 4. Remove standalone chapter/section division text like "제1장 제2절의 규정에 따르면" -> "관련 규정에 따르면"
  cleaned = cleaned.replace(
    /제\s*\d+\s*[장절편부관단]\s*(?:및\s*)?(?:제\s*\d+\s*[장절편부관단])?\s*(?:의)?\s*(규정|기준|지침|내용|조항)?/gi,
    (_match, p1) => {
      return p1 ? `관련 ${p1}` : '';
    }
  );

  // 5. Remove any leftover "1단계: ...", "2단계: ..." patterns
  cleaned = cleaned.replace(/[0-9]+단계\s*:[^,\s\]]+/gi, '');

  // 6. Clean dangling particles after '다음 중'
  cleaned = cleaned.replace(/다음\s*중\s*(?:의|에서|에\s*대한)\s*/g, '다음 중 ');

  // 7. Remove any leading/trailing symbols, dots, colons, or dashes
  cleaned = cleaned.replace(/^[.:\-–—\s#*[\]【】<>]+/, '').trim();

  // 8. Normalize duplicate '다음 중'
  cleaned = cleaned.replace(/^(?:다음\s*중\s*)+/g, '다음 중 ');

  // 9. Ensure smooth start if text was left with leading particles
  if (cleaned.startsWith('의 ')) {
    cleaned = cleaned.replace(/^의\s+/, '다음 중 ');
  } else if (cleaned.startsWith('에서 ')) {
    cleaned = cleaned.replace(/^에서\s+/, '관련 규정에서 ');
  } else if (cleaned.startsWith('정한 ') || cleaned.startsWith('규정한 ')) {
    cleaned = '다음 중 관련 규정에서 ' + cleaned;
  }

  // Double spaces collapse
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}

/**
 * Sanitizes option/choice text to remove document leading prefixes/bullets:
 * e.g., '1.. ', '1) ', '1. ', '(1) ', '[1] ', '1-1. ', '1.1. ', '가. ', '가) ', '(가) ', '① ', '• ', '- ', '* ' etc.
 * Preserves decimal numbers (e.g., '1.5배', '0.15mm') and legitimate values.
 */
export function sanitizeOptionText(option: string): string {
  if (!option) return '';

  let cleaned = String(option).trim();

  let prev = '';
  let loops = 0;
  while (cleaned !== prev && loops < 5) {
    prev = cleaned;
    loops++;

    // 1. Bullet symbols at start: •, ∙, ·, -, ―, —, *, ※, ■, □, ▶, ▷, ◆, ◇, ○, ●, ★, ☆, ✔, #
    cleaned = cleaned.replace(/^[•∙·\-–—*※■□▶▷◆◇○●★☆✔#]+\s*/, '');

    // 2. Numbers with multiple dots, or single dot (not followed by a digit, so decimals like 1.5 are preserved), or closing paren/bracket/colon
    // Handles: '1..', '1.', '1)', '(1)', '[1]', '1-1.', '1-1)', '1.1.'
    // A. Parenthesized or bracketed numbers: (1), [1], (1-1), [1.1]
    cleaned = cleaned.replace(/^(?:\(\s*\d+(?:[-.]\d+)*\s*\)|\[\s*\d+(?:[-.]\d+)*\s*\])\s*/, '');
    // B. Sub-numbered with hyphen: 1-1., 1-2), 1-1-1.
    cleaned = cleaned.replace(/^\d+(?:-\d+)+\s*(?:\.{1,3}|\)|:|;)\s*/, '');
    // C. Dotted sub-numbering: 1.1., 1.2.1. (must end with dot/paren not followed by digit)
    cleaned = cleaned.replace(/^\d+(?:\.\d+)+\s*(?:\.{1,3}|\)|:|;)\s*/, '');
    // D. Number with double/triple dots e.g. 1.. or 2...
    cleaned = cleaned.replace(/^\d+\s*\.{2,3}\s*/, '');
    // E. Number with single dot NOT followed by digit, or with ), :, ; e.g. '1. ', '1) ', '1: '
    cleaned = cleaned.replace(/^\d+\s*(?:\.(?!\d)|\)|:|;)\s*/, '');

    // 3. Korean Hangul markers: '가.', '가)', '(가)', '[가]', '㉮', 'ㄱ.', 'ㄱ)', '(ㄱ)'
    cleaned = cleaned.replace(/^(?:\(\s*[가-힣ㄱ-ㅎ]\s*\)|\[\s*[가-힣ㄱ-ㅎ]\s*\]|[가-힣ㄱ-ㅎ]\s*(?:\.{1,3}|\)|:|;))\s*/, '');
    cleaned = cleaned.replace(/^[㉮-㉹㈀-㈍]\s*/, '');

    // 4. Circled numbers: ① ~ ⑳, ❶ ~ ❿
    cleaned = cleaned.replace(/^[①-⑳❶-❿\u3251-\u325f\u32b1-\u32bf]\s*/, '');

    // 5. English letters: 'A.', 'A)', '(A)', '[A]', 'a.', 'a)', '(a)'
    cleaned = cleaned.replace(/^(?:\(\s*[A-Za-z]\s*\)|\[\s*[A-Za-z]\s*\]|[A-Za-z]\s*(?:\.{1,3}|\)|:|;))\s*/, '');

    // 6. Roman numerals: 'I.', 'II.', 'III.', 'IV.', 'i.', 'ii.', 'Ⅰ', 'Ⅱ', '(I)'
    cleaned = cleaned.replace(/^(?:\(\s*(?:[IVXLCDMivxlcdm]+|[Ⅰ-Ⅻⅰ-ⅻ])\s*\)|(?:[IVXLCDMivxlcdm]+|[Ⅰ-Ⅻⅰ-ⅻ])\s*(?:\.{1,3}|\)|:|;))\s*/, '');
  }

  // Trim leftover colons, dashes or periods at start
  cleaned = cleaned.replace(/^[.:\-–—\s]+/, '').trim();

  return cleaned;
}

/**
 * Sanitizes an array of 4 question options
 */
export function sanitizeQuestionOptions(options: string[]): [string, string, string, string] {
  const safe: [string, string, string, string] = [
    sanitizeOptionText(options?.[0] || ''),
    sanitizeOptionText(options?.[1] || ''),
    sanitizeOptionText(options?.[2] || ''),
    sanitizeOptionText(options?.[3] || ''),
  ];
  return safe;
}
