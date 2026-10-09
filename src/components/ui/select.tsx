import * as React from "react";
import { cn } from "@/lib/utils";

// Liste déroulante native : légère, accessible et adaptée aux téléphones.
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input bg-background focus-visible:ring-ring aria-invalid:border-destructive flex h-12 w-full rounded-md border px-3 text-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
