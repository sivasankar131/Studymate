"""Agent graph — tool calls are scoped to the requesting client_id."""
import logging
from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphRecursionError

from app.agent.tools import make_tools
from app.rag.qa import get_llm, message_text

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are StudyMate, an AI study assistant. Help users learn from their own uploaded documents.

Steps:
1. For any question about study material, call search_documents first.
2. To summarise a whole file, use summarize_document (call list_documents for the id first if needed).
3. For quizzes, search the topic then call generate_quiz.
4. Use web_search ONLY if the documents don't contain the answer; say so clearly.

Rules:
- Base answers on tool results. Never invent facts.
- Cite document sources as [file p.N].
- If nothing relevant is found, say so plainly."""

RECURSION_LIMIT  = 16
FALLBACK_ANSWER  = "I couldn't finish that in a reasonable number of steps. Try a narrower question."


def build_agent(client_id: str, doc_id: Optional[str] = None):
    tools = make_tools(client_id, doc_id)
    try:
        from langchain.agents import create_agent
        return create_agent(model=get_llm(), tools=tools, system_prompt=SYSTEM_PROMPT)
    except ImportError:
        from langgraph.prebuilt import create_react_agent
        return create_react_agent(get_llm(), tools=tools, prompt=SYSTEM_PROMPT)


def run_agent(
    question: str,
    history: list[tuple[str, str]],
    client_id: str,
    doc_id: Optional[str] = None,
) -> dict[str, Any]:
    messages = [
        HumanMessage(content=text) if role == "user" else AIMessage(content=text)
        for role, text in history
    ]
    messages.append(HumanMessage(content=question))

    try:
        result = build_agent(client_id, doc_id).invoke(
            {"messages": messages},
            config={"recursion_limit": RECURSION_LIMIT},
        )
    except GraphRecursionError:
        log.warning("Agent hit recursion limit for question: %s", question[:80])
        return {"answer": FALLBACK_ANSWER, "sources": [], "tools_used": []}

    answer, tools_used, sources, seen = "", [], [], set()
    for msg in result["messages"]:
        if isinstance(msg, AIMessage):
            for call in msg.tool_calls or []:
                tools_used.append(call["name"])
        elif isinstance(msg, ToolMessage) and isinstance(msg.artifact, list):
            for src in msg.artifact:
                key = (src.get("file"), src.get("page"), src.get("snippet"))
                if key not in seen:
                    seen.add(key)
                    sources.append(src)

    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage) and not msg.tool_calls:
            answer = message_text(msg.content).strip()
            break

    return {"answer": answer or FALLBACK_ANSWER, "sources": sources, "tools_used": tools_used}
