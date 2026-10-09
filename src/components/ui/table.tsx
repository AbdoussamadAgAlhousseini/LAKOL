import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("text-muted-foreground px-3 py-2 text-left font-medium whitespace-nowrap", className)}
      {...props}
    />
  );
}

function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-t px-3 py-3 align-middle", className)} {...props} />;
}

export { Table, Th, Td };
