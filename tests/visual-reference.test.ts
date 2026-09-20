import { describe, expect, it } from 'vitest';
import { missingVisual } from '@/lib/question-kind';

describe('missingVisual', () => {
  it('flags a question that sends the student to a figure', () => {
    expect(missingVisual('The results are shown in document 1.')).toBeTruthy();
    expect(missingVisual('Describe the stages represented in document 1.')).toBeTruthy();
    expect(missingVisual('Étudiez la courbe ci-contre.')).toBeTruthy();
    expect(missingVisual("D'après le document 2, indiquez la cause.")).toBeTruthy();
    expect(missingVisual('\u0645\u0646 \u062e\u0644\u0627\u0644 \u0627\u0644\u0645\u0633\u062a\u0646\u062f \u0661\u060c \u0623\u0630\u0643\u0631')).toBeTruthy();
  });

  /**
   * What the student is told is missing has to be a thing, not an adjective.
   *
   * The pattern's last alternative matched the bare word "adjacent", so a
   * physics question about an L-C resonance curve produced: This question
   * refers to "adjacent", which I do not have in front of me.
   */
  it('names the figure rather than the word that pointed at it', () => {
    expect(missingVisual('The adjacent figure represents the resonance curve.')).toBe(
      'adjacent figure',
    );
    expect(missingVisual('Refer to the adjacent graph to find the frequency.')).not.toBe(
      'adjacent',
    );
    expect(missingVisual('Étudiez la courbe ci-contre.')).toBe('courbe ci-contre');
    expect(missingVisual('Voir le schéma ci-dessous.')).toBe('schéma ci-dessous');
  });

  it('still detects a figure even when only the bare pointer is there', () => {
    // Quoting it badly is survivable. Not noticing it is not: the question
    // then gets answered as though the graph were on screen.
    expect(missingVisual('Complete the table ci-contre.')).toBeTruthy();
  });

  it('leaves a self-contained question alone', () => {
    // A question describing its own curve is not asking anyone to look anywhere.
    expect(missingVisual('Calculate the limit of f(x) as x tends to infinity.')).toBeNull();
    expect(missingVisual('The curve of f is increasing on this interval.')).toBeNull();
    expect(missingVisual('Prove that the sequence converges.')).toBeNull();
  });
});
