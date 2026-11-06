"use client";

import * as React from "react";
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
  const [subtitlesEnabled, setSubtitlesEnabled] = React.useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>NOX AI Demo</DialogTitle>
          <DialogDescription>About the product</DialogDescription>
        </DialogHeader>
        <div className="aspect-video rounded-lg bg-black">
          <video
            className="h-full w-full"
            src="/videos/nox-demo.mp4"
            controls
            playsInline
            autoPlay
          >
            <track
              src="/videos/nox-demo.vtt"
              kind="subtitles"
              srcLang="en"
              label="English"
              default={subtitlesEnabled}
            />
          </video>
        </div>
      </DialogContent>
    </Dialog>
  );
}
