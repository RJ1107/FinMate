import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from app.agents.market_fact import MarketFactAgent
from app.services.market import MarketService


def run(cases_path: Path) -> dict:
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    agent = MarketFactAgent(MarketService(provider_name="demo"))
    results = []

    for case in cases:
        answer = agent.ask(case["question"])
        intent_ok = answer.intent.value == case["expected_intent"]
        entity_ok = (
            "expected_entity" not in case or answer.resolved_entity == case["expected_entity"]
        )
        content_ok = "answer_contains" not in case or case["answer_contains"] in answer.answer
        results.append(
            {
                "id": case["id"],
                "intent_ok": intent_ok,
                "entity_ok": entity_ok,
                "content_ok": content_ok,
                "passed": intent_ok and entity_ok and content_ok,
                "actual_intent": answer.intent.value,
                "actual_entity": answer.resolved_entity,
            }
        )

    entity_cases = [
        result for result, case in zip(results, cases, strict=True) if "expected_entity" in case
    ]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "dataset": str(cases_path.as_posix()),
        "total": len(results),
        "passed": sum(result["passed"] for result in results),
        "intent_accuracy": sum(result["intent_ok"] for result in results) / len(results),
        "entity_accuracy": (
            sum(result["entity_ok"] for result in entity_cases) / len(entity_cases)
            if entity_cases
            else None
        ),
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the deterministic FinMate Agent eval set")
    parser.add_argument("--cases", type=Path, default=Path("evals/cases.json"))
    parser.add_argument("--output", type=Path, default=Path("evals/latest_report.json"))
    args = parser.parse_args()

    report = run(args.cases)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"passed={report['passed']}/{report['total']} "
        f"intent_accuracy={report['intent_accuracy']:.1%} "
        f"entity_accuracy={report['entity_accuracy']:.1%}"
    )
    if report["passed"] != report["total"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
