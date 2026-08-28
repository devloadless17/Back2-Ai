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

  it('leaves a self-contained question alone', () => {
    // A question describing its own curve is not asking anyone to look anywhere.
    expect(missingVisual('Calculate the limit of f(x) as x tends to infinity.')).toBeNull();
    expect(missingVisual('The curve of f is increasing on this interval.')).toBeNull();
    expect(missingVisual('Prove that the sequence converges.')).toBeNull();
  });
});
