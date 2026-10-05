◈ StudyMate AI

AI-Powered Document Learning Assistant

StudyMate AI is an AI-powered study assistant that helps students learn
from their own documents.

Upload a PDF or TXT file, ask questions about it, and get answers
based on the uploaded study material.

⟡ Features

◇ Upload PDF and TXT documents

◇ Ask questions about uploaded documents

◇ AI-powered document search

◇ RAG-based question answering

◇ Document source references

◇ Page-based source information

◇ Document management

◇ AI Chat

◇ Backend health monitoring

◇ Secure environment configuration

⌁ How It Works

                 ┌──────────────────┐
                 │  Upload Document │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │  Extract Text    │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │  Split into      │
                 │     Chunks       │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │    Embeddings    │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ Qdrant Vector DB │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │   User Question  │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ Similarity Search│
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │    Groq LLM      │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ Answer + Sources │
                 └──────────────────┘

⌬ Technology Stack

Frontend

Technology     Purpose

React          User Interface
TypeScript     Frontend Development
Vite           Development & Build Tool
Tailwind CSS   UI Styling

Backend

Technology   Purpose

Python       Backend Development
FastAPI      REST API
Uvicorn      Application Server

AI / RAG

Technology               Purpose

LangChain                RAG Framework
Hugging Face             Text Embeddings
BAAI/bge-small-en-v1.5   Embedding Model
Groq                     Large Language Model



Deployment

Platform   Purpose

Netlify    Frontend Hosting


◇ Project Structure

StudyMate/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   ├── rag/
│   │   ├── db/
│   │   ├── config.py
│   │   └── main.py
│   │
│   ├── requirements.txt
│   └── ...
│
└── README.md

⌘ Local Installation

01 --- Clone Repository

git clone <>
cd StudyMate

02 --- Backend Setup

cd backend

Create a virtual environment:

python -m venv venv

Activate it:

.\venv\Scripts\Activate.ps1

Install dependencies:

pip install -r requirements.txt

⊙ Backend Configuration

Create:

backend/.env

Add:

GROQ_API_KEY=your_groq_api_key
DATABASE_URL=your_database_url
QDRANT_URL=your_qdrant_url
QDRANT_API_KEY=your_qdrant_api_key

LLM_MODEL=openai/gpt-oss-120b
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5

QDRANT_COLLECTION=studymate

FRONTEND_URL=http://localhost:5173

Security: Never commit .env files or API keys to GitHub.

▶ Start Backend

python -m uvicorn app.main:app --reload







◇ Frontend Setup

Open another terminal:

cd frontend

Install dependencies:

npm install

Create:

frontend/.env

Add:

VITE_API_BASE_URL=http://127.0.0.1:8000

Start the frontend:

npm run dev

Open:

http://localhost:5173

⌁ Supported Documents

Currently supported:

.PDF
.TXT

Maximum upload size:

10 MB

Scanned or image-only PDFs require OCR and may not contain readable
text.

◈ Usage

Step 01

Open StudyMate AI.

Step 02

Upload a PDF or TXT document.

Step 03

Wait until the document is indexed.

Step 04

Open the AI Chat section.

Step 05

Ask a question about your document.

Example:

What is the main topic of this document?

StudyMate searches the uploaded document and generates an answer using
the relevant content.

⟐ Production Configuration



FRONTEND_URL=https://ragwise.netlify.app





⟡ Future Improvements

◇ OCR support for scanned documents
◇ More document formats
◇ User authentication
◇ Advanced study tools
◇ Voice-based questions
◇ AI-generated summaries
◇ Automatic quiz generation
◇ Flashcard generation
◇ Personalized learning

── Author


Sai Kumar Dungala

B.Tech --- Computer Science & Engineering

Cyber Security


T. Siva Sankar

B.Tech --- Computer Science & Engineering

Cyber Security

Tekkala Swapna

B.Tech --- Computer Science & Engineering

Cyber Security

Siva Sankari M

B.Tech --- Computer Science & Engineering

Cyber Security


Sridhar R

B.Tech --- Computer Science & Engineering




⟢ Project Status

Version : 1.0
Status  : Active Development
Type    : Academic / Educational Project

◈ License

This project is developed for educational and academic purposes.
