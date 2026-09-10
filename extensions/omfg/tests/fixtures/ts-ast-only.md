---
description: "AST-only rule"
scope: "tool:edit(*.ts)"
interruptMode: never
astCondition:
  - "($X as { $$$BODY }).$PROP"
---

Needs an AST engine.
