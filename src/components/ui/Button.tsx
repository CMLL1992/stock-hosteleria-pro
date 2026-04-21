import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={[
        "inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold",
        "bg-black text-white hover:bg-slate-900 active:bg-slate-950",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      ].join(" ")}
      {...props}
    />
  );
}

