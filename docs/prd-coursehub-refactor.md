# PRD: CourseHub Full-Stack Rebuild

## Problem Statement

UCSD students need a modern, fast, and intuitive tool to explore courses, compare grade distributions across professors, and plan their multi-year academic trajectory. The existing CourseHub site (coursehub.web.app) is a client-side-only SPA with no database, no server-side rendering, static CSV data baked into the bundle, dated visual design (dark navy + gold cards), and broken direct-URL routing. Students cannot save or share their course plans, and grade distribution data is raw text with no visualization.

## Solution

Rebuild CourseHub as a full-stack Next.js application with:

- A Postgres-backed course catalog populated by an automated scraper, enabling fast full-text search and structured queries.
- Interactive grade distribution visualizations (bar charts) with professor-to-professor comparison for the same course.
- A drag-and-drop course planner that persists locally and can be shared via unique URLs.
- A modern, responsive UI built with shadcn/ui and Tailwind CSS, matching current design standards.
- A mixed rendering strategy (SSG + SSR + CSR) matched to each page's data characteristics, demonstrating architectural judgment.

## User Stories

1. As a UCSD student, I want to search for courses by name or code, so that I can quickly find courses I'm interested in.
2. As a UCSD student, I want to see a course's full description, unit count, and prerequisites on a dedicated detail page, so that I can evaluate whether to take it.
3. As a UCSD student, I want to browse all courses within a specific department, so that I can discover courses I didn't know existed.
4. As a UCSD student, I want to see a bar chart of grade distributions for a course, so that I can assess its difficulty at a glance.
5. As a UCSD student, I want to compare grade distributions for the same course taught by different professors, so that I can make an informed professor choice.
6. As a UCSD student, I want to see the class GPA and total enrollment alongside the grade chart, so that I have context for the distribution.
7. As a UCSD student, I want to compare two or more courses side-by-side, so that I can decide between elective options.
8. As a UCSD student, I want to drag course cards from a search panel into quarter slots on a 4-year planner, so that I can visually plan my academic path.
9. As a UCSD student, I want to switch between Interactive (drag-and-drop) and Classic (table) planner modes, so that I can use whichever input method I prefer.
10. As a UCSD student, I want my planner state to be saved automatically in my browser, so that I don't lose my work when I close the tab.
11. As a UCSD student, I want to generate a shareable link for my plan, so that I can send it to my advisor or roommate for feedback.
12. As a UCSD student viewing a shared plan link, I want to see the plan in read-only mode with course names and quarter assignments, so that I can review someone else's plan.
13. As a UCSD student, I want to export my plan as a PDF, so that I can print it or attach it to an advising appointment.
14. As a UCSD student, I want to see a search-as-you-type experience with instant results, so that searching feels responsive.
15. As a UCSD student, I want the site to work well on my phone, so that I can check course info between classes.
16. As a UCSD student, I want to see links to official UCSD resources (Course Catalog, Academic Advising, WebReg), so that I can quickly navigate to registration tools.
17. As a UCSD student, I want course pages to load instantly without a loading spinner, so that browsing the catalog feels snappy.
18. As a UCSD student, I want to filter courses by department in the search, so that I can narrow results to my major.
19. As a UCSD student, I want to see prerequisite courses as clickable links, so that I can navigate the prerequisite chain.
20. As a UCSD student, I want to remove a course from my planner by dragging it out or clicking a remove button, so that I can adjust my plan easily.

## Implementation Decisions

### Framework and rendering

- Next.js 13.4+ App Router with React 18 and TypeScript. Tech stack is constrained to August 2023 era for resume alignment (see ADR-0001).
- Mixed rendering strategy per ADR-0004:
  - **SSG** (`generateStaticParams`): course detail, department listing, department detail, home, about, resources.
  - **CSR + API Route**: search results page fetches `/api/search` on the client.
  - **CSR**: planner pages are fully client-side interactive.
  - **SSR**: shared plan pages (`/share/[id]`) fetch the plan from Postgres at request time.

### Database schema

- Vercel Postgres with Prisma ORM (see ADR-0002).
- Five tables: `departments`, `courses`, `professors`, `grade_distributions`, `shared_plans`.
- `courses` has a `search_vector` column (Postgres `tsvector`) for full-text search, maintained via a Prisma raw query or database trigger.
- `shared_plans.plan_data` is a `jsonb` column containing the serialized Plan structure.
- `shared_plans.id` is a nanoid (short, URL-safe string).

### Data pipeline

- Node.js + Cheerio scraper (see ADR-0005) at `scripts/scrape-catalog.ts`:
  - Fetches department index from catalog.ucsd.edu.
  - For each department page, parses course entries (code, title, units, description, prerequisites).
  - Writes to `departments` and `courses` tables via Prisma.
- CSV importer at `scripts/seed-grades.ts`:
  - Parses `sheet.csv` (12,346 rows of student-submitted grade data).
  - Extracts unique professors, creates `professors` records.
  - Parses the grade distribution string (e.g., "A+:102, A:22, ...") into individual count fields.
  - Writes to `professors` and `grade_distributions` tables.
- Both scripts are idempotent (upsert on natural keys).

### UI and components

- shadcn/ui component library with Tailwind CSS 3 for styling.
- Recharts for grade distribution bar charts (color-coded: green for A range, yellow for B, orange for C, red for D/F).
- dnd-kit for Interactive Planner drag-and-drop.
- html2canvas + jsPDF for PDF export.
- Responsive layout: single-column on mobile, multi-column on desktop.

### Planner state management

- Active Plan stored in `localStorage` under key `coursehub-plan`.
- Plan shape: `{ years: { [yearNum]: { fall: CourseRef[], winter: CourseRef[], spring: CourseRef[], summer: CourseRef[] } } }`.
- `CourseRef` is `{ courseId: string, code: string, title: string, units: number }` — enough to render without a database lookup.
- Share action: POST to `/api/plans` with the Plan JSON → returns `{ id: string }` → redirect to `/share/[id]`.

### API routes

- `GET /api/search?q=...&department=...` — full-text search with optional department filter. Returns `{ courses: Course[] }`.
- `POST /api/plans` — create a SharedPlan. Body: `{ planData: Plan, name?: string }`. Returns `{ id: string }`.
- `GET /api/plans/[id]` — fetch a SharedPlan by nanoid. Returns `{ plan: SharedPlan }` or 404.

### Authentication

- None. Fully anonymous (see ADR-0003). No login, no user accounts, no session cookies.

## Testing Decisions

### What makes a good test

Tests verify external behavior at defined seams — not implementation details. A good test for this project:
- Sends a real HTTP request to an API route and asserts on the response shape and status code.
- Feeds a real HTML/CSV fixture into a parser function and asserts on the structured output.
- Calls a pure serialization function and asserts on round-trip correctness.

A bad test mocks Prisma internals, asserts on CSS class names, or tests that a React component renders a specific DOM structure.

### Seam 1: API Route Handlers (primary)

- **`/api/search`**: test that a GET with `?q=CSE` returns courses matching "CSE". Test empty query, department filter, no-results case.
- **`/api/plans`**: test POST creates a SharedPlan and returns an id. Test GET with valid id returns the plan. Test GET with invalid id returns 404.
- Use a test database (Postgres, not SQLite) seeded with a small fixture dataset.

### Seam 2: Data pipeline scripts

- **Scraper parser**: given a fixture HTML file mimicking a catalog.ucsd.edu course listing page, assert that the parser extracts the correct course objects (code, title, units, description, prerequisites).
- **CSV parser**: given a fixture CSV with known rows, assert that the parser produces the correct GradeDistribution objects with correct integer counts and float GPA.
- These are pure function tests — no database, no network.

### Seam 3: Plan serialization

- **Round-trip**: serialize a Plan to JSON, deserialize it back, assert deep equality.
- **SharedPlan shape**: assert that the serialized Plan conforms to the expected jsonb structure before writing to Postgres.
- **Edge cases**: empty plan (no courses in any slot), plan with maximum courses per slot.

### Test tooling

- Vitest (fast, Vite-native, dominant in 2023 Next.js projects).
- No React Testing Library for UI components — behavior is verified via API and serialization seams, not DOM assertions.

## Out of Scope

- **User authentication and accounts**: no login, no OAuth, no cross-device sync.
- **Real-time data updates**: course catalog and grade data are static after initial ingest.
- **Course reviews or ratings**: only grade distribution data is included, not free-text reviews.
- **Scheduling / time conflict detection**: the planner assigns courses to quarters, not to specific time slots within a week.
- **Mobile native app**: responsive web only.
- **Admin panel**: no UI for managing courses or re-running the scraper. Scripts are run from the command line.
- **Analytics or tracking**: no Google Analytics, no event tracking.
- **Custom domain setup**: deployment is on Vercel's default domain for now.
- **Automated scraper scheduling**: the scraper is a manual one-time script, not a cron job.

## Further Notes

- **Resume narrative**: this project is listed under internship experience (August 2023). All tech choices must be credible for that time period. The developer should be prepared to explain every architectural decision (rendering strategy, database choice, anonymous auth, scraper design) in an interview setting.
- **Data volume**: the CSV contains ~12,300 grade distribution records across multiple terms and departments. The course catalog will likely yield 5,000-10,000 course entries. Both fit comfortably within Vercel Postgres free tier (256MB).
- **Deployment sequence**: git init → push to GitHub → connect to Vercel → provision Vercel Postgres → run seed scripts → deploy.
