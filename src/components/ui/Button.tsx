import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={[
        "inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold",
        "bg-premium-blue text-white hover:brightness-95 active:brightness-90",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      ].join(" ")}
      {...props}
    />
  );
}

