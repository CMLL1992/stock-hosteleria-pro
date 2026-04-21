import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={[
        "inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-medium",
        "bg-zinc-950 text-white hover:bg-zinc-900 active:bg-black",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      ].join(" ")}
      {...props}
    />
  );
}

