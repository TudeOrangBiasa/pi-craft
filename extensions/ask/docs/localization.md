# Localization

This fork is English-only. There is no locale SDK, no `locales/` directory,
and no language picker: every string renders from its inline English
fallback. Do not add translation infrastructure; do not translate tool
descriptions, parameter schemas, or error messages — the model reads those,
and translating them changes model behavior rather than the user's reading
experience.
