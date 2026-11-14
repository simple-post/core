import { normalizeLocale } from "@/lib/i18n/locales";
import { pluginLanguageSchema } from "@/lib/mcp/language-values";
import { prisma } from "@/lib/prisma";

export { pluginLanguageSchema, responseLocaleSchema } from "@/lib/mcp/language-values";

export async function savedPluginLanguage(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pluginLocale: true } });
  return normalizeLocale(user?.pluginLocale);
}
export async function savePluginLanguage(userId: string, language: unknown) {
  const value = pluginLanguageSchema.parse(language);
  await prisma.user.update({ where: { id: userId }, data: { pluginLocale: value === "auto" ? null : value } });
  return value;
}
