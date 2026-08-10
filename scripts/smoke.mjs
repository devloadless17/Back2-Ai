/**
 * End-to-end smoke test.
 *
 * Drives the running server over HTTP with a real cookie jar and asserts on
 * rendered output, not on status codes alone. A 200 that turns out to be the
 * login page is exactly the kind of false pass this exists to catch.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

/**
 * Copy the smoke test asserts on, per locale.
 *
 * The interface language follows each user's locked `preferred_language`, so
 * hardcoding one language turns this suite into a test of the seed data rather
 * than of the app: change a student's language for a legitimate reason and a
 * green suite goes red for no defect. Expectations are resolved from the `lang`
 * attribute the server actually rendered.
 *
 * Keep in sync with src/lib/i18n/dictionaries/.
 */
const COPY = {
  fr: {
    signIn: 'Se connecter',
    greeting: 'Bon retour',
    caughtUp: 'Rien',
    keepPractising: 'Continuez',
    weakestChapter: 'À travailler en priorité',
  },
  en: {
    signIn: 'Sign in',
    greeting: 'Welcome back',
    caughtUp: 'Nothing due today',
    keepPractising: 'Keep practising',
    weakestChapter: 'Needs the most work',
  },
  ar: {
    signIn: 'دخول',
    greeting: 'أهلاً بعودتك',
    caughtUp: 'لا شيء مستحق اليوم',
    keepPractising: 'واصل التمرّن',
    weakestChapter: 'الأحوج إلى العمل',
  },
};

/** Reads the locale the server committed to for this response. */
function localeOf(html) {
  return html.match(/<html[^>]*\blang="(\w+)"/)?.[1] ?? 'fr';
}

function copyFor(html) {
  return COPY[localeOf(html)] ?? COPY.fr;
}

const jar = new Map();
let passed = 0;
let failed = 0;

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, BASE), {
    redirect: 'manual',
    ...options,
    headers: {
      cookie: cookieHeader(),
      origin: BASE,
      ...(options.headers ?? {}),
    },
  });
  absorbCookies(response);
  const body = await response.text();
  return { status: response.status, location: response.headers.get('location'), body, response };
}

/**
 * Visible text only — strips scripts and the serialized RSC payload.
 *
 * Scoped to the whole document rather than to `<main>`. Pages with a
 * `loading.tsx` stream: the first flush puts a skeleton inside `<main>` and the
 * real content arrives afterwards in out-of-order `<div hidden id="S:n">`
 * blocks. Reading only the first `<main>` would assert against the skeleton and
 * report a working page as broken.
 *
 * `<script>` is still stripped, so the RSC flight payload cannot produce a
 * false pass — the text has to have been rendered as HTML.
 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const STUDENT = { email: 'student@bac2.local', password: 'ChangeMeImmediately!2026' };
const ADMIN = { email: 'admin@bac2.local', password: 'ChangeMeImmediately!2026' };

async function login(credentials) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
}

async function main() {
  console.log(`Smoke test against ${BASE}`);

  section('Anonymous access');
  {
    const root = await request('/');
    check('GET / redirects', root.status === 307 || root.status === 308, `status ${root.status}`);
    check('  …to /login', root.location === '/login', `location ${root.location}`);

    const dash = await request('/dashboard');
    check('GET /dashboard redirects when signed out', dash.status === 307, `status ${dash.status}`);
    check('  …to /login', dash.location === '/login', `location ${dash.location}`);

    const loginPage = await request('/login');
    check('GET /login renders', loginPage.status === 200, `status ${loginPage.status}`);
    check(
      '  …shows the sign-in form',
      visibleText(loginPage.body).includes(copyFor(loginPage.body).signIn),
      `locale ${localeOf(loginPage.body)} — ${visibleText(loginPage.body).slice(0, 120)}`,
    );
    check(
      '  …with email and password inputs',
      /name="email"/.test(loginPage.body) && /name="password"/.test(loginPage.body),
    );

    const signupPage = await request('/signup');
    check('GET /signup renders', signupPage.status === 200, `status ${signupPage.status}`);
    const signupText = visibleText(signupPage.body);
    check('  …lists the four tracks', ['SG', 'SV', 'VSE', 'LH'].every((c) => signupText.includes(c)));
    check(
      '  …offers a country, with only the ingested one selectable',
      /name="country"/.test(signupPage.body) &&
        /<option value="LB"(?![^>]*disabled)/.test(signupPage.body) &&
        /<option value="FR"[^>]*disabled/.test(signupPage.body),
    );

    // The signup API must refuse a country whose curriculum does not exist,
    // whatever the form allowed the browser to submit. A real track id is used
    // so that the refusal is the country's and not the track's.
    const trackId = signupPage.body.match(
      /<option value="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/,
    )?.[1];

    const foreign = await fetch(new URL('/api/auth/signup', BASE), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({
        email: `smoke-country-${Date.now()}@example.com`,
        password: 'smoke-test-password',
        displayName: 'Smoke',
        trackId,
        preferredLanguage: 'fr',
        country: 'FR',
      }),
    });
    const foreignBody = await foreign.text();
    check(
      'Signup refuses a country with no curriculum',
      // 429 means this smoke run tripped the signup rate limiter, which is
      // itself correct behaviour — what must never happen is a 201.
      foreignBody.includes('COUNTRY_UNAVAILABLE') || foreign.status === 429,
      `status ${foreign.status} ${foreignBody}`,
    );
  }

  section('Credential handling');
  {
    const wrong = await login({ email: STUDENT.email, password: 'definitely-not-it' });
    check('Wrong password is rejected', wrong.status === 401, `status ${wrong.status}`);
    check('  …with an opaque error code', wrong.body.includes('INVALID_CREDENTIALS'), wrong.body);

    const unknown = await login({ email: 'nobody@example.com', password: 'whatever12345' });
    check('Unknown email returns the SAME code', unknown.body.includes('INVALID_CREDENTIALS'), unknown.body);

    const crossSite = await fetch(new URL('/api/auth/login', BASE), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify(STUDENT),
    });
    check('Cross-site POST is blocked', crossSite.status === 403, `status ${crossSite.status}`);
  }

  section('Student session');
  {
    const good = await login(STUDENT);
    check('Correct password succeeds', good.status === 200, `status ${good.status}`);
    check('Session cookie is set', jar.has('bac2_session'));
    check(
      'Session cookie is httpOnly',
      (good.response.headers.getSetCookie?.() ?? []).some((c) => /httponly/i.test(c)),
    );

    const dash = await request('/dashboard');
    check('GET /dashboard now renders', dash.status === 200, `status ${dash.status}`);

    const text = visibleText(dash.body);
    const copy = copyFor(dash.body);
    const locale = localeOf(dash.body);

    check('  …greets the signed-in student', text.includes(copy.greeting), text.slice(0, 160));
    // Subject and announcement titles are seeded data, identical in every locale.
    check('  …lists the track subjects', text.includes('Math') && text.includes('Physique'), text.slice(0, 300));
    check('  …shows the Bac countdown', text.includes('Baccalaur'), text.slice(0, 300));
    check('  …shows the announcement', text.includes('Bienvenue'));
    /*
     * The weakest-chapter card has two valid states and which one shows is a
     * property of the data, not of the code: below MIN_ATTEMPTS_FOR_WEAKNESS it
     * shows the gate, above it names the chapter. Asserting on one of them made
     * this suite go red the moment enough attempts existed — a test of the seed
     * rather than of the app. Assert that the section renders in *a* valid
     * state instead.
     */
    check(
      '  …renders the weakest-chapter card in a valid state',
      text.includes(copy.keepPractising) || text.includes(copy.weakestChapter),
      text.slice(0, 300),
    );

    check(
      '  …renders a supported locale',
      ['fr', 'en', 'ar'].includes(locale),
      `lang="${locale}"`,
    );
    check(
      '  …with the matching text direction',
      dash.body.includes(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`),
      `locale ${locale}`,
    );
  }

  section('Feature surfaces');
  {
    // Every destination the sidebar offers. A 200 here is a low bar, but it is
    // the bar that catches a page crashing on empty data — which is the state
    // every one of these is in on a fresh install.
    const pages = [
      '/practice',
      '/old-cycles',
      '/flashcards',
      '/flashcards/review',
      // Weak-spot scope on a fresh account: the interesting case, because it has
      // no weak chapters to draw from and must say so rather than crash.
      '/flashcards/review?scope=weak',
      '/chat',
      '/upload',
      '/exam-sim',
      '/exam-sim/new',
      '/performance',
      '/schedule',
      '/todos',
      '/notifications',
      '/settings/profile',
      '/settings/references',
      '/settings/grades',
      '/settings/billing',
    ];

    for (const path of pages) {
      const page = await request(path);
      check(`GET ${path}`, page.status === 200, `status ${page.status}`);
    }
  }

  section('Privilege separation');
  {
    const adminPage = await request('/admin/review-queue');
    check(
      'Student cannot reach /admin (redirect or 404)',
      adminPage.status === 307 || adminPage.status === 404,
      `status ${adminPage.status}`,
    );

    const adminApi = await request('/api/admin/review-queue');
    check('Student cannot read the admin API', adminApi.status === 403, `status ${adminApi.status}`);

    const userApi = await request('/api/admin/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', role: 'admin', reason: 'smoke' }),
    });
    check('Student cannot grant themselves admin', userApi.status === 403, `status ${userApi.status}`);
  }

  section('Sign out');
  {
    const out = await request('/api/auth/logout', { method: 'POST' });
    check('POST /api/auth/logout redirects', out.status === 303, `status ${out.status}`);

    const dash = await request('/dashboard');
    check('Session no longer works', dash.status === 307, `status ${dash.status}`);
  }

  section('Admin session');
  {
    jar.clear();
    const good = await login(ADMIN);
    check('Admin can sign in', good.status === 200, `status ${good.status}`);

    const dash = await request('/dashboard');
    check('Admin reaches the dashboard', dash.status === 200, `status ${dash.status}`);

    for (const path of ['/admin/review-queue', '/admin/announcements', '/admin/ingestion', '/admin/users', '/admin/audit']) {
      const page = await request(path);
      check(`GET ${path}`, page.status === 200, `status ${page.status}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
