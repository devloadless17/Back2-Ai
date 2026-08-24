/*
 * The intent gate decides whether a message is allowed to be told it is
 * off-syllabus. Both directions cost something real:
 *
 *   a question misread as smalltalk  -> answered with no material behind it
 *   a greeting misread as a question -> "Not covered by the curriculum", to
 *                                       somebody who said hello
 *
 * The first is the worse failure, so the curriculum default is the safe one and
 * these tests weight accordingly: every real question below must reach it,
 * including the ones that open with a greeting or name a subject.
 */

import { describe, expect, it } from 'vitest';

import { classifyChatIntent } from '@/lib/chat-intent';

describe('classifyChatIntent', () => {
  it.each([
    ['hello', 'the message from the bug report'],
    ['Hi', 'capitalised'],
    ['  hey  ', 'padded'],
    ['thanks!', 'punctuation'],
    ['merci beaucoup', 'French'],
    ['bonjour', 'French greeting'],
    ['شكرا', 'Arabic thanks'],
    ['السلام عليكم', 'Arabic greeting'],
    ['ok', 'acknowledgement'],
    ['', 'empty message'],
  ])('treats %j as smalltalk (%s)', (text) => {
    expect(classifyChatIntent(text).intent).toBe('smalltalk');
  });

  it.each([
    ['what can you do?', 'English'],
    ['who are you', 'identity'],
    ['can you help me with maths', 'names a subject but asks nothing about it'],
    ['tu peux m\'aider ?', 'French'],
    ['comment ça marche', 'French'],
    ['من انت', 'Arabic'],
  ])('treats %j as a capability question (%s)', (text) => {
    expect(classifyChatIntent(text).intent).toBe('capability');
  });

  it.each([
    ['What is the photoelectric effect?', 'a plain concept question'],
    ['hello, what is the photoelectric effect?', 'a question that opens with a greeting'],
    ['hi can you explain oxidation', 'greeting glued to a question'],
    ['Explain the notion of الوعي', 'mixed script'],
    ['Qu\'est-ce que la fonction exponentielle ?', 'French concept question'],
    ['ما هي البطالة؟', 'Arabic concept question'],
    ['no idea how to solve this integral', 'opens with a courtesy word'],
    ['yes but why does the pH change', 'opens with a courtesy word'],
    ['okay so explain kinetic factors', 'opens with a courtesy word'],
    ['thanks, now explain the second question', 'courtesy then a question'],
  ])('treats %j as a curriculum question (%s)', (text) => {
    expect(classifyChatIntent(text).intent).toBe('curriculum');
  });

  it('carries the signal that decided it', () => {
    expect(classifyChatIntent('hello').signal).toContain('courtesy');
    expect(classifyChatIntent('who are you').signal).toContain('capability');
    expect(classifyChatIntent('what is entropy').signal).toBe('default');
  });
});
