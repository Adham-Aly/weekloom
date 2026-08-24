import { PRODUCT_NAME } from "@/lib/brand";

export function Logo({
  className = "",
  isDark = false,
}: {
  className?: string;
  isDark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span
        className={`text-2xl leading-none transition-colors duration-300 ${isDark ? "text-white" : "text-[#18231d]"}`}
        style={{ fontFamily: "var(--font-libre), Georgia, serif" }}
      >
        {PRODUCT_NAME.toLowerCase()}
      </span>
    </div>
  );
}

/**
 * The Weekloom mark — a static, four-petal loom.
 * Source of truth lives in /public/Weekloom Logo.svg; this inline copy keeps it
 * crisp at any size and lets it inherit className-based sizing. The `isDark`
 * prop is accepted for call-site compatibility but the mark is full-color on
 * any background, so it is intentionally unused.
 */
export function LogoMark({
  className = "",
}: {
  className?: string;
  isDark?: boolean;
}) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 164.17 164.17"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        fill="#f6cd2a"
        d="M2.6,61.68L61.81,2.47c3.3-3.3,8.75-2.77,11.42,1.06,13.59,19.49,11.7,46.49-5.69,63.88-17.39,17.39-44.4,19.28-63.88,5.69-3.82-2.67-4.35-8.12-1.06-11.42Z"
      />
      <path
        fill="#4eb75a"
        d="M161.32,102l-59.21,59.21c-3.3,3.3-8.75,2.77-11.42-1.06-13.59-19.49-11.7-46.49,5.69-63.88,17.39-17.39,44.4-19.28,63.88-5.69,3.82,2.67,4.35,8.12,1.06,11.42Z"
      />
      <path
        fill="#559ed6"
        d="M102.78,2.18l59.21,59.21c3.3,3.3,2.77,8.75-1.06,11.42-19.49,13.59-46.49,11.7-63.88-5.69-17.39-17.39-19.28-44.4-5.69-63.88,2.67-3.82,8.12-4.35,11.42-1.06Z"
      />
      <path
        fill="#ee519c"
        d="M61.38,161.99L2.18,102.78c-3.3-3.3-2.77-8.75,1.06-11.42,19.49-13.59,46.49-11.7,63.88,5.69,17.39,17.39,19.28,44.4,5.69,63.88-2.67,3.82-8.12,4.35-11.42,1.06Z"
      />
    </svg>
  );
}
