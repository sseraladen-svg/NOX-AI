"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DemoVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemoVideoDialog({
  open,
  onOpenChange,
}: DemoVideoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>NOX AI Demo</DialogTitle>
          <DialogDescription>About the product</DialogDescription>
        </DialogHeader>
        <div className="aspect-video rounded-lg bg-black">
          <video className="h-full w-full" src="/videos/nox-demo.mp4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
