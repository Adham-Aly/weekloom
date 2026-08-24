import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Google_Sans,
  Libre_Baskerville,
} from "next/font/google";
import Script from "next/script";
import "./globals.css";
import {
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  PRODUCT_DESCRIPTION,
} from "@/lib/brand";

/**
 * ⚠️ These faces are downloaded and SELF-HOSTED at build time — the build
 * emits `.woff2` files into `.next/static/media` and a plain `@font-face`
 * stack. The running app therefore issues no font request at all: there is no
 * remote stylesheet link in the shipped HTML, and `next.config.ts`'s CSP
 * (`font-src 'self' data:`) would block one if there were.
 */
const googleSans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  display: "swap",
});
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
// ⚠️ `--font-libre` is read by components/ui/logo-mark.tsx and by the giant
// task-count figure on each board card (components/boards/board-home.tsx).
// Dropping it is a silent typography regression, not a dead-code removal.
const libre = Libre_Baskerville({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-libre",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    // Child pages set just their own title; this frames it with the brand.
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: `${PRODUCT_TAGLINE} ${PRODUCT_DESCRIPTION}`,
  applicationName: PRODUCT_NAME,
  icons: { icon: "/weekloom-logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      /* ⚠️ Load-bearing, and it must agree with `DEFAULT_SETTINGS.theme`.
       *  `globals.css` is dark-first: `:root` IS the dark palette and
       *  `[data-theme="light"]` overrides it. So an <html> with no attribute
       *  paints DARK, whatever the stored setting says — the light default
       *  would then only arrive at hydration, as a dark flash on every single
       *  launch. Stating the default here means the very first paint is
       *  already right; the bootstrap script below overrides it for anyone who
       *  chose otherwise. If the CSS is ever inverted to light-first, this
       *  attribute has to move with it. */
      data-theme="light"
      className={`${googleSans.variable} ${geistSans.variable} ${geistMono.variable} ${libre.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        {/* No-flash theme bootstrap. Reads cached choice before paint.
         *  Next.js 16 forbids raw <script> in the React tree; the
         *  beforeInteractive strategy on next/script injects it early
         *  enough that the first paint already has the right theme. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('gantt:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
