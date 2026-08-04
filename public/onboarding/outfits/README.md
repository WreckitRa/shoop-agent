# Onboarding style photos

Drop style images here. Served at:

```
/onboarding/outfits/{id}.webp
```

Examples:

```
public/onboarding/outfits/f-w-parisian-01.webp
public/onboarding/outfits/m-a-classic-01.webp
```

1. Name the file exactly `{id}.webp` (id from `outfit-style-catalog.ts`)
2. Point `imageUrl` on that look to `/onboarding/outfits/{id}.webp`  
   (or use `outfitPhotoUrl("f-w-parisian-01")`)
3. Styles are **mode-agnostic** — the same photo can show as “worn” for one person and “wanted” for another

Checklist + gen prompts: `docs/onboarding/outfit-style-photo-checklist.md`
