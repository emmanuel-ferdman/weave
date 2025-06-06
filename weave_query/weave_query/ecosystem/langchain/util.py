"""Common utilities for the LangChain integration.

This file exposes 4 primary functions:
- `safely_convert_lc_run_to_wb_span`: Converts a LangChain Run into a W&B Trace Span.
- `safely_get_span_producing_model`: Retrieves the model that produced a given LangChain Run.
- `safely_convert_model_to_dict`: Converts a LangChain model into a dictionary.

These functions are used by the `WandbTracer` to extract and save the relevant information.
"""

import logging
from typing import TYPE_CHECKING, Any, Optional, Union

from langchain.callbacks.tracers.schemas import Run, RunTypeEnum

from weave_query.ops_domain import trace_tree

if TYPE_CHECKING:
    from langchain.chains.base import Chain
    from langchain.llms.base import BaseLLM
    from langchain.schema import BaseLanguageModel
    from langchain.tools.base import BaseTool

logger = logging.getLogger(__name__)

PRINT_WARNINGS = True


def safely_convert_lc_run_to_wb_span(run: Run) -> Optional["trace_tree.Span"]:
    try:
        return _convert_lc_run_to_wb_span(run)
    except Exception as e:
        if PRINT_WARNINGS:
            logging.warning(
                f"Skipping trace saving - unable to safely convert LangChain Run into W&B Trace due to: {e}"
            )
        return None


# def safely_get_span_producing_model(run: Run) -> Any:
#     try:
#         return run.serialized.get("_self")
#     except Exception as e:
#         if PRINT_WARNINGS:
#             wandb.termwarn(
#                 f"Skipping model saving - unable to safely retrieve LangChain model due to: {e}"
#             )
#     return None


# def safely_convert_model_to_dict(
#     model: Union["BaseLanguageModel", "BaseLLM", "BaseTool", "Chain"]
# ) -> Optional[dict]:
#     """Returns the model dict if possible, otherwise returns None.

#     Given that Models are all user defined, this operation is not always possible.
#     """
#     data = None
#     message = None
#     try:
#         data = model.dict()
#     except Exception as e:
#         message = str(e)
#         if hasattr(model, "agent"):
#             try:
#                 data = model.agent.dict()
#             except Exception as e:
#                 message = str(e)

#     if data is not None and not isinstance(data, dict):
#         message = (
#             f"Model's dict transformation resulted in {type(data)}, expected a dict."
#         )
#         data = None

#     if data is not None:
#         data = _replace_type_with_kind(data)
#     else:
#         if PRINT_WARNINGS:
#             wandb.termwarn(
#                 f"Skipping model saving - unable to safely convert LangChain Model to dictionary due to: {message}"
#             )

#     return data


def _convert_lc_run_to_wb_span(run: "Run") -> "trace_tree.Span":
    if run.run_type == RunTypeEnum.llm:
        return _convert_llm_run_to_wb_span(run)
    elif run.run_type == RunTypeEnum.chain:
        return _convert_chain_run_to_wb_span(run)
    elif run.run_type == RunTypeEnum.tool:
        return _convert_tool_run_to_wb_span(run)
    else:
        return _convert_unknown_run_to_wb_span(run)


def _convert_llm_run_to_wb_span(run: "Run") -> "trace_tree.Span":
    base_span = _base_convert_run_to_wb_span(run)

    base_span["results"] = [
        trace_tree.Result(
            inputs={"prompt": prompt},
            outputs={
                f"gen_{g_i}": gen["text"]
                for g_i, gen in enumerate(run.outputs["generations"][ndx])
            }
            if (
                run.outputs is not None
                and len(run.outputs["generations"]) > ndx
                and len(run.outputs["generations"][ndx]) > 0
            )
            else None,
        )
        for ndx, prompt in enumerate(run.inputs["prompts"] or [])
    ]
    base_span["span_kind"] = trace_tree.SpanKind.LLM

    return trace_tree.Span(**base_span)


def _convert_chain_run_to_wb_span(run: "Run") -> "trace_tree.Span":
    base_span = _base_convert_run_to_wb_span(run)

    base_span["results"] = [trace_tree.Result(inputs=run.inputs, outputs=run.outputs)]
    base_span["child_spans"] = [
        _convert_lc_run_to_wb_span(child_run) for child_run in run.child_runs
    ]
    base_span["span_kind"] = (
        trace_tree.SpanKind.AGENT
        if "agent" in run.serialized.get("name").lower()
        else trace_tree.SpanKind.CHAIN
    )

    return trace_tree.Span(**base_span)


def _convert_tool_run_to_wb_span(run: "Run") -> "trace_tree.Span":
    base_span = _base_convert_run_to_wb_span(run)

    base_span["attributes"]["input"] = run.inputs["input"]
    base_span["results"] = [trace_tree.Result(inputs=run.inputs, outputs=run.outputs)]
    base_span["child_spans"] = [
        _convert_lc_run_to_wb_span(child_run) for child_run in run.child_runs
    ]
    base_span["span_kind"] = trace_tree.SpanKind.TOOL

    return trace_tree.Span(**base_span)


def _convert_unknown_run_to_wb_span(run: "Run") -> "trace_tree.Span":
    base_span = _base_convert_run_to_wb_span(run)

    return trace_tree.Span(**base_span)


def _base_convert_run_to_wb_span(run: "Run") -> dict:
    attributes = {**run.extra} if run.extra else {}
    attributes["execution_order"] = run.execution_order

    return dict(
        span_id=str(run.id) if run.id is not None else None,
        _name=run.serialized.get("name"),
        start_time_ms=int(run.start_time.timestamp() * 1000),
        end_time_ms=int(run.end_time.timestamp() * 1000),
        status_code=trace_tree.StatusCode.SUCCESS
        if run.error is None
        else trace_tree.StatusCode.ERROR,
        status_message=run.error,
        attributes=attributes,
    )


def _replace_type_with_kind(data: dict) -> dict:
    if isinstance(data, dict):
        # W&B TraceTree expects "_kind" instead of "_type" since `_type` is special
        # in W&B.
        if "_type" in data:
            _type = data.pop("_type")
            data["_kind"] = _type
        return {k: _replace_type_with_kind(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [_replace_type_with_kind(v) for v in data]
    elif isinstance(data, tuple):
        return tuple(_replace_type_with_kind(v) for v in data)
    elif isinstance(data, set):
        return {_replace_type_with_kind(v) for v in data}
    else:
        return data
