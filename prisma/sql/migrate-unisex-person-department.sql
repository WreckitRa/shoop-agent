-- Migrate legacy person-side gender_presentation "unisex" → "mixed".
-- Person departments never include unisex (shop both = mixed).
-- Product/filter Unisex is unchanged.

UPDATE fashion_facts
SET value = jsonb_set(value, '{presentation}', '"mixed"', true),
    updated_at = NOW()
WHERE fact_type = 'gender_presentation'
  AND status IN ('active', 'candidate')
  AND value->>'presentation' = 'unisex';
