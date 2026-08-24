import { redirect } from "next/navigation";

/**
 * The desktop shell opens `/app` directly, so nothing normally lands here.
 * This exists so a stray navigation to the origin root — a typed URL, a
 * bookmark from an earlier session, the shell's own recovery reload — reaches
 * the board list instead of a 404.
 */
export default function RootPage() {
  redirect("/app");
}
