import { cn } from "@/lib/utils";

export function Section({
  className,
  title,
  subtitle,
  children,
}: {
  className?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("mx-auto flex flex-col py-20", className)}>
      <header className="flex flex-col items-center justify-between">
        <div className="mb-6 text-center text-5xl font-bold text-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="max-w-2xl text-center text-lg leading-relaxed text-muted-foreground">
            {subtitle}
          </div>
        )}
      </header>
      <main className="mt-8">{children}</main>
    </section>
  );
}
