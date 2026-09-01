# Motion and interactivity — audit

Read against the code on 24 August 2026, alongside what comparable products do.
Ranked by what a student actually feels, not by what is fashionable.

---

## The headline: the motion layer is written and unused

`src/components/ui/motion.tsx` exports `Reveal` and `CountUp`, with a carefully
argued three-rule doctrine at the top of the file — motion never carries
information alone, nothing is invisible until it animates, the OS setting wins.

**Nothing imports either one.** A repo-wide search for
`from '@/components/ui/motion'` returns zero results.

So the README's claim that *"Everything animates except the paper being sat"* is
not true today. What actually ships is five CSS classes:

| Class | Uses |
|---|---|
| `animate-fade-in` | 8 |
| `animate-fade-up` | 7 |
| `animate-spin` | 1 |
| `animate-slide-in` | 1 |
| `animate-rise` | 1 |

The gap is not that the product is under-animated in the abstract. It is that a
deliberate system was built, documented, and then never wired in.

---

## What the comparable products actually do

Worth separating two things that get conflated, because one of them this product
has already ruled out on purpose.

**Gamification** — streaks, XP, leagues, badges. Duolingo layers loss-aversion
(the streak), social pressure (leagues) and accomplishment (XP) and is explicit
that these are motivational scaffolding around the learning rather than part of
it ([breakdown](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f),
[case study](https://www.uladshauchenka.com/p/duolingo-case-study-the-gamification)).
Khan Academy added streaks and levels
([announcement](https://support.khanacademy.org/hc/en-us/community/posts/28945393485581-Update-Introducing-Streaks-and-Levels)).

**This product removed exactly that, on purpose**, in commit `9d31e7c`:

> The levels, XP, badges and balloons read as a children's app. For a national
> exam that parents pay for and schools recommend, that register costs
> credibility with the person deciding to buy — and a point score this product
> invented means nothing to anyone reading it.

That decision should stand. The buyer is a Lebanese parent or a school, the unit
of currency is a mark out of 20, and a product that awards its own invented
points alongside a national examination looks less serious, not more. **Do not
re-import the Duolingo playbook wholesale.**

One piece of it survives the test, and only one: Duolingo's streak design pairs
the commitment device with **forgiveness** — freezes and repairs, so a bad day
does not erase months. The streak banner already built here (`subject-rings.tsx`)
counts yesterday as still alive for exactly that reason. That is the right amount
of this idea.

**Micro-interaction practice** is the other half, and it is not gamification —
it is feedback. The current consensus is unusually consistent: purposeful only,
**200–500ms**, under 400ms for anything in a flow, first feedback within 100ms,
and the direction of travel is away from flourish toward function
([1](https://primotech.com/ui-ux-evolution-2026-why-micro-interactions-and-motion-matter-more-than-ever/),
[2](https://fluid22.com/insights/micro-interactions-that-matter-for-ux-wins-in-2026),
[3](https://createbytes.com/insights/microinteractions-ui-best-practices)).
Skeletons beat spinners on perceived speed by roughly 30% for content-shaped
screens, while spinners stay correct for short atomic actions
([comparison](https://www.onething.design/post/skeleton-screens-vs-loading-spinners),
[why](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)).
Optimistic UI removes the wait entirely where the write almost always succeeds
([patterns](https://simonhearne.com/2021/optimistic-ui-patterns/)).

That half is worth taking in full. It costs nothing in register.

---

## Findings, ranked

### 1. No press feedback — `active:` appears twice in the entire app

`active:` is used **2 times** across `src/`, against 90 uses of `hover:`.

Most of these students are on a phone, where `hover:` does not exist. A tap on a
button, a chapter row or a flashcard currently produces nothing until the
navigation completes — and on a slow Beirut connection that is long enough for a
student to tap again, thinking they missed.

**Smallest fix.** One line in `button.tsx`, and the same on the tappable rows:
`active:scale-[0.98] active:brightness-95`, `transition-transform duration-150`.
Under 150ms, no layout shift, and `motion-reduce:transform-none` already
respected via the global rule.

This is the highest-value change in this document and the cheapest.

### 2. `Reveal` and `CountUp` are dead code

Written, documented, unused. Two options and both are defensible — pick one:

- **Wire them in.** `CountUp` belongs on the dashboard stat tiles (predicted
  mark, programme covered, days left) and the results total. A mark counting up
  to 14.5 reads as an achievement rather than a fact; it is also precisely the
  case the file's own rule 1 covers, since the final value is plain text.
  `Reveal` belongs on the dashboard's lower sections and the subject rings.
- **Delete them.** If the register argument extends to entrance animation, say so
  and remove the file. Dead code with a doctrine attached is worse than either.

My recommendation: wire `CountUp` into the four stat tiles and the results
total; wire `Reveal` into the ring grid only. Leave everything else static.

### 3. Ten routes have no loading state

Four routes have a `loading.tsx`; **fourteen do not**, including `/chat`,
`/flashcards`, `/flashcards/review`, `/exam-sim` and `/old-cycles`.

These are server components doing real database work. Without `loading.tsx` the
student gets a dead page during navigation — the exact case skeletons beat
spinners on, and the `PageSkeleton` primitive to build them with already exists
and is already used by the four routes that have one.

**Smallest fix.** Copy the existing `loading.tsx` pattern to the ten
student-facing routes. Admin can wait.

### 4. The ring animation never plays

`SubjectRings` sets `strokeDashoffset` to its final value on the server. The
mockup animated it from empty, which is the one place in this design where motion
genuinely carries meaning — a ring filling to 55% *shows* partial mastery in a
way a static arc does not.

**Smallest fix.** A CSS transition on `stroke-dashoffset` plus a mount effect
setting the real offset, guarded by `useReducedMotion`. About fifteen lines, and
it is the single most visible improvement available.

### 5. Optimistic UI is used in two places and belongs in four

`today-tasks.tsx` and `todo-list.tsx` update optimistically. Two more qualify:

- **Flashcard self-grading.** The card should leave the screen on the tap, not
  after the round trip. It is a forty-card session; forty waits is the session.
- **Practice MCQ answers.** Marked by string comparison server-side, so the
  answer is known instantly and correct with near-certainty.

Not the exam runner's save indicator — that one must tell the truth about
whether the server has the answer, and it now does.

### 6. What must stay exactly as it is

- **`.calm` in the exam runner.** No entrances, no loops, no pulsing save dot. A
  bar animating beside a running clock is pressure, not polish.
- **`prefers-reduced-motion` wins**, globally and in JS.
- **Status never by colour alone.** Any new motion must not become a second
  channel that carries meaning by itself.
- **No invented point score.** See `9d31e7c`.

---

## Suggested order

1. **#1 press feedback** — one line, biggest felt difference, phones first.
2. **#4 ring animation** — most visible, ~15 lines.
3. **#3 loading states** — ten copies of an existing file.
4. **#5 optimistic flashcards** — removes the wait from the highest-repetition
   screen in the product.
5. **#2 wire or delete the motion primitives** — a decision more than a task.

Nothing here needs a library. Framer Motion would add ~30KB to solve problems
that CSS transitions and the two existing primitives already cover.
