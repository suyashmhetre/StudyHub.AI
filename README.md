# StudyHub AI

StudyHub AI is a runnable collaborative learning platform. Students can create or join study groups, upload and share private study files, track assignments, start discussions, and ask grounded questions against their group’s document library.

## Run it locally

Prerequisite: Node.js 20 or later.

```powershell
npm.cmd start
```

Open [http://localhost:4173](http://localhost:4173).

Use the seeded demo account:

- Email: `demo@studyhub.ai`
- Password: `demo1234`

Or create a new account from the sign-up screen.

## What is implemented

- Cookie-backed registration, login, and logout with salted password hashing.
- Private/public group creation and join-by-invite-code.
- MongoDB-ready users, groups, memberships, resources, document chunks, assignments, discussions, and activity data.
- Secure resource upload for PDF, DOCX, PPTX, TXT, Markdown, and CSV files (20 MB maximum).
- File storage via local disk or optional S3, with secure resource upload.
- Server-side text extraction and chunking, so StudyBot answers use uploaded content rather than only file names.
- Gemini-backed chat responses, flashcards, quizzes, and study plans when `GEMINI_API_KEY` is set; source-grounded local fallback when it is not.
- Assignment creation and group discussion posting.
- Dashboard metrics and recent group activity.
- Responsive Gemini chat interface for group-question answering.
- Persistent local data in `data/db.json` (created on first server start).
- Responsive interface designed for desktop and mobile.

## Architecture

The application uses no third-party runtime dependencies so it can start immediately in a new workspace.

```text
Browser UI (public/app.js)
          │ JSON + multipart upload
Node API (server.js)
    ┌─────┴─────────┐
MongoDB Atlas    Private Supabase Storage
    │                    │
Searchable text chunks   Original documents
    └─────┬─────────┘
       Gemini API
```

The `POST /api/study` route retrieves only the selected group’s indexed chunks and sends those excerpts to Gemini. Scanned PDFs can use a controlled Gemini PDF fallback when conventional extraction yields no text.

## Configure MongoDB, storage, and AI

Copy `.env.example` to `.env`, then provide the three cloud services:

1. `MONGODB_URI` and `MONGODB_DATABASE` — MongoDB Atlas stores logins, group permissions, and content metadata/chunks.
2. `S3_BUCKET`, `AWS_S3_BUCKET`, `S3_KEY`, `AWS_ACCESS_KEY_ID`, `S3_SECRET`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_REGION` — optional S3-compatible storage for uploaded documents.
3. `GEMINI_API_KEY` — enables model-generated responses over retrieved document text.

When no cloud storage configuration is supplied, development mode uses `data/db.json` and `data/uploads/`. This fallback is intentionally not for production.

See [data-and-ai-architecture.md](docs/data-and-ai-architecture.md) for the full data flow, collection model, security boundaries, and setup.

## API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create a student account |
| POST | `/api/auth/login` | Start a session |
| POST | `/api/auth/logout` | End a session |
| GET | `/api/dashboard` | Workspace metrics, groups, activity |
| GET/POST | `/api/groups` | List/create groups |
| POST | `/api/groups/join` | Join by invite code |
| GET | `/api/groups/:id` | Read a group workspace |
| GET/POST | `/api/groups/:id/resources` | List/add resources |
| GET | `/api/resources/:id/download` | Securely download a group resource |
| GET/POST | `/api/groups/:id/assignments` | List/add assignments |
| GET/POST | `/api/groups/:id/discussions` | List/create discussions |
| POST | `/api/study` | Generate a study aid |

## Verify

```powershell
npm.cmd test
```

## Important scope note

This is a functional local MVP, not a deployed multi-tenant production system. The production upgrade path above is deliberate: raw uploaded documents, email verification, password recovery, real-time discussion, malware scanning, model integration, and role-management approvals require external infrastructure and service credentials.
