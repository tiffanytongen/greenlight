"""Provider-agnostic structured-output wrapper. Temperature 0, Pydantic-validated,
one retry, then raise (callers fall back to a safe INSPECT rather than crash).

Set GREENLIGHT_LLM = mock | anthropic | openai.
  mock      -> reasoning/perception use deterministic heuristics (also the ablation
               'rules-only' arm); this file is not called.
  anthropic -> needs ANTHROPIC_API_KEY, uses a vision-capable Claude model.
  openai    -> needs OPENAI_API_KEY, uses a vision-capable GPT model.
"""
from __future__ import annotations
import base64
import json
import os
from typing import Optional, Type, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")


def provider() -> str:
    return os.getenv("GREENLIGHT_LLM", "mock")


def _b64(image_path: str) -> tuple[str, str]:
    with open(image_path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode()
    media = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    return media, data


def complete_json(system: str, user: str, schema: Type[T],
                  image_path: Optional[str] = None) -> T:
    """Return a validated instance of `schema`. Raises on repeated failure."""
    p = provider()
    if p == "mock":
        raise RuntimeError("complete_json called in mock mode - use heuristic path instead.")

    last_err = None
    for attempt in range(2):
        try:
            raw = _call(p, system, user, image_path)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return schema.model_validate(json.loads(raw))
        except Exception as e:  # noqa
            last_err = e
            user = user + "\n\nYour previous reply did not match the schema. Return ONLY valid JSON."
    raise RuntimeError(f"LLM structured output failed twice: {last_err}")


def _call(p: str, system: str, user: str, image_path: Optional[str]) -> str:
    if p == "anthropic":
        import anthropic
        client = anthropic.Anthropic()
        content = [{"type": "text", "text": user}]
        if image_path:
            media, data = _b64(image_path)
            content.insert(0, {"type": "image",
                               "source": {"type": "base64", "media_type": media, "data": data}})
        msg = client.messages.create(
            model=ANTHROPIC_MODEL, max_tokens=1500, temperature=0,
            system=system, messages=[{"role": "user", "content": content}])
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    if p == "openai":
        from openai import OpenAI
        client = OpenAI()
        content = [{"type": "text", "text": user}]
        if image_path:
            media, data = _b64(image_path)
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:{media};base64,{data}"}})
        resp = client.chat.completions.create(
            model=OPENAI_MODEL, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": content}])
        return resp.choices[0].message.content

    raise ValueError(f"unknown provider {p}")
