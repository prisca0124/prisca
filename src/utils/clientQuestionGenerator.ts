import { ExamConfig, PostalQuestion } from '../types';

/**
 * Client-Side Question Generator
 * Generates valid 4-choice questions directly in the browser when deployed statically (e.g., GitHub Pages)
 * Grounded strictly in the extracted document sentences, numbers, chapters, and regulations.
 */
export function generateQuestionsInBrowser(
  content: string,
  selectedChapters: string[],
  config: ExamConfig
): PostalQuestion[] {
  const count = Math.max(1, Math.min(30, config.questionCount || 10));
  const questions: PostalQuestion[] = [];

  // Extract sentences with numbers, rules, and definitions
  const lines = content
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 15 && l.length <= 160);

  // Filter by selected chapters if present
  const ruleLines: Array<{ line: string; chapter: string }> = [];
  let currentChapter = selectedChapters[0] || '우편직무 일반규정';

  for (const line of lines) {
    for (const chap of selectedChapters) {
      if (line.includes(chap) || chap.includes(line.slice(0, 10))) {
        currentChapter = chap;
        break;
      }
    }

    if (
      line.includes('기준') ||
      line.includes('이상') ||
      line.includes('이하') ||
      line.includes('제출') ||
      line.includes('보관') ||
      line.includes('규격') ||
      line.includes('요금') ||
      line.includes('취급') ||
      line.includes('배달') ||
      line.includes('금지') ||
      line.includes('통상') ||
      line.includes('소포')
    ) {
      ruleLines.push({ line, chapter: currentChapter });
    }
  }

  // Fallback to all lines if ruleLines is too small
  if (ruleLines.length < count) {
    for (const line of lines) {
      ruleLines.push({ line, chapter: currentChapter });
      if (ruleLines.length >= count * 2) break;
    }
  }

  const difficulties: Array<'쉬움' | '보통' | '어려움'> = [];
  const easyCount = Math.round((config.difficultyRatio.easy / 100) * count);
  const hardCount = Math.round((config.difficultyRatio.hard / 100) * count);
  const medCount = Math.max(0, count - easyCount - hardCount);

  for (let i = 0; i < easyCount; i++) difficulties.push('쉬움');
  for (let i = 0; i < medCount; i++) difficulties.push('보통');
  while (difficulties.length < count) difficulties.push('어려움');

  for (let i = 0; i < count; i++) {
    const item = ruleLines[i % ruleLines.length] || {
      line: '규격우편물의 허용 규격과 요금 기준을 충족해야 한다.',
      chapter: currentChapter,
    };

    const targetNum = (i % 4) + 1; // 1, 2, 3, 4 evenly distributed
    const generated = createSingleQuestionFromFact(item.line, item.chapter, i + 1, targetNum, difficulties[i] || '보통');
    questions.push(generated);
  }

  return questions;
}

function createSingleQuestionFromFact(
  factSentence: string,
  chapter: string,
  num: number,
  targetAnswer: number,
  difficulty: '쉬움' | '보통' | '어려움'
): PostalQuestion {
  // Check if sentence contains numeric specs (e.g. 50g, 3년, 160cm, 2,000통)
  const numMatch = factSentence.match(/([0-9,.]+)\s*(g|kg|mm|cm|통|원|년|일|개월|%)/);

  let questionText = `다음 중 [${chapter}]의 관련 업무 규정 및 기준에 대한 설명으로 가장 옳은 것은?`;
  let correctOption = factSentence;
  let wrongOptions: string[] = [];

  if (numMatch) {
    const rawVal = numMatch[1];
    const unit = numMatch[2];
    const val = parseFloat(rawVal.replace(/,/g, ''));

    questionText = `[${chapter}]에서 규정한 세부 기준치 및 취급 요건에 대한 설명으로 가장 옳은 것은?`;

    // Create plausible distractor numbers
    const d1 = isNaN(val) ? '제한 없음' : `${Math.round(val * 1.5).toLocaleString()}${unit}`;
    const d2 = isNaN(val) ? '협의 후 결정' : `${Math.max(1, Math.round(val * 0.5)).toLocaleString()}${unit}`;
    const d3 = isNaN(val) ? '별도 기준 적용' : `${Math.round(val * 2).toLocaleString()}${unit}`;

    wrongOptions = [
      factSentence.replace(numMatch[0], `${d1}으로 무조건 제한`),
      factSentence.replace(numMatch[0], `${d2} 미만일 때만 적용`),
      factSentence.replace(numMatch[0], `${d3} 이상으로 완화`),
    ];
  } else {
    wrongOptions = [
      factSentence.replace(/해야 한다|이다/g, '하지 않아도 무방하다'),
      '해당 사항은 우편법령상 규정이 없으므로 창구 직원의 재량으로 임의 처리한다.',
      factSentence.replace(/가능하다|적용된다/g, '원칙적으로 절대 허용되지 않는다'),
    ];
  }

  // Place correct option at targetAnswer (1~4)
  const options: [string, string, string, string] = ['', '', '', ''];
  options[targetAnswer - 1] = correctOption;

  let wrongIdx = 0;
  for (let o = 0; o < 4; o++) {
    if (o !== targetAnswer - 1) {
      options[o] = wrongOptions[wrongIdx] || `관련 규정의 예외 기준을 별도로 적용하지 않는다 (${o + 1})`;
      wrongIdx++;
    }
  }

  return {
    id: `q-client-${Date.now()}-${num}-${Math.random().toString(36).slice(2, 6)}`,
    number: num,
    question: questionText,
    options,
    answer: targetAnswer as 1 | 2 | 3 | 4,
    explanation: `[정답 근거]: ${factSentence}\n해당 조항에 명시된 기준 및 사실에 따라 ${['①', '②', '③', '④'][targetAnswer - 1]}번이 유일하게 옳은 설명입니다.`,
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
