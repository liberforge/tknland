import { encode } from "uqr";

type QrCodeProps = {
  value: string;
  /** Outer box size in CSS pixels. */
  size?: number;
  className?: string;
  "aria-label"?: string;
};

/** Renders a high-contrast QR as an inline SVG (no network). */
export function QrCode({
  value,
  size = 200,
  className,
  "aria-label": ariaLabel = "Código QR",
}: QrCodeProps) {
  const { size: modules, data } = encode(value, {
    ecc: "M",
    border: 2,
  });
  const cell = size / modules;

  const rects: string[] = [];
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (data[y]![x]) {
        rects.push(
          `M${x * cell},${y * cell}h${cell}v${cell}h${-cell}z`,
        );
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <rect width={size} height={size} fill="#f3efe6" />
      <path d={rects.join("")} fill="#0d1412" />
    </svg>
  );
}
