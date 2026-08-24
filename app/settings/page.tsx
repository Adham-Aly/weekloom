import { getSettings } from "@/app/actions";
import { mergeSettings } from "@/lib/types/settings";
import { Providers } from "@/app/providers";
import { SettingsForm } from "@/components/settings-form";

/**
 * ⚠️ MANDATORY, and its absence is invisible until production.
 *
 * This page uses no dynamic API — it reads settings through a synchronous
 * function call — so Next prerenders it at build time and emits a static
 * `settings.html`. The dev server re-renders on every request and looks
 * perfect; the built app then serves whatever was in the BUILD MACHINE's
 * database, forever, and every save appears to do nothing after a reload.
 *
 * Measured on this exact Next version: without this line the route table shows
 * `○ /settings` and two consecutive requests return the same build-time value.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return (
    <Providers>
      <SettingsForm initial={mergeSettings(await getSettings())} />
    </Providers>
  );
}
