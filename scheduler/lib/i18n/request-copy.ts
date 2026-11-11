import { getUiTranslation } from "./request";

import type { SourceCopy } from "./source-copy";
import type { MessageKey } from "./translate";

export async function getUiCopy() {
  const { locale, t } = await getUiTranslation();
  const copy: SourceCopy = (source, values) => t(source as MessageKey, values);
  return { locale, copy };
}
