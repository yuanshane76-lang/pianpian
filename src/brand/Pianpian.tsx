import brand from "../../brand.json";
import "./brand.css";

export { brand };

export function Pianpian({ variant = "avatar", className = "", decorative = true }: {
  variant?: "avatar" | "reading";
  className?: string;
  decorative?: boolean;
}) {
  return <img className={`pianpian pianpian-${variant} ${className}`} src={`/brand/pianpian-${variant}.webp`} width={variant === "reading" ? 112 : 28} height={variant === "reading" ? 112 : 28}
    alt={decorative ? "" : "篇篇，一起读论文的小伙伴"} aria-hidden={decorative || undefined} draggable={false} />;
}
