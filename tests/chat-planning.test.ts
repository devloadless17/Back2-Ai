import { describe, expect, it } from 'vitest';

import { classifyChatIntent } from '@/lib/chat-intent';

/**
 * The personal-assistant lane, and the questions it must not steal.
 *
 * A planning marker that fires on a real subject question is the expensive
 * error here: the planning turn retrieves no course material and is forbidden
 * from teaching, so a physics question routed into it comes back as a polite
 * deflection instead of an answer. The reverse error is cheap — a scheduling
 * question that reaches the curriculum path is answered from general knowledge
 * under a label, which is wrong but not damaging.
 *
 * So the second block below matters more than the first, and the entries in it
 * are the actual collisions found while writing the marker table rather than
 * invented ones.
 */

const intent = (q: string) => classifyChatIntent(q).intent;

describe('planning intent', () => {
  it('takes questions about the student’s own revision', () => {
    for (const q of [
      'what should I study today',
      'am I behind?',
      'how many days until the exam',
      'am I ready for the bac',
      'what should I do next',
      'can you help me plan my week',
      'que dois-je réviser ce soir ?',
      'par où commencer ?',
      'combien de jours avant l’examen',
      'ماذا أدرس اليوم',
      'هل انا جاهز',
    ]) {
      expect(intent(q), q).toBe('planning');
    }
  });

  it('leaves real subject questions on the curriculum path', () => {
    for (const q of [
      // `plan` in French is the outline of an essay, not a timetable. This is
      // the collision that decided the whole marker table.
      'quel est le plan du texte ?',
      'donne-moi le plan de cette dissertation',
      // `revision` as a historical event, not as studying.
      'what was the revision of the constitution in 1926',
      // `how many days` as an astronomy question.
      'how many days does Mercury take to orbit the Sun',
      // Plain subject questions that mention time or readiness in passing.
      'how long does mitosis take',
      'what is the period of a pendulum',
      'explain the plan of the Marshall Plan',
    ]) {
      expect(intent(q), q).toBe('curriculum');
    }
  });

  it('prefers planning over capability when a message is both', () => {
    // "can you help me with" is a capability phrasing and would match first if
    // the tables were checked in the other order; answering this by listing the
    // student's subjects is not an answer to it.
    expect(intent('can you help me with my schedule')).toBe('planning');
    // And the ordering costs nothing the other way.
    expect(intent('can you help me with maths')).toBe('capability');
  });

  it('still lets a bare greeting be a greeting', () => {
    expect(intent('hello')).toBe('smalltalk');
    expect(intent('merci')).toBe('smalltalk');
  });
});

describe('the length ceiling', () => {
  it('sends a pasted exam question to the curriculum path despite a stray phrase', () => {
    // Real shape of the failure: ten English papers in the corpus contain
    // "what is this" somewhere in their body, and were being answered with a
    // description of the tutor rather than with help.
    const pasted =
      'Advantages and disadvantages of radioactivity. Read carefully the following text then ' +
      'answer the questions. Radioactivity is used in medicine to destroy cancerous cells, and ' +
      'in industry to detect flaws in metal. But what is this radiation doing to healthy tissue ' +
      'around it? Given the half-life of the isotope is 5.27 years, calculate the activity ' +
      'remaining after twenty years, and justify each step of your reasoning carefully.';
    expect(classifyChatIntent(pasted).intent).toBe('curriculum');
    expect(classifyChatIntent(pasted).signal).toBe('default:too-long');
  });

  it('still lets a short capability question through', () => {
    expect(classifyChatIntent('what is this?').intent).toBe('capability');
  });
})
