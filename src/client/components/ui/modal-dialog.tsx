import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { cn } from "@/client/lib/utils";

const sizeClasses = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
} as const;

interface ModalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: keyof typeof sizeClasses;
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  footer,
  children,
}: ModalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[85vh] flex flex-col gap-0 p-0",
          sizeClasses[size],
        )}
      >
        {/* Header - sticky */}
        <DialogHeader className="flex-shrink-0 p-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6">{children}</div>

        {/* Footer - sticky */}
        {footer && (
          <div className="flex-shrink-0 border-t p-4 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
