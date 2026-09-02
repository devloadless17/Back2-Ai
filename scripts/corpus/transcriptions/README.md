# Hand transcriptions

One file per question, named by its id. The body is what the examiner printed,
in Markdown with LaTeX, and it lands in `questions.content_latex` — which the
renderer prefers over `content_text`.

    npm run corpus:latex -- --id <uuid> --file scripts/corpus/transcriptions/<uuid>.md

They live in the repository rather than only in the database because they are
made by hand and cannot be regenerated. A database can be restored from a dump;
a transcription that existed only in a dropped column is simply gone. Keeping
them here also means the same correction can be replayed against local and
production without one drifting from the other.

Why they exist: the exam readers used so far return text and flatten
mathematics. Of 5,434 questions, five had any LaTeX, while 2,294 contain
mathematics — so a formula like

    2- Establish the following relation: C
    pH?
    = 10? where ? represents the degree of dissociation

is what a student is actually shown. The notation was destroyed at extraction
and no amount of re-rendering brings it back; it has to be read again.

`content_text` is never overwritten. It is what the reader returned, and it is
the only evidence of what that reader saw.
