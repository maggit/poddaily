function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover ring-1 ring-border"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium text-muted-foreground ring-1 ring-inset ring-border"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials(name)}
    </span>
  );
}
