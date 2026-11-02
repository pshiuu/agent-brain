---
name: brain
description: Load the agent brain (operating manual, index, preferences, knowledge pages, project memory). Use at the start of any session in a brain project, when the user mentions the brain, memory, brief, playbook or phases, or when BRAIN_SYSTEM is set in the environment.
---

1. Read `$BRAIN_SYSTEM/BRAIN.md` and follow it.
2. Project memory is in `$BRAIN_MEMORY/projects/$BRAIN_PROJECT/`.
3. Your role definitions are in `$BRAIN_SYSTEM/roles/`, playbooks in `$BRAIN_SYSTEM/playbooks/`.
If the variables are not set, you are not in a brain sandbox: say so and continue normally.
