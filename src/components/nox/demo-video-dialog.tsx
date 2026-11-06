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
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const updateSubtitleTracks = React.useCallback(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;

    for (let index = 0; index < tracks.length; index += 1) {
      tracks[index].mode = subtitlesEnabled ? "showing" : "hidden";
    }
  }, [subtitlesEnabled]);

  React.useEffect(() => {
    updateSubtitleTracks();
  }, [open, updateSubtitleTracks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>NOX AI Demo</DialogTitle>
          <DialogDescription>About the product</DialogDescription>
        </DialogHeader>
        <div className="aspect-video rounded-lg bg-black">
          <video
            ref={videoRef}
            className="h-full w-full"
            src="/videos/nox-demo.mp4"
            controls
            playsInline
            autoPlay
            onLoadedMetadata={updateSubtitleTracks}
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
