# { "Depends": "py-genlayer:test" }

from genlayer import *

import json
import typing


class EngageChain(gl.Contract):
    submissions:  TreeMap[str, str]
    ai_responses: TreeMap[str, str]
    verdicts:     TreeMap[str, str]
    authors:      TreeMap[str, str]
    statuses:     TreeMap[str, str]
    sources:      TreeMap[str, str]   # "genlayer" | "external"
    next_id:      str

    def __init__(self):
        self.next_id = "0"

    # ── Write: submit opinion ──────────────────────────────────────────────
    @gl.public.write
    def submit_opinion(self, text: str) -> str:
        assert len(text) > 0, "Text cannot be empty"
        assert len(text) <= 2000, "Text cannot exceed 2000 characters"

        opinion_id = str(self.next_id)
        self.submissions[opinion_id]  = text
        self.ai_responses[opinion_id] = ""
        self.verdicts[opinion_id]     = ""
        self.authors[opinion_id]      = gl.message.sender_address.as_hex
        self.statuses[opinion_id]     = "pending"
        self.sources[opinion_id]      = "genlayer"
        self.next_id = str(int(self.next_id) + 1)

        return opinion_id

    # ── Write: evaluate with GenLayer AI ──────────────────────────────────
    @gl.public.write
    def evaluate_opinion(self, opinion_id: str) -> typing.Any:
        assert opinion_id in self.submissions, "Invalid ID"
        assert self.statuses[opinion_id] == "pending", "Opinion already evaluated"

        original_text = str(self.submissions[opinion_id])

        def get_analysis() -> str:
            task = f"""You are an expert analyst of ideas, proposals, and opinions.
Analyze this text: "{original_text}"

Respond with ONLY the following JSON, no other text:
{{
    "summary": "brief summary in 1-2 sentences",
    "sentiment": "positive or negative or neutral or mixed",
    "category": "proposal or opinion or dispute or question or other",
    "key_points": ["point 1", "point 2", "point 3"],
    "ai_recommendation": "concrete recommendation or verdict",
    "confidence_score": "0.85"
}}
Rules:
- confidence_score MUST be a quoted string like "0.85", never a number.
- All field values must be strings or arrays of strings.
- Output ONLY the JSON object. No markdown, no explanation, no extra text."""

            raw = (
                gl.nondet.exec_prompt(task)
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )
            print(raw)
            parsed = json.loads(raw)

            raw_score = parsed.get("confidence_score", "0")
            parsed["confidence_score"] = str(raw_score)

            for key in ["summary", "sentiment", "category", "ai_recommendation"]:
                if key in parsed and not isinstance(parsed[key], str):
                    parsed[key] = str(parsed[key])

            kp = parsed.get("key_points", [])
            parsed["key_points"] = [str(p) for p in (kp if isinstance(kp, list) else [kp])]

            return json.dumps(parsed, sort_keys=True)

        result_str  = gl.eq_principle.strict_eq(get_analysis)
        result_json = json.loads(result_str)

        self.ai_responses[opinion_id] = json.dumps(result_json)
        self.statuses[opinion_id]     = "evaluated"
        self.sources[opinion_id]      = "genlayer"

        return result_json

    # ── Write: submit pre-validated opinion (external AI) ─────────────────
    # The user provides their own AI analysis in JSON format.
    # GenLayer validators verify the JSON is well-formed and matches the
    # expected schema — they do NOT re-run the AI, they just confirm the
    # user's analysis is structurally valid and can be stored on-chain.
    @gl.public.write
    def submit_with_external_ai(self, opinion_id: str, external_analysis: str) -> typing.Any:
        assert opinion_id in self.submissions, "Invalid ID"
        assert self.statuses[opinion_id] == "pending", "Opinion already evaluated"
        assert len(external_analysis) > 0, "External analysis cannot be empty"
        assert len(external_analysis) <= 10000, "Analysis too long (max 10000 chars)"

        # Read the original text before nondet block
        original_text = str(self.submissions[opinion_id])
        analysis_text = str(external_analysis)

        def validate_and_normalize() -> str:
            # Validators verify the user's analysis is valid JSON with required fields.
            # They do NOT re-run the AI — they confirm the structure is correct
            # so it can be stored and displayed consistently on-chain.
            parsed = json.loads(analysis_text)

            # Normalize to the standard schema — fill missing fields with defaults
            result = {
                "summary":           str(parsed.get("summary", "User-provided analysis")),
                "sentiment":         str(parsed.get("sentiment", "neutral")),
                "category":          str(parsed.get("category", "opinion")),
                "ai_recommendation": str(parsed.get("ai_recommendation",
                                         parsed.get("recommendation",
                                         parsed.get("verdict", "See summary")))),
                "confidence_score":  str(parsed.get("confidence_score", "1.0")),
                "key_points":        [str(p) for p in parsed.get("key_points",
                                     parsed.get("points", ["User validated"]))
                                     if isinstance(parsed.get("key_points",
                                     parsed.get("points", [])), list)]
                                     or ["User validated"],
            }

            return json.dumps(result, sort_keys=True)

        result_str  = gl.eq_principle.strict_eq(validate_and_normalize)
        result_json = json.loads(result_str)

        self.ai_responses[opinion_id] = json.dumps(result_json)
        self.statuses[opinion_id]     = "evaluated"
        self.sources[opinion_id]      = "external"

        return result_json

    # ── Write: finalize opinion ────────────────────────────────────────────
    @gl.public.write
    def finalize_opinion(self, opinion_id: str, verdict: str) -> typing.Any:
        assert opinion_id in self.submissions, "Invalid ID"
        assert self.statuses[opinion_id] == "evaluated", "Must be evaluated first"
        assert len(verdict) > 0, "Verdict cannot be empty"

        self.verdicts[opinion_id] = verdict
        self.statuses[opinion_id] = "finalized"

        return {"id": opinion_id, "status": "finalized"}

    # ── View: all opinions ────────────────────────────────────────────────
    @gl.public.view
    def get_all_opinions(self) -> dict[str, typing.Any]:
        return {str(k): str(v) for k, v in self.submissions.items()}

    # ── View: full data for one entry ─────────────────────────────────────
    @gl.public.view
    def get_resolution_data(self, opinion_id: str) -> dict[str, typing.Any]:
        assert opinion_id in self.submissions, "Invalid ID"
        return {
            "id":          str(opinion_id),
            "text":        str(self.submissions[opinion_id]),
            "ai_response": str(self.ai_responses[opinion_id]),
            "verdict":     str(self.verdicts[opinion_id]),
            "status":      str(self.statuses[opinion_id]),
            "author":      str(self.authors[opinion_id]),
            "source":      str(self.sources.get(opinion_id, "genlayer")),
        }

    # ── View: total submissions ───────────────────────────────────────────
    @gl.public.view
    def get_total_submissions(self) -> str:
        return str(self.next_id)

    # ── View: status ──────────────────────────────────────────────────────
    @gl.public.view
    def get_status(self, opinion_id: str) -> str:
        assert opinion_id in self.submissions, "Invalid ID"
        return str(self.statuses[opinion_id])
