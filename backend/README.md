# StudyMate Backend

FastAPI backend for **StudyMate**, an AI document assistant. Users upload their own PDF or text files and ask questions. Answers come from those documents (Retrieval-Augmented Generation) with the source file and page shown. An optional LangGraph agent can plan multi-step tasks such as summarising a file or building a quiz.

## Problem statement

Students and job seekers keep notes, syllabi and interview guides in many PDFs. Finding an answer means searching manually, and a general chatbot may answer from outside the user's material.

- **Target users:** college students, placement aspirants, anyone who needs answers from their own documents.
- **Expected outcome:** upload a document, ask a question, get an accurate answer with citations (file and page), plus summaries and quizzes.

## Architecture

```
┌──────────────────┐      HTTPS/REST      ┌──────────────────────────────┐
│ FRONTEND         │ ───────────────────▶ │ BACKEND (FastAPI)            │
│ React (Vercel)   │ ◀─────────────────── │ Render                       │
│ UI only, no keys │       JSON           │ • POST /upload     ingest    │
└──────────────────┘                      │ • POST /chat       RAG       │
                                          │ • POST /agent/chat agent     │
                                          │ • GET  /history/{id}         │
                                          │ Keys in env vars, CORS       │
                                          └───────┬──────────────┬───────┘
                                                  │              │
                                    ┌─────────────▼───┐   ┌──────▼─────────────┐
                                    │ PostgreSQL      │   │ Qdrant vector store│
                                    │ (Neon/Supabase) │   │ embeddings +       │
                                    │ documents,      │   │ metadata (file,    │
                                    │ chat history    │   │ page, doc_id)      │
                                    └─────────────────┘   └────────────────────┘
                                                  │
                                          ┌───────▼────────┐
                                          │ Gemini API     │
                                          │ LLM+embeddings │
                                          └────────────────┘
```

### RAG flow

1. **Ingest:** `/upload` accepts a PDF or TXT file and extracts its text page by page.
2. **Chunk:** text is split into ~700-character chunks with 100 characters of overlap.
3. **Embed:** each chunk becomes a vector (Gemini `gemini-embedding-001`).
4. **Store:** vectors go to Qdrant with metadata `doc_id`, `source` (file name), `page`, `chunk`.
5. **Retrieve:** the question is embedded and the top 5 similar chunks are fetched.
6. **Generate:** chunks and question go to the LLM with the instruction to answer only from the context.
7. **Cite:** the response returns the answer plus the source chunks (file, page, snippet).

### Agent flow

`POST /agent/chat` runs a tool-calling agent that decides its own steps:

| Tool | Purpose |
|---|---|
| `search_documents(query)` | RAG lookup over the uploaded documents |
| `list_documents()` | Database lookup of uploaded files and their ids |
| `summarize_document(doc_id)` | Summarise a whole file |
| `generate_quiz(topic, num_questions)` | Multiple-choice questions from retrieved content |
| `web_search(query)` | Fallback when the documents do not contain the answer |

Conversation memory is stored in Postgres (`messages` table), so follow-up questions work and survive restarts.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python, FastAPI, LangChain, LangGraph |
| App database | PostgreSQL (Neon or Supabase free tier), SQLAlchemy |
| Vector store | Qdrant Cloud (free tier) |
| LLM and embeddings | Google Gemini API |
| Hosting | Render (backend) |

## Project structure

```
backend/
├── app/
│   ├── main.py            # FastAPI app, CORS, health checks, startup
│   ├── config.py          # environment settings
│   ├── db/                # database.py (engine/session), models.py (tables)
│   ├── rag/               # ingest.py, retriever.py, qa.py
│   ├── agent/             # tools.py, graph.py
│   └── routes/            # upload.py, chat.py
├── .env.example
├── requirements.txt
└── README.md
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/health/ready` | Checks Postgres and Qdrant connectivity |
| POST | `/upload` | Upload a PDF or TXT file (max 10 MB) |
| GET | `/documents` | List uploaded documents |
| DELETE | `/documents/{doc_id}` | Delete a document and its vectors |
| POST | `/chat` | RAG answer with sources. Body: `{session_id, question, doc_id?}` |
| POST | `/agent/chat` | Agent answer with sources and `tools_used`. Same body |
| GET | `/history/{session_id}` | Chat history for a session |
| DELETE | `/history/{session_id}` | Clear a session's history |

Interactive docs are available at `/docs`.

## Local setup

Requires Python 3.11 or 3.12.

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env              # Windows: copy .env.example .env
# fill in the values in .env (see below)

uvicorn app.main:app --reload
```

Open http://localhost:8000/docs. Run the command from inside `backend/` so `.env` is found.

### Environment variables

| Variable | Description |
|---|---|
| `GOOGLE_API_KEY` | Gemini API key from Google AI Studio |
| `DATABASE_URL` | Postgres connection string from Neon or Supabase |
| `QDRANT_URL` | Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | Qdrant Cloud API key |
| `FRONTEND_URL` | Allowed CORS origin, no trailing slash (comma-separate several) |
| `LLM_MODEL` | Optional, default `gemini-2.5-flash` |
| `EMBEDDING_MODEL` | Optional, default `models/gemini-embedding-001` |

Never commit `.env`. It is listed in `.gitignore`.

### Try it

```bash
# upload a document
curl -F "file=@notes.pdf" http://localhost:8000/upload

# ask a question (RAG)
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"session_id":"demo","question":"What is covered in Unit 3?"}'

# use the agent
curl -X POST http://localhost:8000/agent/chat -H "Content-Type: application/json" \
  -d '{"session_id":"demo","question":"Make a 5-question quiz on Unit 3 and tell me what to revise"}'
```

## Deploy on Render

1. Push the repository to GitHub.
2. Render: **New → Web Service**, pick the repo, set **Root Directory** to `backend`.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Under **Environment**, add every variable from `.env.example`. Set `FRONTEND_URL` to the Vercel URL (no trailing slash). If the build uses the wrong Python, set `PYTHON_VERSION` to `3.12.8`.
6. Check `https://<service>.onrender.com/health` and `/health/ready`.

The free Render tier sleeps after inactivity, so the first request can take 30 to 50 seconds. Open `/health` before a demo.

## Known limitations

- Scanned or image-only PDFs have no extractable text, so they are rejected (OCR is not included).
- Free-tier Gemini limits can return HTTP 429. The API reports it as a clean error.
- If you change the embedding model, delete the Qdrant collection so it is recreated with the right vector size.

## Live links

- Frontend: _add the Vercel URL after deployment_
- Backend API: _add the Render URL after deployment_
