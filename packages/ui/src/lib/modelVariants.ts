import { z } from 'zod';

const variantList = z.array(z.object({ id: z.string() }));

/**
 * Names of the thinking levels a model exposes, empty when it has none.
 *
 * OpenCode 1 uses keyed variants; OpenCode 2 returns an array with bare ids.
 */
export const modelVariantNames = (model: { variants?: object } | undefined): string[] => {
  const variants = model?.variants;
  if (!variants) return [];
  if (Array.isArray(variants)) {
    const parsed = variantList.safeParse(variants);
    return parsed.success ? parsed.data.map((variant) => variant.id) : [];
  }
  return Object.keys(variants);
};
