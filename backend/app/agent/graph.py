"""The agent: an LLM that plans its own steps and calls tools until it can answer.

Conversation memory comes from the messages table in Postgres (passed in as `history`),
so it survives server restarts and sleeping free-tier hosts.
"""
import logging
from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphRecursionError

from app.agent.tools import make_tools
from app.rag.qa import get_llm, message_text

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are StudyMate, an AI study assistant that helps users learn from their own uploaded documents.

Work step by step and choose your own tools:
1. For any question about the user's material, call search_documents first. If the first search is thin, search again with different wording.
2. To summarise a whole file, use summarize_document (call list_documents first if you need the id).
3. For quizzes, search the topic, then call generate_quiz. When asked what to revise, finish with a short revision list based on what you found.
4. Use web_search ONLY if the documents do not contain the answer, and say clearly that the information came from the web.

Rules:
- Base answers on tool results. Never invent facts about the user's documents.
- Cite document sources inline as [file p.N].
- If nothing relevant is found, say so plainly."""

RECURSION_LIMIT = 16
FALLBACK_ANSWER = "I couldn't finish that within a reasonable number of steps. Try asking a narrower question."


def build_agent(doc_id: Optional[str] = None):
    """Create the agent graph (tools are scoped to doc_id when given)."""
    tools = make_tools(doc_id)
    try:  # newer LangChain
        from langchain.agents import create_agent

        return create_agent(model=get_llm(), tools=tools, system_prompt=SYSTEM_PROMPT)
    except ImportError:  # LangGraph prebuilt agent
        from langgraph.prebuilt import create_react_agent

        return create_react_agent(get_llm(), tools=tools, prompt=SYSTEM_PROMPT)


def run_agent(
    question: str, history: list[tuple[str, str]], doc_id: Optional[str] = None
) -> dict[str, Any]:
    """Run one agent turn. Returns {"answer", "sources", "tools_used"}."""
    messages = [
        HumanMessage(content=text) if role == "user" else AIMessage(content=text)
        for role, text in history
    ]
    messages.append(HumanMessage(content=question))

    try:
        result = build_agent(doc_id).invoke(
            {"messages": messages}, config={"recursion_limit": RECURSION_LIMIT}
        )
    except GraphRecursionError:
        log.warning("Agent hit the recursion limit for question: %s", question[:80])
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
