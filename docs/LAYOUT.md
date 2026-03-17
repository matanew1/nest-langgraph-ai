# Repository Layout

- `src/modules/agents/graph/`: LangGraph StateGraph definition.
- `src/modules/agents/nodes/`: The 5 core nodes (Supervisor, Researcher, etc.).
- `src/modules/agents/prompts/templates/`: `.txt` files for LLM instructions.
- `src/modules/llm/`: `invokeLlm()` provider logic.
- `src/common/utils/`: Path sandboxing and JSON repair utilities.