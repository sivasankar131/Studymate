# 📚 StudyMate – AI Smart Document Learning Assistant

> **"Upload Your Documents. Ask Anything. Learn Smarter."**

StudyMate is a full-stack AI-powered document Q&A application. Upload PDF or TXT files, ask natural-language questions, and receive accurate answers backed by the exact page and source from your documents — powered by RAG (Retrieval-Augmented Generation).

---

## ✨ Features

| Feature | Detail |
|---|---|
| 📤 Document Upload | Drag-and-drop or browse. Per-file progress. |
| 📄 Document Management | View, filter, delete all uploaded documents. |
| 💬 AI Chat (RAG) | Ask questions; answers come only from your documents. |
| 🤖 Agent Mode | Multi-step reasoning with tool calls (summarise, quiz, search). |
| 📎 Source Citations | Every answer shows the exact file name and page number. |
| 🔍 Document Filter | Restrict the chat to a single document. |
| 📱 Responsive | Works on desktop, tablet, and mobile. |
| 🌐 Backend Status | Live health indicator for API, PostgreSQL, and Qdrant. |

---

## 🛠 Technology Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 18 | UI library |
| Vite 5 | Build tool & dev server |
| TypeScript | Type safety |
| Tailwind CSS 3 | Utility-first styling |
| React Router 6 | Client-side routing |
| Axios | HTTP client |
| uuid | Session ID generation |

### Backend (already built — do not modify)
| Technology | Purpose |
|---|---|
| FastAPI | REST API framework |
| SQLAlchemy + PostgreSQL | Document metadata & chat history |
| Qdrant | Vector database |
| BAAI/bge-small-en-v1.5 | Embedding model (HuggingFace) |
| Groq LLM | Answer generation |

---

## 🏗 Architecture

```
User (Browser)
      │
      │  HTTP REST
      ▼
React Frontend  (this repo)
      │
      │  VITE_API_BASE_URL
      ▼
FastAPI Backend
      │
      ├── PostgreSQL  (document metadata, chat history)
      ├── Qdrant      (vector embeddings)
      └── Groq LLM   (answer generation)
              │
              ▼
       Answer + Sources
              │
              ▼
      React Frontend
```

### Frontend folder structure

```
frontend/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── ChatMessage/        # User & AI message bubbles + sources
│   │   ├── ChatWindow/         # Scrollable message log
│   │   ├── DocumentList/       # Document cards with delete/ask actions
│   │   ├── EmptyState/         # Empty-screen placeholder
│   │   ├── ErrorMessage/       # inline / banner / toast error variants
│   │   ├── FileCard/           # Per-file upload status card
│   │   ├── FileUploader/       # Drag-and-drop upload zone
│   │   ├── LoadingIndicator/   # dots / spinner / progress-bar
│   │   ├── MessageInput/       # Chat textarea with mode toggle
│   │   ├── Navbar/             # Top bar + health indicator
│   │   ├── Sidebar/            # Navigation links
│   │   └── SourceCard/         # RAG citation card
│   ├── hooks/
│   │   ├── useChat.ts          # Chat session state & API calls
│   │   ├── useDocuments.ts     # Document list & delete
│   │   ├── useHealth.ts        # Backend health polling
│   │   └── useUpload.ts        # Upload queue management
│   ├── pages/
│   │   ├── Chat/               # /chat
│   │   ├── Documents/          # /documents
│   │   ├── Home/               # /  (dashboard)
│   │   └── Settings/           # /settings
│   ├── services/
│   │   └── api.ts              # ALL backend calls (single source of truth)
│   ├── types/
│   │   └── index.ts            # Shared TypeScript types
│   ├── utils/
│   │   ├── env.ts              # Environment variable helpers
│   │   ├── format.ts           # Date, bytes, truncate helpers
│   │   ├── session.ts          # Browser session-ID management
│   │   └── validation.ts       # File type & size validation
│   ├── App.tsx                 # Root layout + routes
│   ├── main.tsx                # React entry point
│   └── index.css               # Tailwind + global styles
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## 🔌 Backend API Reference

The frontend communicates with the backend **only** through these endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/upload` | Upload a file (`multipart/form-data`, field: `file`) |
| `GET` | `/documents` | List all documents |
| `DELETE` | `/documents/{id}` | Delete a document and its vectors |
| `POST` | `/chat` | Plain RAG chat |
| `POST` | `/agent/chat` | Agent-mode chat (tool calling) |
| `GET` | `/history/{session_id}` | Load previous messages |
| `DELETE` | `/history/{session_id}` | Clear chat history |
| `GET` | `/health` | Liveness check |
| `GET` | `/health/ready` | Readiness check (DB + Qdrant) |

### Chat request schema
```json
{
  "session_id": "abc123",
  "question": "What is AI Smart Library?",
  "doc_id": "optional-document-id"
}
```

### Chat response schema
```json
{
  "answer": "AI Smart Library is ...",
  "sources": [
    { "file": "AI SMART LIBRARY.pdf", "page": 1, "snippet": "..." }
  ],
  "tools_used": []
}
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- The StudyMate backend running at `http://127.0.0.1:8000`

### 1 · Install dependencies

```bash
cd frontend
npm install
```

### 2 · Configure environment

```bash
cp .env.example .env
# .env already contains: VITE_API_BASE_URL=http://127.0.0.1:8000
# No other changes needed for local development
```

### 3 · Start the development server

```bash
npm run dev
# → http://localhost:5173
```

### 4 · Start the backend (separate terminal)

```bash
cd backend
# Activate your virtual environment, then:
uvicorn app.main:app --reload
# → http://127.0.0.1:8000
```

---

## 🔐 Security

- **No API keys in the frontend.** Groq, Qdrant, and database credentials live **only** in `backend/.env`.
- The frontend communicates exclusively with `VITE_API_BASE_URL`.
- CORS is configured server-side in FastAPI via the `FRONTEND_URL` env var.

---

## 📦 Production Build

```bash
npm run build
# Output: dist/
```

Preview the production build locally:

```bash
npm run preview
```

---

## ☁️ Deploying to Vercel

1. Push `frontend/` to a GitHub repository (or use the root with `Root Directory = frontend`).
2. In Vercel dashboard → **Settings → Environment Variables** add:
   ```
   VITE_API_BASE_URL = https://your-backend-domain.com
   ```
3. Set **Build Command** to `npm run build` and **Output Directory** to `dist`.
4. Deploy.

> Make sure your backend's `FRONTEND_URL` env var is updated to match the Vercel deployment URL so CORS passes.

---

## 🌐 Live URLs

| Service | URL |
|---|---|
| Frontend | *(add your Vercel URL here)* |
| Backend  | *(add your backend URL here)* |

---

## 📸 Screenshots

*(Add screenshots here after deployment)*

---

## 📝 Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | `http://127.0.0.1:8000` |

> This is the **only** environment variable the frontend needs.

---

## 🗂 Supported File Types

| Format | Backend support |
|---|---|
| PDF | ✅ Supported |
| TXT | ✅ Supported |
| DOCX, XLSX, PPTX, CSV… | 🔜 Extend backend `ALLOWED_EXTENSIONS` in `app/routes/upload.py` |

---

## 📄 License

MIT
