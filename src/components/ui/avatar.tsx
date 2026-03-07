"use client";

import { cn, getInitials } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeStyles = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

const colors = [
  "bg-primary/10 text-primary",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-purple-100 text-purple-700",
  "bg-amber-100 text-amber-700",
  "bg-teal-100 text-teal-700",
  "bg-rose-100 text-rose-700",
  "bg-indigo-100 text-indigo-700",
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "rounded-full object-cover ring-2 ring-white",
          sizeStyles[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold ring-2 ring-white shrink-0",
        sizeStyles[size],
        getColorFromName(name),
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}

export function AvatarGroup({
  items,
  max = 4,
  size = "sm",
}: {
  items: { name: string; src?: string }[];
  max?: number;
  size?: "xs" | "sm" | "md";
}) {
  const visible = items.slice(0, max);
  const remaining = items.length - max;

  return (
    <div className="flex -space-x-2">
      {visible.map((item, i) => (
        <Avatar key={i} name={item.name} src={item.src} size={size} />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            "rounded-full flex items-center justify-center font-medium bg-stone-100 text-stone-600 ring-2 ring-white",
            sizeStyles[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
