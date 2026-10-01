import { z } from 'zod';

const variantList = z.array(z.object({ id: z.string() }));
export type ModelVariantSource = object | null | undefined;

/** OC1 keyed variants and OC2 variant records share displayable IDs. */
export const listModelVariantIds = (variants: ModelVariantSource): string[] => {
  if (!variants) return [];
  if (Array.isArray(variants)) {
    const parsed = variantList.safeParse(variants);
    return parsed.success ? parsed.data.map((variant) => variant.id).filter(Boolean) : [];
  }
  return Object.keys(variants);
};

/**
 * Names of the thinking levels a model exposes, empty when it has none.
 *
 * OpenCode 1 uses keyed variants; OpenCode 2 returns an array with bare ids.
 */
export const modelVariantNames = (model: { variants?: object } | undefined): string[] => {
  return listModelVariantIds(model?.variants);
};
