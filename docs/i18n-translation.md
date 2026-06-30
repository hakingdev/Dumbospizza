# I18n Translation Workflow

This project keeps translations as versioned JSON files in `public/locales/{lang}`.
External translation APIs are used only to generate or refresh those files, not during
checkout or other customer-facing runtime flows.

## Provider

The default generator uses Google Cloud Translation Basic via an API key:

```bash
GOOGLE_TRANSLATE_API_KEY=...
```

Run a dry-run first:

```bash
npm run i18n:translate -- --targets=en,tr,pl
```

Write missing translations:

```bash
npm run i18n:translate -- --targets=en,tr,pl --apply
```

Refresh existing translations too:

```bash
npm run i18n:translate -- --targets=en --force --apply
```

## Glossary

Protected brand, menu, size, offer, and allergen terms live in
`config/translation-glossary.json`. The script temporarily replaces those terms with
tokens before sending text to Google and restores the original text afterward.

Use the glossary for terms that must stay stable, for example:

- brand names: `Dumbos Pizza`, `Dumbo Slice Pizza`
- offer wording: `Gratis`, `Angebote`, `BOGO`
- product names: `Margherita`, `Salami`, `Tiramisu`
- sizes and units: `XL`, `Ø 32 cm`, `0.5l`
- allergen labels: `Gluten`, `Laktose`, `Sesam`

## Enabling A Language

Generating `public/locales/en/common.json` is only the first step. After reviewing
the generated copy, add the language to the app language config and switcher labels.

Keep the source language as German (`de`) unless the website copy source changes.
