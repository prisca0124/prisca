import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { parseDocumentBuffer } from './src/server/documentParser.ts';
import type { PostalQuestion, ExamConfig } from './src/types/index.ts';
import { sanitizeQuestionStem, sanitizeOptionText } from './src/utils/sanitizeQuestion.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Robust Gemini caller with exponential backoff and model cluster failover
 * Handles 503 UNAVAILABLE (high demand spikes), 429 rate limits, and transient errors
 */
async function generateContentWithRetry(
  params: {
    contents: any;
    config?: any;
    primaryModel?: string;
    fallbackModel?: string;
    maxRetries?: number;
  }
) {
  const models = [
    params.primaryModel || 'gemini-3.8-flash',
    params.fallbackModel || 'gemini-3.1-flash-lite',
  ];

  let lastError: any = null;
  const maxRetries = params.maxRetries || 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Attempt 0: Primary model (gemini-3.8-flash)
    // Attempt 1: Fallback model (gemini-3.1-flash-lite) to bypass model-specific capacity limit
    // Attempt 2: Retry with jittered backoff
    const currentModel = attempt === 0 ? models[0] : (models[1] || models[0]);

    try {
      console.log(`[Gemini API] Requesting model: ${currentModel} (Attempt ${attempt + 1}/${maxRetries})`);
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: params.contents,
        config: params.config,
      });

      if (response && response.text) {
        return response;
      }
      throw new Error('응답 텍스트가 비어있습니다.');
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      const is503 = errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE');
      const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
      const isTransient = is503 || is429 || errMsg.includes('500') || errMsg.includes('fetch failed');

      console.warn(`[Gemini API] Attempt ${attempt + 1} failed with ${currentModel}: ${errMsg}`);

      if (!isTransient || attempt >= maxRetries - 1) {
        break;
      }

      // Exponential backoff with random jitter (1.2s ~ 3.5s)
      const delayMs = 1200 * (attempt + 1) + Math.floor(Math.random() * 800);
      console.log(`[Gemini API] Backing off for ${delayMs}ms before attempt ${attempt + 2}...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// 1. Document Parsing Endpoint
app.post('/api/parse-document', async (req, res) => {
  try {
    const { fileName, fileType, base64Data, plainText } = req.body;

    if (plainText && plainText.trim().length > 0) {
      const buffer = Buffer.from(plainText, 'utf-8');
      const result = await parseDocumentBuffer(buffer, fileName || '우편직무자료.txt', 'txt', undefined, ai);
      return res.json({ success: true, document: result });
    }

    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: '출제자료를 먼저 업로드해주세요.',
      });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const result = await parseDocumentBuffer(buffer, fileName || 'document.hwp', fileType || 'hwp', base64Data, ai);

    return res.json({ success: true, document: result });
  } catch (error: any) {
    console.error('Error parsing document:', error);
    const msg = error.message || '';
    const is503 = msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE');
    const friendlyError = is503
      ? '구글 AI 모델의 일시적 트래픽 집중(503)이 발생했습니다. 잠시 후 다시 시도해주시거나 [텍스트 직접 입력] 탭을 이용해주세요.'
      : (msg || '자료 내용을 충분히 확인하지 못했습니다. 다른 파일 형식으로 다시 업로드하거나 자료를 확인해주세요.');

    return res.status(400).json({
      success: false,
      error: friendlyError,
      isRetryable: is503,
    });
  }
});

// 2. Question Generation Endpoint
app.post('/api/generate-questions', async (req, res) => {
  try {
    const { content, selectedChapters, config } = req.body as {
      content: string;
      selectedChapters: string[];
      config: ExamConfig;
    };

    if (!content || content.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: '출제자료가 비어있거나 너무 짧습니다. 먼저 유효한 우편직무 자료를 업로드해주세요.',
      });
    }

    const count = Math.max(1, Math.min(30, config.questionCount || 10));
    const easyCount = Math.round((config.difficultyRatio.easy / 100) * count);
    const hardCount = Math.round((config.difficultyRatio.hard / 100) * count);
    const mediumCount = Math.max(0, count - easyCount - hardCount);

    const orientations = config.orientations && config.orientations.length > 0
      ? config.orientations.join(', ')
      : '핵심내용 중심, 업무상황 중심';

    const activeChapters = selectedChapters && selectedChapters.length > 0 ? selectedChapters : [];
    const activeSections = config.selectedSections && config.selectedSections.length > 0 ? config.selectedSections : [];

    const chapterScope = activeChapters.length > 0
      ? `다음 지정된 단원 범위 내에서만 출제하세요:\n- ${activeChapters.join('\n- ')}`
      : '문서의 전 범위에서 고르게 출제하세요.';

    const sectionScope = activeSections.length > 0
      ? `\n[선택된 세부 출제 절(2단계)]:\n- ${activeSections.join('\n- ')}`
      : '';

    // Calculate balanced quota allocation across selected chapters to ensure even distribution
    let distributionQuotaSection = '';
    if (activeChapters.length > 0) {
      const basePerChap = Math.floor(count / activeChapters.length);
      const remainder = count % activeChapters.length;
      const chapterListWithQuotas = activeChapters.map((chap, idx) => {
        const quota = basePerChap + (idx < remainder ? 1 : 0);
        return `- [${chap}]: 약 ${quota}문항 출제 (필수 배분)`;
      });

      distributionQuotaSection = `
### [선택 범위 내 문항 균등 배분 할당표 - 엄격 준수]
출제자가 지정한 아래 범위 전체에서 편중 없이 고르게 문제를 출제하십시오. 특정 단원에 치우치지 않아야 합니다:
${chapterListWithQuotas.join('\n')}
${activeSections.length > 0 ? `[선택된 세부 절]: 아래 절들에서도 골고루 나누어 출제하십시오:\n- ${activeSections.join('\n- ')}` : ''}
*필수: 위 할당표에 명시된 단원별 문항 수에 맞춰 모든 선택 단원에서 균등하게 출제해야 합니다.
`;
    }

    // Optimize content context slice (support up to 60,000 characters to cover full document and all chapters)
    const contextSnippet = content.length > 60000 ? content.slice(0, 60000) : content;

    const prompt = `
당신은 첨부된 [출제 근거자료]에 명시된 사실과 규정만을 바탕으로 평가문제를 개발하는 전문 출제위원입니다.
제공된 [출제 근거자료] 본문 텍스트에 실제로 존재하는 내용에만 100% 입각하여 고품질 4지선다형 객관식 평가문제를 작성하십시오.

### [출제 조건]
- 과목명: ${config.subject || '우편직무 실무평가'}
- 총 출제 문항 수: ${count}문항
- 난이도 배분: 쉬움 ${easyCount}문항, 보통 ${mediumCount}문항, 어려움 ${hardCount}문항
- 문제 출제 방향: ${orientations}
- 출제 범위 (1단계 제X장 및 2단계 제X절): ${chapterScope}${sectionScope}
${distributionQuotaSection}
### [엄격한 문제 출제 원칙 - 절대 위반 금지]
1. [100% 자료 근거 원칙 (외부 지식 및 가상 내용 추가 절대 금지)]:
   - 반드시 아래에 제공된 [출제 근거자료] 본문에 실제로 명시되어 있는 사실, 규정, 기준 수치, 조항에만 100% 근거하여 출제하십시오.
   - 자료 본문에 없는 외부 우편 상식이나 다른 규정, 일반적인 수치(예: 본문에 없는 특정 무게, 요금, 기간, 법령 등)를 임의로 끌어와서 문제나 보기에 추가하지 마십시오.
   - 정답 보기뿐만 아니라 3개의 오답 보기 역시 본문 내용의 사실을 바탕으로 수치를 변경하거나 조건을 반대로 기술하는 방식으로 작성하십시오. 본문과 무관한 엉뚱한 외부 개념을 지어내지 마십시오.
2. [문제 발문(question) 작성 절대 원칙 - 목차 및 출제범위 표기 절대 금지]:
   - **가장 중요**: 문제 발문(question)은 실제 시험지에 인쇄되어 수험생이 읽고 푸는 순수 평가 문제 지문입니다. 발문 내에 파일의 목차, 단원명, 장·절 명칭(예: '제1장', '제2절', '[1단계: ...]', '[제1장 ...]', '[출제범위: ...]', '목차' 등)이나 문서 출제 범위를 절대로 노출하거나 포함하지 마십시오!
   - 문제 발문은 오직 순수한 질문 지문(예: "다음 중 통상 규격우편물의 허용 중량 및 규격 요건으로 옳은 것은?", "다음 중 다량우편물 요금 감액 요건에 대한 설명으로 옳지 않은 것은?")으로만 간결하고 명확하게 작성해야 합니다.
   - 단원이나 절, 목차, 출제범위 정보는 발문(question)이 아닌 'category' 및 'source' 필드에만 기재하십시오.
3. [선택 범위 균등 배분 절대 원칙 (특정 단원 편중 금지)]:
   - 출제자가 선택한 모든 단원(제X장)과 세부 절(제X절)에서 어느 한쪽에 치우치지 않고 정해진 총 문항 수(${count}문항)를 골고루 나누어 균등하게 배분하여 출제하십시오.
   - 앞쪽 단원에서만 문제를 몰아서 내고 뒤쪽 단원을 누락하거나 적게 내어서는 절대 안 됩니다.
   - 각 문제의 'category' 필드에 출제된 단원 또는 세부 절의 명칭을 명확하게 기재하십시오.
4. [보기(options) 작성 시 원본 말머리 기호(1.., 1), 1., 가., - 등) 포함 절대 금지]:
   - **가장 중요**: 원본 문서의 목록이나 문장 앞에 붙어 있던 말머리 기호(예: '1.', '1..', '1)', '(1)', '[1]', '1-1.', '가.', '가)', '(가)', '①', '②', '-', '•', '*' 등)를 절대로 보기에 그대로 포함하지 마십시오!
   - 보기는 시험지의 번호(①, ②, ③, ④) 뒤에 바로 이어지는 순수한 설명 내용이어야 합니다.
   - 잘못된 작성 예: "1. 가로 140~235mm이다.", "1) 우편요금 사전 납부", "1.. 허용 기준치 적용"
   - 올바른 작성 예: "가로 140~235mm이다.", "우편요금을 사전에 납부한다.", "허용 기준치를 적용한다."
5. [정답 명확성]: 4개의 보기 중 오직 1개만이 확실한 정답이어야 합니다. 복수정답이 가능한 논란성 문제는 절대 금지합니다.
6. [보기 품질]:
   - 4개의 보기는 서로 뚜렷하게 구별되어야 합니다.
   - 정답 보기만 지나치게 길거나 구체적으로 작성하여 쉽게 눈치채지 않도록 보기들의 길이와 문체를 균형 있게 작성하십시오.
   - '모두 맞다', '모두 틀리다', '위의 것 모두 해당한다' 등의 보기는 절대로 사용하지 마십시오.
7. [정답 위치 균등 분산]: 정답 번호(1, 2, 3, 4)가 특정 번호에 편중되지 않도록 ${count}문항 전체에 걸쳐 1, 2, 3, 4번에 균등하게 분산되도록 배치하십시오.
8. [실제 본문 출제근거 제시]: 각 문제마다 [출제 근거자료] 본문에서 해당 문제의 근거가 된 실제 문장 또는 규정 단락을 source에 구체적으로 명시하십시오.
9. [AI 품질 자가검토]: 각 문항별로 정답 단일성(singleAnswer: true), 자료 근거 일치성(sourceSupported: true), 모호성 여부(ambiguity: false)를 철저히 검증하십시오.

### [출제 근거자료]
${contextSnippet}
`;

    const response = await generateContentWithRetry({
      contents: prompt,
      primaryModel: 'gemini-3.8-flash',
      fallbackModel: 'gemini-3.1-flash-lite',
      maxRetries: 3,
      config: {
        systemInstruction: '제공된 출제 근거자료 본문에 실제로 존재하는 내용에만 100% 엄격하게 입각하여 객관적인 4지선다형 평가문항을 출제하는 전문 출제위원입니다. 자료에 없는 외부 사실이나 가상의 규정은 절대 포함하지 않습니다. 문제 발문에는 절대로 목차나 장·절, 출제범위를 표시하지 않고 순수 문제 지문만 출제하며, 보기 작성 시 1.., 1), 가. 등의 말머리 기호를 붙이지 않습니다.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  number: { type: Type.INTEGER, description: '문제 번호 (1부터 시작)' },
                  question: { type: Type.STRING, description: '순수 문제 발문. 주의: 목차, 단원명, 장·절(예: 제1장, 제2절 등)이나 출제범위 표기를 발문에 절대 포함하지 말고 순수 시험 질문 지문만 작성 (예: "다음 중 통상우편물 규격요건에 대한 설명으로 가장 옳은 것은?")' },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '보기 4개 (순서대로 ①, ②, ③, ④에 해당). 주의: 원본 문서의 말머리 기호(1.., 1), 1., 가., (1), • 등)를 절대 포함하지 말고 순수 문장만 작성'
                  },
                  answer: { type: Type.INTEGER, description: '정답 번호 (1, 2, 3, 4 중 하나)' },
                  explanation: { type: Type.STRING, description: '상세 해설 (정답인 이유와 오답인 보기들의 틀린 이유 설명)' },
                  difficulty: { type: Type.STRING, description: '난이도 ("쉬움", "보통", "어려움" 중 하나)' },
                  category: { type: Type.STRING, description: '출제 단원 또는 세부 영역명' },
                  source: { type: Type.STRING, description: '출제 근거 (문서 내 단원 또는 규정 위치 구체적 명시)' },
                  quality_check: {
                    type: Type.OBJECT,
                    properties: {
                      single_answer: { type: Type.BOOLEAN },
                      source_supported: { type: Type.BOOLEAN },
                      ambiguity: { type: Type.BOOLEAN },
                      alert_message: { type: Type.STRING }
                    },
                    required: ['single_answer', 'source_supported', 'ambiguity']
                  }
                },
                required: ['number', 'question', 'options', 'answer', 'explanation', 'difficulty', 'category', 'source', 'quality_check']
              }
            }
          },
          required: ['questions']
        }
      }
    });

    const responseText = response.text || '{}';
    const parsed = JSON.parse(responseText);
    const rawQuestions = parsed.questions || [];

    // Format & balance answer distributions
    const formattedQuestions: PostalQuestion[] = balanceAndFormatQuestions(rawQuestions, config.subject);

    return res.json({
      success: true,
      questions: formattedQuestions,
    });
  } catch (error: any) {
    console.error('Error generating questions:', error);
    const rawMsg = error?.message || String(error);
    const is503 = rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE');

    const userFriendlyMessage = is503
      ? '구글 AI 모델 서버에 일시적 사용량 급증(503 High Demand)이 발생했습니다. 모델 전환 및 자동 재시도를 거쳤으나 응답이 지연되었습니다. 잠시 후 [다시 시도] 버튼을 누르면 정상 처리됩니다.'
      : (rawMsg || '문제 생성 도중 오류가 발생했습니다. 출제 조건을 확인한 후 다시 시도해주세요.');

    return res.status(500).json({
      success: false,
      error: userFriendlyMessage,
      isOverloaded: is503,
      rawError: rawMsg,
    });
  }
});

// 3. Question Regeneration Endpoint
app.post('/api/regenerate-question', async (req, res) => {
  try {
    const { question, content, directives, customPrompt } = req.body as {
      question: PostalQuestion;
      content: string;
      directives: string[];
      customPrompt?: string;
    };

    if (!question || !content) {
      return res.status(400).json({
        success: false,
        error: '재생성에 필요한 문제 정보 또는 원본 자료가 누락되었습니다.',
      });
    }

    const directivesText = [
      ...(directives || []),
      customPrompt ? `출제자 추가 요청사항: ${customPrompt}` : '',
    ].filter(Boolean).join('\n- ');

    const prompt = `
당신은 대한민국 공공기관 '우편직무 평가문제 출제 전문위원'입니다.
기존 출제된 문제에 대해 출제자가 수정을 요청하였습니다.
제공된 [우편직무 출제 근거자료]의 범위 내에서 요청된 수정 방향을 반영하여 새로운 4지선다형 평가문제를 다시 생성하십시오.

### [기존 문제 정보]
- 문제번호: ${question.number}
- 기존 발문: ${question.question}
- 기존 보기:
  1) ${question.options[0]}
  2) ${question.options[1]}
  3) ${question.options[2]}
  4) ${question.options[3]}
- 기존 정답: ${question.answer}번
- 기존 해설: ${question.explanation}
- 기존 난이도: ${question.difficulty}
- 기존 출제단원: ${question.category}
- 기존 출제근거: ${question.source}

### [출제자의 재생성 요청사항]
- ${directivesText || '기존보다 문제의 완성도를 높이고 보기의 변별력을 강화하여 다시 출제'}

### [엄격한 재생성 원칙]
1. 반드시 아래 [우편직무 출제 근거자료]에 기반할 것 (자료에 없는 임의 내용 금지).
2. 정답은 4개의 보기 중 오직 1개만 명확히 존재해야 함.
3. 보기 4개는 균형 잡힌 길이로 작성하며 '모두 맞다/틀리다'는 절대 금지.
4. 출제근거를 구체적으로 밝힐 것.
5. 출제자의 재생성 방향(난이도 조정, 업무상황형 전환, 사례형 변경 등)을 충실히 반영할 것.
6. [발문 표기 금지]: 문제 발문(question)에 파일의 목차, 단원명, 장·절(예: 제1장, 제2절 등) 또는 출제 범위 표기를 절대 포함하지 말고 순수 문제 지문만 작성할 것.
7. [보기 말머리 제거]: 보기 4개에는 '1..', '1)', '1.', '가.', '•' 등의 원본 말머리 기호를 절대 붙이지 말고 순수 문장만 작성할 것.

### [우편직무 출제 근거자료 발췌]
${content.slice(0, 10000)}
`;

    const response = await generateContentWithRetry({
      contents: prompt,
      primaryModel: 'gemini-3.8-flash',
      fallbackModel: 'gemini-3.1-flash-lite',
      maxRetries: 3,
      config: {
        systemInstruction: '우편직무 평가문제 전문 출제위원으로서 출제자의 재생성 요구사항을 완벽히 수용하여 고품질 문제를 재생성합니다. 문제 발문에는 절대로 목차나 장·절, 출제범위를 표기하지 않으며, 보기에는 1.., 1), 가. 등의 말머리 기호를 붙이지 않습니다.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING, description: '순수 문제 발문 (목차, 장·절, 출제범위 표기 절대 금지)' },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '보기 4개 (말머리 기호 제외한 순수 문장)'
            },
            answer: { type: Type.INTEGER },
            explanation: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            category: { type: Type.STRING },
            source: { type: Type.STRING },
            quality_check: {
              type: Type.OBJECT,
              properties: {
                single_answer: { type: Type.BOOLEAN },
                source_supported: { type: Type.BOOLEAN },
                ambiguity: { type: Type.BOOLEAN },
                alert_message: { type: Type.STRING }
              },
              required: ['single_answer', 'source_supported', 'ambiguity']
            }
          },
          required: ['question', 'options', 'answer', 'explanation', 'difficulty', 'category', 'source', 'quality_check']
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    const qc = parsed.quality_check || {};
    const alerts: string[] = [];
    if (!qc.source_supported) alerts.push('출제근거를 다시 확인하세요.');
    if (!qc.single_answer) alerts.push('복수 정답 가능성이 있습니다.');
    if (qc.ambiguity) alerts.push('정답 또는 보기가 모호할 가능성이 있습니다.');
    if (qc.alert_message) alerts.push(qc.alert_message);

    const safeOptions: [string, string, string, string] = [
      sanitizeOptionText(parsed.options?.[0] || '보기 1'),
      sanitizeOptionText(parsed.options?.[1] || '보기 2'),
      sanitizeOptionText(parsed.options?.[2] || '보기 3'),
      sanitizeOptionText(parsed.options?.[3] || '보기 4'),
    ];

    const regenerated: PostalQuestion = {
      id: question.id,
      number: question.number,
      question: sanitizeQuestionStem(parsed.question || question.question),
      options: safeOptions,
      answer: (parsed.answer >= 1 && parsed.answer <= 4 ? parsed.answer : 1) as 1 | 2 | 3 | 4,
      explanation: parsed.explanation || question.explanation,
      difficulty: (['쉬움', '보통', '어려움'].includes(parsed.difficulty) ? parsed.difficulty : question.difficulty) as any,
      category: parsed.category || question.category,
      source: parsed.source || question.source,
      status: '검토중',
      qualityCheck: {
        singleAnswer: qc.single_answer !== false,
        sourceSupported: qc.source_supported !== false,
        ambiguity: qc.ambiguity === true,
        alerts: alerts.length > 0 ? alerts : undefined,
      },
      createdAt: question.createdAt,
      updatedAt: new Date().toISOString(),
    };

    return res.json({ success: true, question: regenerated });
  } catch (error: any) {
    console.error('Error regenerating question:', error);
    const rawMsg = error?.message || String(error);
    const is503 = rawMsg.includes('503') || rawMsg.includes('high demand') || rawMsg.includes('UNAVAILABLE');

    return res.status(500).json({
      success: false,
      error: is503
        ? '구글 AI 모델의 일시적 사용량 급증(503)으로 응답이 지연되었습니다. 잠시 후 [재생성]을 다시 눌러주세요.'
        : (rawMsg || '문제 재생성 중 오류가 발생했습니다.'),
      isOverloaded: is503,
    });
  }
});

// Helper: Ensure 4 options, balanced answer distribution, and valid fields
function balanceAndFormatQuestions(rawQuestions: any[], subject: string): PostalQuestion[] {
  const result: PostalQuestion[] = [];

  for (let i = 0; i < rawQuestions.length; i++) {
    const raw = rawQuestions[i];
    const opts = Array.isArray(raw.options) ? raw.options : [];
    while (opts.length < 4) opts.push(`추가 보기 ${opts.length + 1}`);
    const safeOptions: [string, string, string, string] = [
      sanitizeOptionText(String(opts[0] || '')),
      sanitizeOptionText(String(opts[1] || '')),
      sanitizeOptionText(String(opts[2] || '')),
      sanitizeOptionText(String(opts[3] || '')),
    ];

    let ans = parseInt(raw.answer, 10);
    if (isNaN(ans) || ans < 1 || ans > 4) ans = 1;

    let diff = raw.difficulty;
    if (!['쉬움', '보통', '어려움'].includes(diff)) {
      diff = '보통';
    }

    const qc = raw.quality_check || {};
    const alerts: string[] = [];
    if (qc.source_supported === false) alerts.push('출제근거를 다시 확인하세요.');
    if (qc.single_answer === false) alerts.push('정답이 모호할 가능성이 있습니다.');
    if (qc.ambiguity === true) alerts.push('보기의 내용이 서로 유사하거나 모호할 수 있습니다.');
    if (qc.alert_message) alerts.push(qc.alert_message);

    const questionItem: PostalQuestion = {
      id: `q-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
      number: i + 1,
      question: sanitizeQuestionStem(raw.question || `${i + 1}번 평가문제`),
      options: safeOptions,
      answer: ans as 1 | 2 | 3 | 4,
      explanation: raw.explanation || '해설 정보가 제공되지 않았습니다.',
      difficulty: diff,
      category: raw.category || subject || '우편직무 일반',
      source: raw.source || '출제근거 확인 필요',
      status: qc.source_supported === false ? '근거확인필요' : '검토중',
      qualityCheck: {
        singleAnswer: qc.single_answer !== false,
        sourceSupported: qc.source_supported !== false,
        ambiguity: qc.ambiguity === true,
        alerts: alerts.length > 0 ? alerts : undefined,
      },
      createdAt: new Date().toISOString(),
    };

    result.push(questionItem);
  }

  // Answer position distribution balancing pass
  const maxAllowedPerOption = Math.ceil(result.length / 4) + 1;
  const currentCounts = [0, 0, 0, 0];

  for (const q of result) {
    const curIdx = q.answer - 1;
    if (currentCounts[curIdx] >= maxAllowedPerOption) {
      const leastCountIdx = currentCounts.indexOf(Math.min(...currentCounts));
      if (leastCountIdx !== curIdx) {
        const temp = q.options[curIdx];
        q.options[curIdx] = q.options[leastCountIdx];
        q.options[leastCountIdx] = temp;
        q.answer = (leastCountIdx + 1) as 1 | 2 | 3 | 4;
      }
    }
    currentCounts[q.answer - 1]++;
  }

  return result;
}

// Development or Production Serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
