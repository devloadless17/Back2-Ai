import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const retrieval = readFileSync(join(process.cwd(), 'src', 'lib', 'retrieval.ts'), 'utf8');
const photoQa = readFileSync(join(process.cwd(), 'src', 'lib', 'photo-qa.ts'), 'utf8');

describe('humanities document routing', () => {
  it('checks uploaded documents before refusing a comprehension question', () => {
    const comprehension = retrieval.indexOf("if (kind === 'comprehension')");
    const documentSearch = retrieval.indexOf(
      'searchUserReferences(queryVector, input.userId, 4)',
      comprehension,
    );
    const refusal = retrieval.indexOf("tier: 'ungrounded_refused'", documentSearch);

    expect(comprehension).toBeGreaterThan(-1);
    expect(documentSearch).toBeGreaterThan(comprehension);
    expect(refusal).toBeGreaterThan(documentSearch);
  });

  it('allows an attached photographed document through and gives the original image to the solver', () => {
    expect(retrieval).toContain('if (input.hasAttachedImage)');
    expect(photoQa).toContain('hasAttachedImage: true');
    expect(photoQa).toContain('images: [input.image]');
  });

  it('lets verified official corrections rescue civics concepts from a false refusal', () => {
    expect(retrieval).toContain('let admittedQuestions: QuestionHit[] = []');
    expect(retrieval).toContain('question.officialSolution');
    expect(retrieval).toContain('...admittedQuestionSources');
  });
});
