import json
import os
import re
import urllib.request
import urllib.error

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


def _call_groq_http(messages, temperature, max_tokens):
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        return None, {"status": 500, "error": "GROQ_API_KEY not set"}
    payload = {
        "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(GROQ_API_URL, data=data, method="POST")
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=22) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw), None
    except urllib.error.HTTPError as err:
        try:
            body = json.loads(err.read().decode("utf-8", errors="replace"))
            msg = body.get("error", {}).get("message", "Groq error")
        except Exception:
            msg = "Groq error"
        if err.code == 429:
            wait = _extract_wait_time(msg)
            return None, {"status": 429, "error": _rate_limit_message(wait)}
        return None, {"status": err.code, "error": msg}
    except Exception as err:
        return None, {"status": 502, "error": f"Unexpected error: {err.__class__.__name__}"}


def _call_groq_langchain(messages, temperature, max_tokens):
    try:
        from langchain_groq import ChatGroq
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
    except Exception:
        return None, {"status": 500, "error": "LangChain not installed"}

    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        return None, {"status": 500, "error": "GROQ_API_KEY not set"}

    lc_messages = []
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            lc_messages.append(SystemMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
        else:
            lc_messages.append(HumanMessage(content=content))

    try:
        llm = ChatGroq(
            groq_api_key=key,
            model_name=os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
            temperature=temperature,
            max_tokens=max_tokens,
        )
        resp = llm.invoke(lc_messages)
        content = resp.content if hasattr(resp, "content") else str(resp)
        return {"choices": [{"message": {"content": content}}]}, None

    except Exception as err:
        err_str = str(err)
        if "429" in err_str or "rate_limit" in err_str.lower() or "Rate limit" in err_str:
            wait = _extract_wait_time(err_str)
            return None, {"status": 429, "error": _rate_limit_message(wait)}
        if "401" in err_str or "authentication" in err_str.lower():
            return None, {"status": 401, "error": "Invalid Groq API key. Please check your GROQ_API_KEY."}
        return None, {"status": 502, "error": f"LangChain error: {err.__class__.__name__}"}


def _extract_wait_time(message: str) -> str:
    """
    Extracts wait time from Groq rate limit error message.
    Looks for patterns like 'try again in 13m36.48s' or 'try again in 2m'.
    Returns a clean string like '13 minutes' or empty string if not found.
    """
    match = re.search(r"try again in\s+((\d+)m(\d+(?:\.\d+)?)?s?|(\d+)s)", message, re.IGNORECASE)
    if match:
        full = match.group(1)
        minutes = match.group(2)
        seconds = match.group(3)
        secs_only = match.group(4)

        if secs_only:
            return f"{secs_only} seconds"
        if minutes and int(minutes) > 0:
            if seconds:
                return f"{minutes} minutes"
            return f"{minutes} minutes"
    return ""


def _rate_limit_message(wait: str) -> str:
    if wait:
        return f"Sorry, you have exceeded the token limit. Please try again in {wait}."
    return "Sorry, you have exceeded the token limit. Please try again in a few minutes."


def call_chat(messages, temperature, max_tokens):
    use_langchain = os.environ.get("USE_LANGCHAIN", "true").lower() == "true"
    if use_langchain:
        result, err = _call_groq_langchain(messages, temperature, max_tokens)
        if result is not None:
            return result, None
        if err and err.get("status") == 429:
            return None, err
    return _call_groq_http(messages, temperature, max_tokens)