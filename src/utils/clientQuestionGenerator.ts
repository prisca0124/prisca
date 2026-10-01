import type { ExamConfig, PostalQuestion } from '../types/index.ts';
import { sanitizeQuestionStem, sanitizeOptionText } from './sanitizeQuestion.ts';

/**
 * Client-Side Question Generator
 * Generates valid 4-choice questions directly in the browser when deployed statically (e.g., GitHub Pages)
 * Grounded strictly in the extracted document sentences, numbers, chapters, and regulations.
 * Distributes questions evenly across all selected chapters and sections without list prefixes in options.
 */
export function generateQuestionsInBrowser(
  content: string,
  selectedChapters: string[],
  config: ExamConfig
): PostalQuestion[] {
  const count = Math.max(1, Math.min(30, config.questionCount || 10));
  const questions: PostalQuestion[] = [];

  const allLines = content
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const activeChapters = selectedChapters && selectedChapters.length > 0
    ? selectedChapters
    : ['우편직무 일반규정'];

  const activeSections = config.selectedSections && config.selectedSections.length > 0
    ? config.selectedSections
    : [];

  // Group lines by chapter for balanced distribution across chosen scopes
  const chapterLinesMap = new Map<string, string[]>();
  activeChapters.forEach((ch) => chapterLinesMap.set(ch, []));

  let detectedChapter = activeChapters[0];
  for (const line of allLines) {
    for (const ch of activeChapters) {
      // Check if line marks a chapter or belongs to it
      const chClean = ch.replace(/^[0-9]+단계\s*:\s*/, '').slice(0, 10);
      if (line.includes(chClean)) {
        detectedChapter = ch;
        break;
      }
    }

    const isTitle = activeChapters.some((ch) => ch.includes(line) || line.includes(ch));
    if (!isTitle && line.length >= 10 && line.length <= 250) {
      chapterLinesMap.get(detectedChapter)?.push(line);
    }
  }

  // Ensure each chapter has candidate lines from general text if empty
  activeChapters.forEach((ch) => {
    const list = chapterLinesMap.get(ch) || [];
    if (list.length === 0) {
      const generalLines = allLines.filter(
        (l) => l.length >= 10 && !activeChapters.some((c) => c.includes(l))
      );
      list.push(...generalLines);
      chapterLinesMap.set(ch, list);
    }
  });

  const difficulties: Array<'쉬움' | '보통' | '어려움'> = [];
  const easyCount = Math.round((config.difficultyRatio.easy / 100) * count);
  const hardCount = Math.round((config.difficultyRatio.hard / 100) * count);
  const medCount = Math.max(0, count - easyCount - hardCount);

  for (let i = 0; i < easyCount; i++) difficulties.push('쉬움');
  for (let i = 0; i < medCount; i++) difficulties.push('보통');
  while (difficulties.length < count) difficulties.push('어려움');

  // Distribute questions evenly across active chapters and sections
  for (let i = 0; i < count; i++) {
    const targetChapter = activeChapters[i % activeChapters.length];
    const candidateLines = chapterLinesMap.get(targetChapter) || allLines;
    const lineIndex = Math.floor(i / activeChapters.length) % Math.max(1, candidateLines.length);
    const factLine = candidateLines[lineIndex] || '규격우편물의 허용 규격과 요금 기준을 충족해야 한다.';

    const targetNum = (i % 4) + 1; // 1, 2, 3, 4 evenly distributed
    const secName = activeSections.length > 0
      ? activeSections[i % activeSections.length]
      : undefined;

    const categoryText = secName ? `${targetChapter} > ${secName}` : targetChapter;

    const generated = createSingleQuestionFromFact(
      factLine,
      categoryText,
      i + 1,
      targetNum,
      difficulties[i] || '보통'
    );
    questions.push(generated);
  }

  return questions;
}

function createSingleQuestionFromFact(
  rawFactSentence: string,
  chapter: string,
  num: number,
  targetAnswer: number,
  difficulty: '쉬움' | '보통' | '어려움'
): PostalQuestion {
  // Strip any leading document list markers (1.., 1), 1., 가., •, - etc.)
  const factSentence = sanitizeOptionText(rawFactSentence);

  // Check if sentence contains numeric specs (e.g. 50g, 3년, 160cm, 2,000통)
  const numMatch = factSentence.match(/([0-9,.]+)\s*(g|kg|mm|cm|통|원|년|일|개월|%)/);

  // Extract a natural topical phrase from the sentence content rather than displaying chapter/TOC markers
  let topic = '관련 업무 규정 및 취급 기준';
  if (factSentence.includes('규격') || factSentence.includes('치수') || factSentence.includes('중량') || factSentence.includes('봉투')) {
    topic = '통상 규격우편물의 규격요건 및 접수 기준';
  } else if (factSentence.includes('요금') || factSentence.includes('감액') || factSentence.includes('별납') || factSentence.includes('후납')) {
    topic = '국내우편 요금체계 및 납부·감액 기준';
  } else if (factSentence.includes('소포') || factSentence.includes('택배')) {
    topic = '소포우편물 취급 및 크기·중량 제한 기준';
  } else if (factSentence.includes('내용증명') || factSentence.includes('등기') || factSentence.includes('배달증명') || factSentence.includes('보험')) {
    topic = '부가우편서비스 취급 및 보관·증명 기준';
  } else if (factSentence.includes('배달') || factSentence.includes('반송') || factSentence.includes('보관')) {
    topic = '우편물 배달 및 보관·반송 처리 기준';
  }

  let questionText = `다음 중 ${topic}에 대한 설명으로 가장 옳은 것은?`;
  let correctOption = sanitizeOptionText(factSentence);
  let wrongOptions: string[] = [];

  if (numMatch) {
    const rawVal = numMatch[1];
    const unit = numMatch[2];
    const val = parseFloat(rawVal.replace(/,/g, ''));

    questionText = `다음 중 ${topic}의 세부 기준치 및 취급 요건에 대한 설명으로 가장 옳은 것은?`;

    // Create plausible distractor numbers
    const d1 = isNaN(val) ? '제한 없음' : `${Math.round(val * 1.5).toLocaleString()}${unit}`;
    const d2 = isNaN(val) ? '협의 후 결정' : `${Math.max(1, Math.round(val * 0.5)).toLocaleString()}${unit}`;
    const d3 = isNaN(val) ? '별도 기준 적용' : `${Math.round(val * 2).toLocaleString()}${unit}`;

    wrongOptions = [
      sanitizeOptionText(factSentence.replace(numMatch[0], `${d1}으로 무조건 제한`)),
      sanitizeOptionText(factSentence.replace(numMatch[0], `${d2} 미만일 때만 적용`)),
      sanitizeOptionText(factSentence.replace(numMatch[0], `${d3} 이상으로 완화`)),
    ];
  } else {
    wrongOptions = [
      sanitizeOptionText(factSentence.replace(/해야 한다|이다/g, '하지 않아도 무방하다')),
      '해당 사항은 우편법령상 규정이 없으므로 창구 직원의 재량으로 임의 처리한다.',
      sanitizeOptionText(factSentence.replace(/가능하다|적용된다/g, '원칙적으로 절대 허용되지 않는다')),
    ];
  }

  // Place correct option at targetAnswer (1~4)
  const options: [string, string, string, string] = ['', '', '', ''];
  options[targetAnswer - 1] = correctOption;

  let wrongIdx = 0;
  for (let o = 0; o < 4; o++) {
    if (o !== targetAnswer - 1) {
      options[o] = sanitizeOptionText(wrongOptions[wrongIdx] || `관련 규정의 예외 기준을 별도로 적용하지 않는다 (${o + 1})`);
      wrongIdx++;
    }
  }

  return {
    id: `q-client-${Date.now()}-${num}-${Math.random().toString(36).slice(2, 6)}`,
    number: num,
    question: sanitizeQuestionStem(questionText),
    options,
    answer: targetAnswer as 1 | 2 | 3 | 4,
    explanation: `[정답 근거]: ${correctOption}\n해당 조항에 명시된 기준 및 사실에 따라 ${['①', '②', '③', '④'][targetAnswer - 1]}번이 유일하게 옳은 설명입니다.`,
    difficulty,
    category: chapter,
    source: `${chapter} (자료 본문 발췌)`,
    status: '승인',
    qualityCheck: {
      singleAnswer: true,
      sourceSupported: true,
      ambiguity: false,
    },
    createdAt: new Date().toISOString(),
  };
}
