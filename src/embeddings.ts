import type { FeatureExtractionPipeline } from "@xenova/transformers";

let pipe: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipe) return pipe;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline } = await import("@xenova/transformers");
    pipe = await pipeline("feature-extraction", "Xenova/multilingual-e5-small") as FeatureExtractionPipeline;
    return pipe;
  })();
  return loading;
}

export async function embed(text: string, type: "query" | "passage" = "passage"): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(`${type}: ${text}`, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function vectorToSql(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}
