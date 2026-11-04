# Design exports

No Figma export was provided for the Day 0 scaffold (this folder was empty). The provisional design
system is documented in [`../knowledge/design-system.md`](../knowledge/design-system.md) and
implemented in [`../app/globals.css`](../app/globals.css).

When a Figma export arrives:

1. Add the ZIP here and ingest it.
2. Reconcile tokens and component variants against `knowledge/design-system.md`.
3. Convert every color to HSL before touching `app/globals.css`.
4. Re-run the 320 / 375 / 768 / 1024 / 1440 checks and the accessibility pass.
