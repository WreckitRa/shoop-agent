/**
 * Persist optional precise measurements from the Tailored avatar path.
 * These are shopping-side facts only — they never feed the avatar image prompt.
 *
 * Reserved: `measurement` facts are stored for a future size-chart fit layer.
 * No scoring / search / try-on consumer should read them yet.
 */
import { upsertFashionFact } from "../facts";
import type {
  FashionFactMeasurementMetric,
  FashionFactMeasurementValue,
  FashionFactRow,
} from "../types";

export type StatedMeasurement = FashionFactMeasurementValue;

export async function applyStatedMeasurements(params: {
  userId: string;
  personId: string;
  measurements: StatedMeasurement[];
  sourceQuote?: string;
}): Promise<FashionFactRow[]> {
  const written: FashionFactRow[] = [];
  for (const m of params.measurements) {
    if (!Number.isFinite(m.value) || m.value <= 0) continue;
    const metric = m.metric as FashionFactMeasurementMetric;
    // garment_type = metric so each metric supersedes independently
    const row = await upsertFashionFact({
      userId: params.userId,
      personId: params.personId,
      factType: "measurement",
      garmentType: metric,
      value: {
        metric,
        value: m.value,
        unit: m.unit,
      },
      sourceQuote: params.sourceQuote ?? `avatar tailored: ${metric}`,
    });
    written.push(row);
  }
  return written;
}
