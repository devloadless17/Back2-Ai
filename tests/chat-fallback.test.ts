import { describe, expect, it } from 'vitest';

import { ungroundedLane } from '@/lib/chat';
import { classifyChatIntent } from '@/lib/chat-intent';
import { classifyQuestionKind } from '@/lib/question-kind';

/**
 * Where a message ends up when retrieval finds nothing.
 *
 * This is the product's central trade, so it is worth stating plainly. The rule
 * used to be "no material, no answer". That was honest but it was also wrong in
 * practice, because the corpus covers a fraction of the syllabus, so the
 * commonest outcome was refusing a candidate a definition the model knew
 * perfectly well. The rule is now "no material, answer anyway, and say so".
 *
 * What must not drift, and what these tests pin:
 *
 *  1. A comprehension question never falls back. There is no general-knowledge
 *     answer to a question about a passage nobody handed over, so labelling one
 *     would not make it less invented.
 *  2. Ordinary subject questions do fall back. If this starts routing them to
 *     `needs_passage`, students get asked for a text they never mentioned.
 *  3. Greetings never reach this decision at all — they are answered before
 *     retrieval, and a fallback lane must not become a second way for "hello"
 *     to be treated as a syllabus query.
 */

const lane = (question: string) => ungroundedLane(classifyQuestionKind(question).kind);

describe('ungroundedLane', () => {
  it('sends a concept question to the model rather than refusing it', () => {
    expect(lane('what is the difference between mitosis and meiosis')).toBe('general_knowledge');
    expect(lane('explique la loi de Faraday')).toBe('general_knowledge');
    expect(lane('كيف نحسب مشتقة دالة مركبة')).toBe('general_knowledge');
  });

  it('sends an essay question to the model too', () => {
    // Essays are the case where the corpus is thinnest and a refusal costs most:
    // a candidate asking how to structure a dissertation is asking about method,
    // and method does not depend on which extract is in front of them.
    expect(lane('comment structurer une dissertation de philosophie')).toBe('general_knowledge');
  });

  it('still asks for the passage on a comprehension question', () => {
    for (const q of [
      'what does the author mean in the second paragraph',
      'explique ce texte',
      'analyse the tone of this extract',
    ]) {
      expect(classifyQuestionKind(q).kind, q).toBe('comprehension');
      expect(lane(q), q).toBe('needs_passage');
    }
  });

  it('keeps greetings out of this decision entirely', () => {
    // The guard upstream: anything not classed 'curriculum' is answered before
    // retrieval runs, so it never reaches a lane. If this regressed, a greeting
    // could be answered as an ungrounded curriculum question — which is the
    // original bug wearing a friendlier face.
    for (const greeting of ['hello', 'bonjour', 'مرحبا', 'thanks!']) {
      expect(classifyChatIntent(greeting).intent, greeting).not.toBe('curriculum');
    }
  });

  it('routes a real question that opens with a greeting to the curriculum lane', () => {
    // The asymmetry that makes the whole arrangement safe: when in doubt it is a
    // curriculum question, so the cost of ambiguity is a greeting answered twice
    // rather than a question quietly handled as small talk.
    expect(classifyChatIntent('hi, what is an enzyme?').intent).toBe('curriculum');
  });
});
